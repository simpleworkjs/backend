'use strict';

const {describe, it, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

describe('CLI plugin discovery', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swj-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  });

  function makePackage(parent, name, simpleworks) {
    const pkgDir = path.join(parent, name);
    fs.mkdirSync(pkgDir, {recursive: true});
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
      name,
      version: '0.1.0',
      simpleworks,
    }));
    const commandsFile = path.join(pkgDir, 'commands.js');
    fs.writeFileSync(commandsFile, `
      module.exports = function(cli) {
        cli.command('hello', {run: async () => {}});
      };
    `);
    return pkgDir;
  }

  it('loads commands from @simpleworkjs scoped packages', () => {
    const nodeModules = path.join(tmpDir, 'node_modules');
    const scopedDir = path.join(nodeModules, '@simpleworkjs');
    fs.mkdirSync(scopedDir, {recursive: true});
    makePackage(scopedDir, 'orm', {
      namespace: 'orm',
      commands: './commands.js',
    });

    const reg = new CommandRegistry();
    reg.loadFromNodeModules(nodeModules);

    const match = reg.get('orm:hello');
    assert.ok(match, 'scoped package command loaded');
    assert.strictEqual(match.canonical, 'orm:hello');
  });

  it('loads commands from unscoped packages', () => {
    const nodeModules = path.join(tmpDir, 'node_modules');
    fs.mkdirSync(nodeModules, {recursive: true});
    makePackage(nodeModules, 'my-plugin', {
      namespace: 'myplugin',
      commands: './commands.js',
    });

    const reg = new CommandRegistry();
    reg.loadFromNodeModules(nodeModules);

    const match = reg.get('myplugin:hello');
    assert.ok(match, 'unscoped package command loaded');
  });

  it('loads commands from the current project', () => {
    const projectDir = path.join(tmpDir, 'app');
    fs.mkdirSync(projectDir, {recursive: true});
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'my-app',
      simpleworks: {
        namespace: 'myapp',
        commands: './commands.js',
      },
    }));
    fs.writeFileSync(path.join(projectDir, 'commands.js'), `
      module.exports = function(cli) {
        cli.command('custom', {run: async () => {}});
      };
    `);

    const reg = new CommandRegistry();
    reg.loadFromProject(projectDir);

    const match = reg.get('myapp:custom');
    assert.ok(match, 'project command loaded');
  });

  it('follows symlinks in node_modules', () => {
    const nodeModules = path.join(tmpDir, 'node_modules');
    const scopedDir = path.join(nodeModules, '@simpleworkjs');
    const realDir = path.join(tmpDir, 'real-pkg');
    fs.mkdirSync(scopedDir, {recursive: true});

    // Create package directly at realDir root, then symlink the package name.
    fs.mkdirSync(realDir, {recursive: true});
    fs.writeFileSync(path.join(realDir, 'package.json'), JSON.stringify({
      name: 'orm',
      version: '0.1.0',
      simpleworks: {
        namespace: 'orm',
        commands: './commands.js',
      },
    }));
    fs.writeFileSync(path.join(realDir, 'commands.js'), `
      module.exports = function(cli) {
        cli.command('hello', {run: async () => {}});
      };
    `);
    fs.symlinkSync(realDir, path.join(scopedDir, 'orm'), 'dir');

    const reg = new CommandRegistry();
    reg.loadFromNodeModules(nodeModules);

    assert.ok(reg.get('orm:hello'), 'symlinked package command loaded');
  });
});
