'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const {createServer} = require('http');
const {Server: SocketIOServer} = require('socket.io');

const ormIdentity = require('@simpleworkjs/orm-identity');
const modelRoute = require('./modelRoute');
const {PubSub} = require('./pubsub');
const {pageHelpers} = require('./render');
const pages = require('../routes/pages');

/**
 * Build a SimpleWorkJS backend application.
 *
 * Options:
 *   conf       — loaded @simpleworkjs/conf object
 *   models     — array/object of app Model classes (identity models are added automatically)
 *   pages      — optional page router (defaults to built-in pages)
 *   seed       — optional async function(models) run after sync
 *   pubsub     — optional pub/sub instance
 *
 * Returns:
 *   { app, http, io, models, pubsub, orm, start(), init(), close() }
 */
function createSimpleWorkJS(options) {
  options = options || {};
  const conf = options.conf || {};
  const appModels = options.models || [];
  const pageRouter = options.pages || pages;
  const seed = options.seed || null;
  const pubsub = options.pubsub || new PubSub(conf.pubsub);

  const app = express();
  const http = createServer(app);
  let io = null;

  const viewsPath = conf.views && conf.views.path
    ? path.resolve(process.cwd(), conf.views.path)
    : path.join(__dirname, '..', 'views');
  const staticPath = conf.static && conf.static.path
    ? path.resolve(process.cwd(), conf.static.path)
    : path.join(__dirname, '..', 'public');

  app.engine('ejs', require('ejs-mate'));
  app.set('view engine', 'ejs');
  app.set('views', viewsPath);
  app.use(express.json());
  app.use(express.urlencoded({extended: true}));
  app.use(cookieParser());
  app.use(express.static(staticPath));

  let initialized = false;
  let models = null;
  let orm = null;
  let bridgeSub = null;

  async function init() {
    if (initialized) return models;

    orm = new ormIdentity.ORM(conf, pubsub);
    models = await orm.load([Object.values(ormIdentity.identity), appModels]);

    pageRouter.setModels(models);

    app.use(pageHelpers(models));
    modelRoute.mount(app, models, conf.api && conf.api.prefix || '/api');
    app.use('/', pageRouter.router);

    app.use(function(err, req, res, next) {  // eslint-disable-line no-unused-vars
      console.error(err);
      res.status(err.status || 500).json({
        error: {
          message: err.message,
          ...(err.keyErrors && {details: err.keyErrors}),
        },
      });
    });

    if (seed) {
      try {
        await seed(models);
      } catch (error) {
        console.error('Seed failed (non-fatal):', error.message);
      }
    }

    initialized = true;
    return models;
  }

  function start() {
    return init().then(function() {
      io = new SocketIOServer(http);
      bridgeSub = pubsub.subscribe(/^model:/, function(data) {
        io.emit('model:event', data);
      });

      const port = conf.app && conf.app.port || 3000;
      http.listen(port, function() {
        console.log(`${conf.app && conf.app.name || 'SimpleWorkJS'} running on http://localhost:${port}`);
      });
      return {app, http, io, models, pubsub, orm};
    }).catch(function(error) {
      console.error('Failed to start:', error);
      process.exit(1);
    });
  }

  async function close() {
    if (bridgeSub && bridgeSub.remove) {
      bridgeSub.remove();
    }
    if (io) {
      io.close();
    }
    if (http.listening) {
      await new Promise(function(resolve) { http.close(resolve); });
    }
    if (orm) {
      await orm.close();
    }
  }

  return {
    app,
    http,
    io,
    init,
    start,
    close,
    get models() {
      return models;
    },
    get orm() {
      return orm;
    },
  };
}

module.exports = createSimpleWorkJS;
