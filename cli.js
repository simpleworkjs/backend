#!/usr/bin/env node
'use strict';

/**
 * simpleworks CLI
 *
 * Pluggable, namespaced command runner.
 *
 * Usage:
 *   npx simpleworks app:generate my-app
 *   npx simpleworks app:start
 *   npx simpleworks orm:migrate
 *   npx simpleworks help
 */

const path = require('path');
const {CommandRegistry} = require('./lib/cli/registry');
const {buildContext} = require('./lib/cli/context');

async function main() {
  const rawArgs = process.argv.slice(2);
  const commandName = rawArgs[0];
  const args = rawArgs.slice(1);

  const registry = new CommandRegistry({defaultNamespace: 'app'});

  // 1. Commands from installed packages (includes @simpleworkjs/backend itself).
  const nodeModules = findNodeModules();
  if (nodeModules) {
    registry.loadFromNodeModules(nodeModules);
  }

  // 2. Commands from the current project (overrides package namespaces locally).
  registry.loadFromProject(process.cwd());

  // 3. Built-in help command.
  registry.namespace('simpleworks', {description: 'CLI meta commands'})
    .command('help', {
      description: 'Show help',
      usage: 'simpleworks help [namespace|namespace:command]',
      run: async function(ctx) {
        showHelp(ctx, registry);
      },
    });
  registry.alias('help', 'simpleworks:help');

  if (!commandName || commandName === '--help' || commandName === '-h') {
    showHelp(null, registry);
    process.exit(0);
  }

  const match = registry.get(commandName);
  if (!match) {
    console.error(`Unknown command: ${commandName}`);
    showHelp(null, registry);
    process.exit(1);
  }

  const flags = parseFlags(args);
  const positional = flags._;

  // Help doesn't need a full project context.
  if (match.canonical === 'simpleworks:help') {
    showHelp({args: positional}, registry);
    process.exit(0);
  }

  try {
    const ctx = await buildContext(process.cwd(), positional, flags);
    await match.meta.run(ctx);
  } catch (error) {
    console.error(`Command "${match.canonical}" failed:`, error.message);
    if (process.env.SIMPLEWORKS_DEBUG) console.error(error.stack);
    process.exit(1);
  }
}

function findNodeModules() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules');
    if (require('fs').existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

function parseFlags(args) {
  const flags = {_: []};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[arg.slice(2)] = args[++i];
      } else {
        flags[arg.slice(2)] = true;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      flags[arg.slice(1)] = true;
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function showHelp(ctx, registry) {
  const target = ctx && ctx.args[0] || null;
  const namespaces = registry.list();

  if (!target) {
    console.log('Usage: simpleworks <namespace>:<command> [args...]');
    console.log('');
    console.log('Namespaces:');
    for (const ns of namespaces) {
      console.log(`  ${ns.namespace.padEnd(12)} ${ns.description}`);
    }
    console.log('');
    console.log('Common aliases:');
    const aliases = Object.entries(registry.aliases)
      .filter(([k]) => !k.endsWith(':warned'))
      .map(([k, v]) => `  ${k.padEnd(12)} → ${v}`);
    if (aliases.length) {
      aliases.forEach(a => console.log(a));
    } else {
      console.log('  (none)');
    }
    console.log('');
    console.log('Run `simpleworks help <namespace>` or `simpleworks help <namespace>:<command>` for details.');
    return;
  }

  const match = registry.get(target);
  if (match) {
    console.log(`Command: ${match.canonical}`);
    if (match.meta.description) console.log(`Description: ${match.meta.description}`);
    if (match.meta.usage) console.log(`Usage: ${match.meta.usage}`);
    return;
  }

  const nsName = target.split(':')[0];
  const ns = namespaces.find(n => n.namespace === nsName);
  if (ns) {
    console.log(`Namespace: ${nsName}`);
    if (ns.description) console.log(`Description: ${ns.description}`);
    console.log('');
    console.log('Commands:');
    for (const cmd of ns.commands) {
      console.log(`  ${cmd.command.padEnd(20)} ${cmd.description}`);
    }
    return;
  }

  console.error(`Unknown namespace or command: ${target}`);
  process.exit(1);
}

main();
