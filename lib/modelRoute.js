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
function makeRoutes(Model) {
  const router = express.Router();
  const pkName = Model.primaryKey.name;

  router.get('/', requireModelPermission(Model, 'read'), async function(req, res, next) {
    try {
      const results = await Model.list({where: req.query.where});
      res.json({results});
    } catch (error) {
      next(error);
    }
  });

  router.post('/', requireModelPermission(Model, 'create'), async function(req, res, next) {
    try {
      if (req.user && Model.fieldInstances.createdBy) {
        req.body.createdById = req.body.createdById || req.user.id;
      }
      const instance = await Model.create(req.body);
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
      await req.instance.update(req.body);
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

  router.options('/', async function(req, res, next) {
    try {
      res.json({
        name: Model.name,
        pk: pkName,
        display: Model.toSchema().display,
        schema: Model.toSchema().fields,
        paths: Model.toPaths(),
      });
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
