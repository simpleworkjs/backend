'use strict';

const express = require('express');
const {authMiddleware, login, issueAuthToken, COOKIE_NAME} = require('@simpleworkjs/orm-identity').auth;

const router = express.Router();

function setModels(models) {
  router.models = models;
  return router;
}

router.use(async function(req, res, next) {
  if (!router.models) return next();
  try {
    return authMiddleware(router.models)(req, res, next);
  } catch (error) {
    next(error);
  }
});

// Expose the authenticated user to every rendered page (the layout's profile
// dropdown and admin menu read these). authMiddleware above populates req.user
// and req.permissions.
router.use(function(req, res, next) {
  res.locals.user = req.user || null;
  res.locals.isAdmin = !!(req.permissions && req.permissions.has('admin'));
  next();
});

router.get('/', async function(req, res) {
  res.render('index', {
    title: 'SimpleWorkJS',
    models: Object.values(router.models).map(m => ({
      name: m.name,
      display: m.toSchema().display,
    })),
  });
});

router.get('/login', async function(req, res) {
  res.render('login', {
    title: 'Login',
    error: null,
  });
});

router.post('/login', async function(req, res, next) {
  try {
    const {userName, password} = req.body;
    const user = await login(router.models, userName, password);
    if (!user) {
      return res.status(401).render('login', {
        title: 'Login',
        error: 'Invalid username or password',
      });
    }
    const token = await issueAuthToken(user, router.models, 'browser', 24 * 7);
    res.cookie(COOKIE_NAME, token.token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async function(req, res) {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

router.get('/:model/list', async function(req, res, next) {
  try {
    const Model = router.models[req.params.model];
    if (!Model) return next();
    if (!Model.hasPermission(req.user, 'read')) {
      return res.status(req.user ? 403 : 401).render('error', {
        title: 'Error',
        message: req.user ? 'Permission denied' : 'Authentication required',
      });
    }

    const items = await Model.list();
    res.render('list', {
      title: `${Model.toSchema().display.name} list`,
      modelName: Model.name,
      schema: Model.toSchema(),
      items,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:model/new', async function(req, res, next) {
  const Model = router.models[req.params.model];
  if (!Model) return next();
  if (!Model.hasPermission(req.user, 'create')) {
    return res.status(req.user ? 403 : 401).render('error', {
      title: 'Error',
      message: req.user ? 'Permission denied' : 'Authentication required',
    });
  }

  res.render('edit', {
    title: `New ${Model.toSchema().display.name}`,
    modelName: Model.name,
    schema: Model.toSchema(),
    item: null,
  });
});

router.get('/:model/:pk/edit', async function(req, res, next) {
  try {
    const Model = router.models[req.params.model];
    if (!Model) return next();

    const item = await Model.get(req.params.pk);
    if (!item) return res.status(404).render('error', {
      title: 'Error',
      message: `${Model.name} not found`,
    });
    if (!item.hasPermission(req.user, 'update')) {
      return res.status(req.user ? 403 : 401).render('error', {
        message: req.user ? 'Permission denied' : 'Authentication required',
      });
    }

    res.render('edit', {
      title: `Edit ${Model.toSchema().display.name}`,
      modelName: Model.name,
      schema: Model.toSchema(),
      item,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:model/:pk', async function(req, res, next) {
  try {
    const Model = router.models[req.params.model];
    if (!Model) return next();

    const item = await Model.get(req.params.pk);
    if (!item) return res.status(404).render('error', {
      title: 'Error',
      message: `${Model.name} not found`,
    });
    if (!item.hasPermission(req.user, 'read')) {
      return res.status(req.user ? 403 : 401).render('error', {
        message: req.user ? 'Permission denied' : 'Authentication required',
      });
    }

    res.render('detail', {
      title: `${Model.toSchema().display.name} detail`,
      modelName: Model.name,
      schema: Model.toSchema(),
      item,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/custom/dashboard', async function(req, res) {
  res.render('custom', {
    title: 'Custom Dashboard',
    models: Object.values(router.models).map(m => ({
      name: m.name,
      display: m.toSchema().display,
    })),
  });
});

module.exports = {router, setModels};
