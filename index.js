'use strict';

/**
 * @simpleworkjs/backend
 *
 * Server framework for SimpleWorkJS apps.
 *
 * Usage:
 *
 *   const backend = require('@simpleworkjs/backend');
 *   const conf = require('@simpleworkjs/conf');
 *   const {Model} = require('@simpleworkjs/orm-identity');
 *
 *   const app = backend({conf, models: require('./models')});
 *   app.start();
 *
 * CLI:
 *
 *   npx simpleworks generate my-app
 */

const createSimpleWorkJS = require('./lib/framework');
const modelRoute = require('./lib/modelRoute');
const pubsub = require('./lib/pubsub');
const render = require('./lib/render');
const pages = require('./routes/pages');
const generator = require('./generator');

function backend(options) {
  return createSimpleWorkJS(options);
}

backend.framework = createSimpleWorkJS;
backend.modelRoute = modelRoute;
backend.PubSub = pubsub.PubSub;
backend.render = render;
backend.pages = pages;
backend.generator = generator;

module.exports = backend;
