'use strict';

const test = require('node:test');
const assert = require('node:assert');
const backend = require('..');
const {Model} = require('@simpleworkjs/orm-identity');

function makeConf() {
  return {
    app: {name: 'Test App', port: 0},
    database: {dialect: 'sqlite', storage: ':memory:', logging: false},
    views: {path: require('path').join(__dirname, '..', 'views')},
    static: {path: require('path').join(__dirname, '..', 'public')},
  };
}

class Task extends Model {
  static fields = {
    id: {type: 'uuid', primaryKey: true},
    title: {type: 'string', isRequired: true},
  };

  static permissions = {
    read: ['user'],
    create: ['admin'],
  };
}

test('backend factory loads identity + app models', async function() {
  const app = backend({conf: makeConf(), models: [Task]});
  const models = await app.init();

  assert.ok(models.User, 'User loaded');
  assert.ok(models.Task, 'Task loaded');
});

test('auto REST routes are mounted', async function() {
  const app = backend({conf: makeConf(), models: [Task]});
  await app.init();

  const routes = app.app._router.stack
    .filter(layer => layer.route || layer.name === 'router')
    .map(layer => layer.regexp.toString());

  assert.ok(routes.some(r => r.includes('/api')), 'api route mounted');
});

test('generator creates expected files', async function() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const generator = require('../generator');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swjs-gen-'));
  const target = path.join(tmp, 'my-app');

  generator.generate('my-app', target);

  assert.ok(fs.existsSync(path.join(target, 'package.json')), 'package.json created');
  assert.ok(fs.existsSync(path.join(target, 'app.js')), 'app.js created');
  assert.ok(fs.existsSync(path.join(target, 'models', 'Task.js')), 'Task model created');
  assert.ok(fs.existsSync(path.join(target, 'conf', 'base.js')), 'conf/base.js created');
  assert.ok(fs.existsSync(path.join(target, 'views', 'layout.ejs')), 'views copied');
  assert.ok(fs.existsSync(path.join(target, 'public', 'lib', 'js', 'app.js')), 'public assets copied');
});
