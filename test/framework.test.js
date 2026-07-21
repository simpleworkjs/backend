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

test('server boots and serves the home page', async function() {
  const app = backend({conf: makeConf(), models: [Task]});
  await app.init();
  const server = app.http;

  await new Promise(function(resolve, reject) {
    server.listen(0, function(err) {
      if (err) return reject(err);
      resolve();
    });
  });

  try {
    const port = server.address().port;
    const res = await fetch(`http://localhost:${port}/`);
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.match(body, /SimpleWorkJS/);
  } finally {
    server.close();
  }
});

test('seed function creates admin user and login works', async function() {
  const conf = makeConf();
  let seededUser = null;

  async function seed(models) {
    const existing = await models.User.list({where: {userName: 'admin'}});
    if (existing.length) return;
    seededUser = await models.User.create({
      userName: 'admin',
      email: 'admin@example.com',
      password: 'Changeme1!',
      isAdmin: true,
      isValid: true,
    });
  }

  const app = backend({conf, models: [Task], seed});
  await app.init();
  const server = app.http;

  await new Promise(function(resolve, reject) {
    server.listen(0, function(err) {
      if (err) return reject(err);
      resolve();
    });
  });

  try {
    const port = server.address().port;
    const base = `http://localhost:${port}`;

    // Verify the seeded user exists.
    assert.ok(seededUser, 'seed created user');

    // Login via form POST.
    const loginRes = await fetch(`${base}/login`, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({userName: 'admin', password: 'Changeme1!'}),
      redirect: 'manual',
    });
    assert.strictEqual(loginRes.status, 302, 'login redirects');

    // Use the session cookie for an authenticated request.
    const cookie = loginRes.headers.get('set-cookie');
    const apiRes = await fetch(`${base}/api/User`, {
      headers: cookie ? {Cookie: cookie} : {},
    });
    assert.strictEqual(apiRes.status, 200);
    const json = await apiRes.json();
    assert.strictEqual(json.results.length, 1);
    assert.strictEqual(json.results[0].userName, 'admin');
  } finally {
    server.close();
  }
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
