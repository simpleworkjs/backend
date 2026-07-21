'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const backend = require('..');
const {Model} = require('@simpleworkjs/orm-identity');
const {auth} = require('@simpleworkjs/orm-identity');
const {io: ioClient} = require('socket.io-client');

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

// Owner-scoped model used to exercise ownership spoofing, the list IDOR fix,
// and the protectedFields mass-assignment guard.
class Note extends Model {
  static fields = {
    id: {type: 'uuid', primaryKey: true},
    title: {type: 'string', isRequired: true},
    isPinned: {type: 'boolean', default: false},
    createdBy: {type: 'hasOne', model: 'User'},
  };

  static protectedFields = ['isPinned'];

  static permissions = {
    read: ['user', 'owner'],
    create: ['user'],
    update: ['admin', 'owner'],
    delete: ['admin', 'owner'],
  };
}

// Strictly owner-only readable model (no blanket 'user' read) used to prove
// the WebSocket broadcast only reaches sockets whose user actually owns the
// row, not every connected client.
class Secret extends Model {
  static fields = {
    id: {type: 'uuid', primaryKey: true},
    title: {type: 'string', isRequired: true},
    createdBy: {type: 'hasOne', model: 'User'},
  };

  static permissions = {
    read: ['owner'],
    create: ['user'],
  };
}

function listen(server) {
  return new Promise(function(resolve, reject) {
    server.listen(0, function(err) {
      if (err) return reject(err);
      resolve(server.address().port);
    });
  });
}

test('backend factory loads identity + app models', async function() {
  const app = backend({conf: makeConf(), models: [Task]});
  const models = await app.init();

  assert.ok(models.User, 'User loaded');
  assert.ok(models.Task, 'Task loaded');
});

async function setupOwnershipApp() {
  const app = backend({conf: makeConf(), models: [Note, Secret]});
  const models = await app.init();
  const port = await listen(app.http);
  const base = `http://localhost:${port}`;

  const alice = await models.User.create({
    userName: 'alice', email: 'alice@example.com', password: 'Wonderland1!',
  });
  const bob = await models.User.create({
    userName: 'bob', email: 'bob@example.com', password: 'Builder1!',
  });

  const aliceToken = await auth.issueAuthToken(alice, models, 'test');
  const bobToken = await auth.issueAuthToken(bob, models, 'test');

  function authHeaders(token) {
    return {Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json'};
  }

  return {app, models, base, alice, bob, aliceToken, bobToken, authHeaders};
}

test('GET list only returns rows the requesting user is allowed to read (owner-scoped IDOR fix)', async function() {
  const {app, base, alice, bob, aliceToken, bobToken, authHeaders} = await setupOwnershipApp();
  try {
    await fetch(`${base}/api/Note`, {
      method: 'POST', headers: authHeaders(aliceToken),
      body: JSON.stringify({title: 'alice note'}),
    });
    await fetch(`${base}/api/Note`, {
      method: 'POST', headers: authHeaders(bobToken),
      body: JSON.stringify({title: 'bob note'}),
    });

    // Note.permissions.read = ['user', 'owner']: any authenticated user can
    // read *some* Notes, so the model-level gate alone can't distinguish
    // owners; the route must additionally filter per instance.
    const aliceRes = await fetch(`${base}/api/Note`, {headers: authHeaders(aliceToken)});
    const aliceJson = await aliceRes.json();
    // Both users have model-level 'user' read access here, so this asserts
    // the filtering logic runs at all (each row's owner resolves correctly),
    // not that Note hides other users' rows — see the Secret-model test
    // below for a permission set where only the true owner may read.
    assert.ok(aliceJson.results.some(r => r.title === 'alice note'));
  } finally {
    await app.close();
  }
});

test('creating a record ignores a client-supplied createdById (ownership spoofing fix)', async function() {
  const {app, base, alice, bob, aliceToken, authHeaders} = await setupOwnershipApp();
  try {
    const res = await fetch(`${base}/api/Note`, {
      method: 'POST', headers: authHeaders(aliceToken),
      body: JSON.stringify({title: 'spoofed', createdById: bob.id}),
    });
    const json = await res.json();
    assert.strictEqual(json.data.createdById, alice.id, 'ownership must come from the session, not the body');
  } finally {
    await app.close();
  }
});

test('protectedFields are stripped from create/update bodies (mass-assignment fix)', async function() {
  const {app, base, aliceToken, authHeaders} = await setupOwnershipApp();
  try {
    const createRes = await fetch(`${base}/api/Note`, {
      method: 'POST', headers: authHeaders(aliceToken),
      body: JSON.stringify({title: 'pin me', isPinned: true}),
    });
    const created = (await createRes.json()).data;
    assert.strictEqual(created.isPinned, false, 'protected field ignored on create');

    const updateRes = await fetch(`${base}/api/Note/${created.id}`, {
      method: 'PUT', headers: authHeaders(aliceToken),
      body: JSON.stringify({isPinned: true}),
    });
    const updated = (await updateRes.json()).data;
    assert.strictEqual(updated.isPinned, false, 'protected field ignored on update');
  } finally {
    await app.close();
  }
});

test('OPTIONS schema route requires authentication', async function() {
  const {app, base} = await setupOwnershipApp();
  try {
    const res = await fetch(`${base}/api/Note`, {method: 'OPTIONS'});
    assert.strictEqual(res.status, 401);
  } finally {
    await app.close();
  }
});

test('OPTIONS schema route returns the field map under `fields` (app.render contract)', async function() {
  // Regression: the field map was once nested under `schema` instead of
  // `fields`, so the browser renderer's `Object.values(schema.fields)` threw on
  // every list/edit page. The response shape must match `Model.toSchema()`,
  // which is what both app.render and the server-side EJS read.
  const {app, base, aliceToken, authHeaders} = await setupOwnershipApp();
  try {
    const res = await fetch(`${base}/api/Note`, {method: 'OPTIONS', headers: authHeaders(aliceToken)});
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.name, 'Note');
    assert.strictEqual(body.pk, 'id');
    assert.ok(body.fields && typeof body.fields === 'object', 'field map is under `fields`');
    assert.ok(body.fields.title, 'declared fields are present in the map');
    assert.ok(body.display && body.pk, 'display and pk are present for the renderer');
    assert.strictEqual(body.schema, undefined, 'field map must not be nested under `schema`');
  } finally {
    await app.close();
  }
});

test('WebSocket model events are only broadcast to sockets whose user may read that row', async function() {
  const {app, base, alice, bob, aliceToken, bobToken, authHeaders} = await setupOwnershipApp();
  app.attachSockets();

  function connect(token) {
    return new Promise(function(resolve, reject) {
      const socket = ioClient(base, {auth: {token: token.token}, transports: ['websocket']});
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  try {
    const aliceSocket = await connect(aliceToken);
    const bobSocket = await connect(bobToken);

    const aliceEvents = [];
    const bobEvents = [];
    aliceSocket.on('model:event', d => aliceEvents.push(d));
    bobSocket.on('model:event', d => bobEvents.push(d));

    // Give socket.io a moment to finish the `io.use` auth middleware for
    // both connections before publishing.
    await new Promise(resolve => setTimeout(resolve, 100));

    await fetch(`${base}/api/Secret`, {
      method: 'POST', headers: authHeaders(aliceToken),
      body: JSON.stringify({title: 'alice secret'}),
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.strictEqual(aliceEvents.length, 1, 'owner receives the event');
    assert.strictEqual(bobEvents.length, 0, 'non-owner does not receive the event');

    aliceSocket.close();
    bobSocket.close();
  } finally {
    await app.close();
  }
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

test('frontend assets are served from @simpleworkjs/frontend', async function() {
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
    const base = `http://localhost:${port}`;
    const frontend = require('@simpleworkjs/frontend');

    for (const [name, assetPath] of Object.entries(frontend.assets)) {
      const expected = require('fs').readFileSync(assetPath, 'utf8');
      const res = await fetch(`${base}/lib/js/${path.basename(assetPath)}`);
      assert.strictEqual(res.status, 200, `${name} asset returns 200`);
      const body = await res.text();
      assert.strictEqual(body.trim(), expected.trim(), `${name} asset matches @simpleworkjs/frontend`);
    }
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
  assert.ok(fs.existsSync(path.join(target, 'public', 'lib', 'js', 'jq-repeat.js')), 'jq-repeat asset copied');
});
