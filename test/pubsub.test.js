'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {PubSub} = require('../lib/pubsub');

test('subscribing with a RegExp pattern actually matches published topics', function() {
  // Regression test: subscribe() used to key listeners by `String(pattern)`
  // (e.g. `/^model:/` -> "/^model:/") and _localPublish reconstructed a
  // RegExp from that string. `new RegExp("/^model:/")` treats the literal
  // slashes as characters to match and misplaces the "^" anchor, so it can
  // never match a real topic — every RegExp-based subscription was silently
  // dead code, including the WebSocket model-event bridge in framework.js.
  const pubsub = new PubSub({enabled: false});
  const received = [];

  pubsub.subscribe(/^model:/, (data, topic) => received.push({data, topic}));
  pubsub.publish('model:Task:create', {hello: 'world'});

  assert.strictEqual(received.length, 1);
  assert.strictEqual(received[0].topic, 'model:Task:create');
  assert.deepStrictEqual(received[0].data, {hello: 'world'});
});

test('a RegExp subscription does not fire for non-matching topics', function() {
  const pubsub = new PubSub({enabled: false});
  const received = [];

  pubsub.subscribe(/^model:/, (data, topic) => received.push(topic));
  pubsub.publish('other:Task:create', {});

  assert.strictEqual(received.length, 0);
});

test('a string pattern subscription matches by exact topic equality', function() {
  const pubsub = new PubSub({enabled: false});
  const received = [];

  pubsub.subscribe('model:Task:create', (data, topic) => received.push(topic));
  pubsub.publish('model:Task:create', {});
  pubsub.publish('model:Task:update', {});

  assert.deepStrictEqual(received, ['model:Task:create']);
});

test('remove() stops a subscription from receiving further events', function() {
  const pubsub = new PubSub({enabled: false});
  const received = [];

  const sub = pubsub.subscribe(/^model:/, (data, topic) => received.push(topic));
  pubsub.publish('model:Task:create', {});
  sub.remove();
  pubsub.publish('model:Task:update', {});

  assert.deepStrictEqual(received, ['model:Task:create']);
});

test('a throwing listener does not prevent other listeners from receiving the event', function() {
  const pubsub = new PubSub({enabled: false});
  const received = [];

  pubsub.subscribe(/^model:/, () => { throw new Error('boom'); });
  pubsub.subscribe(/^model:/, (data, topic) => received.push(topic));
  pubsub.publish('model:Task:create', {});

  assert.deepStrictEqual(received, ['model:Task:create']);
});
