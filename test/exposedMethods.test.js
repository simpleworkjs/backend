'use strict';

const test = require('node:test');
const assert = require('node:assert');
const backend = require('..');
const {Model, auth} = require('@simpleworkjs/orm-identity');

function makeConf() {
  return {
    app: {name: 'Exposed Methods Test', port: 0},
    database: {dialect: 'sqlite', storage: ':memory:', logging: false},
  };
}

// A model exercising both instance and static exposed methods, with an
// owner-gated `update` action so the permission wiring is covered too.
class Widget extends Model {
  static fields = {
    id: {type: 'uuid', primaryKey: true},
    name: {type: 'string', isRequired: true},
    count: {type: 'int', default: 0},
    createdBy: {type: 'hasOne', model: 'User'},
  };

  static permissions = {
    read: ['user'],
    create: ['user'],
    update: ['owner'],
    delete: ['owner'],
  };

  static exposedMethods = [
    // instance, verb post -> requires 'update' (owner-only here)
    {method: 'bump', route: 'bump', verb: 'post', args: {from: 'body', names: ['by']}},
    // instance, params-sourced arg becomes a path segment
    {method: 'rename', route: 'name', verb: 'put', args: {from: 'params', names: ['newName']}},
    // instance, verb get -> requires 'read' (any user)
    {method: 'ping', verb: 'get'},
    // static, verb get -> requires 'read'
    {method: 'summary', route: 'summary', verb: 'get', description: 'Widget totals'},
  ];

  async bump(by) {
    const next = (this.count || 0) + Number(by || 1);
    await this.update({count: next});
    return {count: next};
  }

  async rename(newName) {
    await this.update({name: newName});
    return {name: newName};
  }

  async ping() {
    return {pong: this.id};
  }

  static async summary() {
    const all = await this.list({});
    return {total: all.length};
  }
}

function listen(server) {
  return new Promise(function(resolve, reject) {
    server.listen(0, function(err) {
      if (err) return reject(err);
      resolve(server.address().port);
    });
  });
}

async function setup() {
  const app = backend({conf: makeConf(), models: [Widget]});
  const models = await app.init();
  const port = await listen(app.http);
  const base = `http://localhost:${port}`;

  const alice = await models.User.create({userName: 'alice', email: 'a@e.com', password: 'Wonderland1!'});
  const bob = await models.User.create({userName: 'bob', email: 'b@e.com', password: 'Builder1!'});
  const aliceToken = await auth.issueAuthToken(alice, models, 'test');
  const bobToken = await auth.issueAuthToken(bob, models, 'test');

  // Alice owns the widget.
  const widget = await models.Widget.create({name: 'gizmo', count: 0, createdById: alice.id});

  function headers(token) {
    return {Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json'};
  }

  return {app, models, base, alice, bob, aliceToken, bobToken, widget, headers};
}

test('instance method: owner can call, mutating and returning {data}', async function() {
  const {app, base, aliceToken, widget, headers} = await setup();
  try {
    const res = await fetch(`${base}/api/Widget/${widget.id}/bump`, {
      method: 'POST', headers: headers(aliceToken), body: JSON.stringify({by: 3}),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.count, 3);

    // Confirm the mutation actually persisted (not just echoed back).
    const check = await fetch(`${base}/api/Widget/${widget.id}`, {headers: headers(aliceToken)});
    assert.strictEqual((await check.json()).data.count, 3);
  } finally {
    await app.close();
  }
});

test('instance method: non-owner is forbidden (403), unauthenticated is 401', async function() {
  const {app, base, bobToken, widget, headers} = await setup();
  try {
    const forbidden = await fetch(`${base}/api/Widget/${widget.id}/bump`, {
      method: 'POST', headers: headers(bobToken), body: JSON.stringify({by: 1}),
    });
    assert.strictEqual(forbidden.status, 403);

    const anon = await fetch(`${base}/api/Widget/${widget.id}/bump`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({by: 1}),
    });
    assert.strictEqual(anon.status, 401);
  } finally {
    await app.close();
  }
});

test('instance method: params-sourced arg is taken from the path segment', async function() {
  const {app, base, aliceToken, widget, headers} = await setup();
  try {
    const res = await fetch(`${base}/api/Widget/${widget.id}/name/renamed`, {
      method: 'PUT', headers: headers(aliceToken),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.name, 'renamed');
  } finally {
    await app.close();
  }
});

test('instance method with read permission is callable by any authenticated user', async function() {
  const {app, base, bobToken, widget, headers} = await setup();
  try {
    const res = await fetch(`${base}/api/Widget/${widget.id}/ping`, {headers: headers(bobToken)});
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.pong, widget.id);
  } finally {
    await app.close();
  }
});

test('instance method on a missing record returns 404', async function() {
  const {app, base, aliceToken, headers} = await setup();
  try {
    const res = await fetch(`${base}/api/Widget/00000000-0000-4000-8000-000000000000/ping`, {
      headers: headers(aliceToken),
    });
    assert.strictEqual(res.status, 404);
  } finally {
    await app.close();
  }
});

test('static method is mounted at the model root and not shadowed by /:pk', async function() {
  const {app, base, aliceToken, headers} = await setup();
  try {
    const res = await fetch(`${base}/api/Widget/summary`, {headers: headers(aliceToken)});
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.total, 1);
  } finally {
    await app.close();
  }
});

test('OPTIONS advertises exposed methods with path, verb, kind, and description', async function() {
  const {app, base, aliceToken, headers} = await setup();
  try {
    const res = await fetch(`${base}/api/Widget`, {method: 'OPTIONS', headers: headers(aliceToken)});
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const methods = body.paths.methods;
    assert.ok(Array.isArray(methods));

    const summary = methods.find(m => m.method === 'summary');
    assert.strictEqual(summary.kind, 'static');
    assert.strictEqual(summary.verb, 'get');
    assert.strictEqual(summary.path, '/Widget/summary');
    assert.strictEqual(summary.description, 'Widget totals');

    const bump = methods.find(m => m.method === 'bump');
    assert.strictEqual(bump.kind, 'instance');
    assert.strictEqual(bump.path, '/Widget/:id/bump');

    const rename = methods.find(m => m.method === 'rename');
    assert.strictEqual(rename.path, '/Widget/:id/name/:newName');
  } finally {
    await app.close();
  }
});
