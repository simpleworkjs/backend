'use strict';

const express = require('express');
const {authMiddleware, requireModelPermission, requireInstancePermission} = require('@simpleworkjs/orm-identity').auth;

/**
 * Create standard REST routes for a SimpleWorkJS model.
 *
 * Routes produced:
 *   GET    /:model          list
 *   POST   /:model          create
 *   GET    /:model/:pk      get one
 *   PUT    /:model/:pk      update
 *   DELETE /:model/:pk      delete
 *   OPTIONS /:model         schema
 */
// Fields a Model declares as never client-settable through the generic REST
// body, even though they're ordinary model fields (e.g. User.isAdmin).
// `static protectedFields = [...]` is an opt-in convention on the Model class.
function stripProtectedFields(Model, data) {
  const protectedFields = Model.protectedFields || [];
  if (!protectedFields.length) return data;
  const out = {...data};
  for (const key of protectedFields) delete out[key];
  return out;
}

function reqPermissionUser(req) {
  return req.user ? {id: req.user.id, permissions: req.permissions || new Set()} : null;
}

function makeRoutes(Model) {
  const router = express.Router();
  const pkName = Model.primaryKey.name;

  router.get('/', requireModelPermission(Model, 'read'), async function(req, res, next) {
    try {
      const results = await Model.list({where: req.query.where});
      // requireModelPermission only checks whether this user may read *some*
      // rows of this model; owner-scoped permissions (e.g. ['user', 'owner'])
      // still need each row filtered by instance-level permission, or an
      // owner-scoped model would leak every user's rows to every user.
      const user = reqPermissionUser(req);
      const visible = results.filter(instance => instance.hasPermission(user, 'read'));
      res.json({results: visible});
    } catch (error) {
      next(error);
    }
  });

  router.post('/', requireModelPermission(Model, 'create'), async function(req, res, next) {
    try {
      const data = stripProtectedFields(Model, req.body);
      if (req.user && Model.fieldInstances.createdBy) {
        // Always derive ownership from the authenticated session, never
        // from client input — otherwise a client can spoof `createdById`
        // and attribute a record to (or steal ownership-based permission
        // as) a different user.
        data.createdById = req.user.id;
      }
      const instance = await Model.create(data);
      res.status(201).json({data: instance});
    } catch (error) {
      next(error);
    }
  });

  router.get(`/:${pkName}`, requireInstancePermission(Model, 'read'), async function(req, res, next) {
    try {
      res.json({data: req.instance});
    } catch (error) {
      next(error);
    }
  });

  router.put(`/:${pkName}`, requireInstancePermission(Model, 'update'), async function(req, res, next) {
    try {
      const data = stripProtectedFields(Model, req.body);
      await req.instance.update(data);
      res.json({data: req.instance});
    } catch (error) {
      next(error);
    }
  });

  router.delete(`/:${pkName}`, requireInstancePermission(Model, 'delete'), async function(req, res, next) {
    try {
      await req.instance.delete();
      res.json({data: req.instance});
    } catch (error) {
      next(error);
    }
  });

  router.options('/', requireModelPermission(Model, 'read'), async function(req, res, next) {
    try {
      // `Model.toSchema()` already returns {name, pk, display, fields}; expose
      // that shape verbatim (plus `paths`) so the field map stays under `fields`.
      // The client renderer (app.render) and the server-side EJS both read
      // `schema.fields` — a previous version nested the map under `schema`
      // instead, so `app.render`'s `Object.values(schema.fields)` blew up on
      // every list/edit page. The frontend render tests never caught it because
      // they hand-build a fixture with a `.fields` key rather than hitting OPTIONS.
      res.json({...Model.toSchema(), paths: Model.toPaths()});
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function mount(app, models, prefix) {
  prefix = prefix || '/api';

  app.use(prefix, authMiddleware(models));

  for (const Model of Object.values(models)) {
    app.use(`${prefix}/${Model.name}`, makeRoutes(Model));
  }

  app.get(`${prefix}/`, function(req, res) {
    res.json({
      models: Object.values(models).map(Model => ({
        name: Model.name,
        path: `${prefix}/${Model.name}`,
        schemaPath: `${prefix}/${Model.name}`,
      })),
    });
  });
}

module.exports = {makeRoutes, mount};
