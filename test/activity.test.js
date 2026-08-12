'use strict';

const {test} = require('node:test');
const assert = require('node:assert');

const activity = require('../lib/activity');

// A stand-in for a registered model: only canAccess and create are exercised.
function fakeModel(name, canRead) {
  return {
    name,
    canAccess: (user, action, record) => canRead(user, action, record),
  };
}

function recorder() {
  const rows = [];
  return {
    rows,
    ActivityEvent: {
      create: async (data) => { rows.push(data); return data; },
    },
  };
}

test('records the shape of an event, not its payload', async function () {
  const models = recorder();
  await activity.record(models, {
    model: 'Task', action: 'create', pk: '42',
    data: {id: '42', title: 'secret plan', createdById: 'alice', apiKey: 'SHOULD-NOT-PERSIST'},
  });

  assert.strictEqual(models.rows.length, 1);
  const row = models.rows[0];
  assert.deepStrictEqual(Object.keys(row).sort(), ['action', 'actor', 'model', 'owner', 'target']);
  // Not storing bodies means history never becomes a second copy of the data,
  // retaining a deleted record's contents after it is gone.
  assert.ok(!JSON.stringify(row).includes('SHOULD-NOT-PERSIST'));
  assert.ok(!JSON.stringify(row).includes('secret plan'));
  assert.strictEqual(row.target, '42');
  assert.strictEqual(row.owner, 'alice');
});

test('the actor prefers whoever last touched the record', async function () {
  const models = recorder();
  await activity.record(models, {
    model: 'Task', action: 'update', pk: '1',
    data: {createdById: 'alice', updatedById: 'bob'},
  });
  assert.strictEqual(models.rows[0].actor, 'bob');
});

test('a placeholder actor is treated as absent', async function () {
  // A record created and never updated carries a placeholder in some apps;
  // reporting it would read as "__NONE__ added a task".
  const models = recorder();
  await activity.record(models, {
    model: 'Task', action: 'create', pk: '1',
    data: {updated_by: '__NONE__', created_by: 'alice'},
  });
  assert.strictEqual(models.rows[0].actor, 'alice');
});

test('recording its own writes is refused, so history cannot feed itself', async function () {
  // Recording an event creates a row, whose write is an event, which records
  // again — unbounded. Obvious here and baffling at 2am.
  const models = recorder();
  await activity.record(models, {model: 'ActivityEvent', action: 'create', pk: '1', data: {}});
  await activity.record(models, {model: 'ActivitySeen', action: 'update', pk: '1', data: {}});
  assert.strictEqual(models.rows.length, 0);
});

test('a malformed event is ignored rather than thrown on', async function () {
  const models = recorder();
  await activity.record(models, null);
  await activity.record(models, {});
  await activity.record(models, {model: 'Task'});
  assert.strictEqual(models.rows.length, 0);
});

test('a failing write never propagates — a model write must not fail on its history row', async function () {
  const models = {ActivityEvent: {create: async () => { throw new Error('redis down'); }}};
  await assert.doesNotReject(() => activity.record(models, {model: 'Task', action: 'create', pk: '1', data: {}}));
});

test('an app with no ActivityEvent registered simply does not record', async function () {
  await assert.doesNotReject(() => activity.record({}, {model: 'Task', action: 'create', pk: '1', data: {}}));
});

test('the feed replays through the same access check the bridge used', async function () {
  // The whole design: history is not separately authorized, it is the same
  // decision applied again.
  const seen = [];
  const models = {
    Task: fakeModel('Task', (user, action, record) => {
      seen.push({action, record});
      return record.createdById === user.id;
    }),
  };

  const routes = {};
  const app = {get: (p, h) => { routes[p] = h; }, put: (p, h) => { routes[p + ':put'] = h; }};
  models.ActivityEvent = {
    list: async () => [
      {model: 'Task', action: 'create', target: '1', actor: 'alice', owner: 'alice', createdAt: new Date()},
      {model: 'Task', action: 'create', target: '2', actor: 'bob', owner: 'bob', createdAt: new Date()},
    ],
  };
  models.ActivitySeen = {list: async () => []};

  activity.mountFeed(app, models, '/api');

  let payload = null;
  await routes['/api/activity'](
    {user: {id: 'alice'}, permissions: new Set()},
    {json: (body) => { payload = body; }},
    (e) => { throw e; }
  );

  assert.strictEqual(payload.results.length, 1, 'only the row this user may read');
  assert.strictEqual(payload.results[0].target, '1');
  assert.strictEqual(seen[0].action, 'read', 'checked as a read, exactly as the bridge does');
});

test('an event for an unregistered model is withheld', async function () {
  const routes = {};
  const app = {get: (p, h) => { routes[p] = h; }, put: () => {}};
  const models = {
    ActivityEvent: {list: async () => [{model: 'Gone', action: 'create', target: '1', createdAt: new Date()}]},
    ActivitySeen: {list: async () => []},
  };
  activity.mountFeed(app, models, '/api');

  let payload = null;
  await routes['/api/activity']({user: {id: 'a'}, permissions: new Set()}, {json: (b) => { payload = b; }}, (e) => { throw e; });
  assert.strictEqual(payload.results.length, 0);
});

test('unread counts events after the watermark, not per-item flags', async function () {
  const now = Date.now();
  const routes = {};
  const app = {get: (p, h) => { routes[p] = h; }, put: () => {}};
  const models = {
    Task: fakeModel('Task', () => true),
    ActivityEvent: {list: async () => [
      {model: 'Task', action: 'create', target: '1', createdAt: new Date(now)},
      {model: 'Task', action: 'create', target: '2', createdAt: new Date(now - 60000)},
    ]},
    ActivitySeen: {list: async () => [{userId: 'alice', seenAt: new Date(now - 30000)}]},
  };
  activity.mountFeed(app, models, '/api');

  let payload = null;
  await routes['/api/activity']({user: {id: 'alice'}, permissions: new Set()}, {json: (b) => { payload = b; }}, (e) => { throw e; });
  assert.strictEqual(payload.results.length, 2, 'history shows everything readable');
  assert.strictEqual(payload.unread, 1, 'only the one after the watermark is unread');
});

test('marking seen without a session is refused', async function () {
  const routes = {};
  const app = {get: () => {}, put: (p, h) => { routes[p] = h; }};
  activity.mountFeed(app, {ActivitySeen: {list: async () => []}}, '/api');

  let status = null;
  await routes['/api/activity/seen'](
    {body: {}},
    {status: (s) => { status = s; return {json: () => {}}; }},
    (e) => { throw e; }
  );
  assert.strictEqual(status, 401);
});

test('the models keep every write action admin-only', function () {
  // The feed route is the only intended writer; the generated REST routes must
  // not let anyone forge or rewrite history.
  for (const Model of [activity.ActivityEvent, activity.ActivitySeen]) {
    for (const action of ['create', 'update', 'delete']) {
      assert.deepStrictEqual(Model.permissions[action], ['admin'], `${Model.name}.${action}`);
    }
  }
});
