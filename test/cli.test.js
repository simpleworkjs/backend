'use strict';

const {describe, it} = require('node:test');
const assert = require('node:assert');
const {CommandRegistry} = require('../lib/cli/registry');

describe('CLI registry', () => {
  it('registers namespaced commands', () => {
    const reg = new CommandRegistry();
    reg.namespace('app', {description: 'App commands'})
      .command('start', {run: async () => {}});

    const match = reg.get('app:start');
    assert.ok(match);
    assert.strictEqual(match.canonical, 'app:start');
  });

  it('resolves aliases to canonical commands', () => {
    const reg = new CommandRegistry();
    reg.namespace('app', {description: 'App commands'})
      .command('generate', {run: async () => {}});
    reg.alias('generate', 'app:generate');

    const match = reg.get('generate');
    assert.ok(match);
    assert.strictEqual(match.canonical, 'app:generate');
  });

  it('uses default namespace for bare commands', () => {
    const reg = new CommandRegistry({defaultNamespace: 'app'});
    reg.namespace('app', {description: 'App commands'})
      .command('start', {run: async () => {}});

    const match = reg.get('start');
    assert.ok(match);
    assert.strictEqual(match.canonical, 'app:start');
  });

  it('lists all registered commands', () => {
    const reg = new CommandRegistry();
    reg.namespace('app', {description: 'App commands'})
      .command('start', {run: async () => {}})
      .command('generate', {run: async () => {}});
    reg.namespace('orm', {description: 'ORM commands'})
      .command('migrate', {run: async () => {}});

    const list = reg.list();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list.find(n => n.namespace === 'app').commands.length, 2);
    assert.strictEqual(list.find(n => n.namespace === 'orm').commands.length, 1);
  });

  it('throws on namespace collision between different plugins', () => {
    const reg = new CommandRegistry();
    reg.namespace('db', {description: 'DB', plugin: 'pkg-a', locked: true});
    assert.throws(
      () => reg.namespace('db', {description: 'DB', plugin: 'pkg-b', locked: true}),
      /Namespace collision/
    );
  });

  it('allows the same plugin to extend its own namespace', () => {
    const reg = new CommandRegistry();
    reg.namespace('db', {description: 'DB', plugin: 'pkg-a', locked: true});
    assert.doesNotThrow(() => reg.namespace('db', {description: 'DB', plugin: 'pkg-a', locked: true}));
  });
});
