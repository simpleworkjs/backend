'use strict';

/**
 * SimpleWorkJS CLI command registry.
 *
 * Plugins register namespaces and commands. The registry validates namespaces,
 * resolves aliases, and dispatches invocations.
 */

const fs = require('fs');
const path = require('path');

class CommandRegistry {
  constructor(options) {
    options = options || {};
    this.namespaces = {};
    this.aliases = {};
    this.defaultNamespace = options.defaultNamespace || null;
  }

  /**
   * Register or extend a namespace.
   */
  namespace(name, opts) {
    opts = opts || {};
    const existing = this.namespaces[name];

    if (existing && existing.locked) {
      // Same plugin may extend its own locked namespace.
      if (opts.plugin && existing.plugin && opts.plugin === existing.plugin) {
        return new NamespaceBuilder(this, name);
      }
      const other = existing.plugin || 'another plugin';
      throw new Error(`Namespace collision: "${name}" is claimed by ${other}.`);
    }

    if (!existing) {
      this.namespaces[name] = {commands: {}, description: '', plugin: null, locked: false};
    }

    if (opts.description) {
      this.namespaces[name].description = opts.description;
    }
    if (opts.plugin) {
      this.namespaces[name].plugin = opts.plugin;
    }
    this.namespaces[name].locked = opts.locked || false;

    return new NamespaceBuilder(this, name);
  }

  /**
   * Register a short alias for a canonical command.
   */
  alias(short, canonical) {
    if (this.aliases[short] && this.aliases[short] !== canonical) {
      // Allow re-registering the same alias; warn on conflict but keep first.
      if (!this.aliases[short + ':warned']) {
        console.warn(`Alias "${short}" already points to "${this.aliases[short]}"; ignoring "${canonical}".`);
        this.aliases[short + ':warned'] = true;
      }
      return this;
    }
    this.aliases[short] = canonical;
    return this;
  }

  /**
   * Resolve a command string to its canonical name and handler.
   */
  get(commandName) {
    if (!commandName) return null;

    // Exact canonical match.
    const canonical = this._findCanonical(commandName);
    if (canonical) return canonical;

    // Alias match.
    if (this.aliases[commandName]) {
      return this._findCanonical(this.aliases[commandName]);
    }

    // Default namespace fallback (e.g., "generate" inside "app:" namespace
    // only if no alias exists and default namespace is set).
    if (this.defaultNamespace && !commandName.includes(':')) {
      return this._findCanonical(`${this.defaultNamespace}:${commandName}`);
    }

    return null;
  }

  _findCanonical(commandName) {
    const parts = commandName.split(':');
    const namespace = parts[0];
    const commandParts = parts.slice(1);
    const ns = this.namespaces[namespace];
    if (!ns) return null;

    // Try full depth, then progressively shorter prefixes if sub-command grouping is used.
    for (let depth = commandParts.length; depth > 0; depth--) {
      const name = commandParts.slice(0, depth).join(':');
      if (ns.commands[name]) {
        return {
          namespace,
          command: name,
          canonical: `${namespace}:${name}`,
          meta: ns.commands[name],
        };
      }
    }
    return null;
  }

  /**
   * List all registered commands grouped by namespace.
   */
  list() {
    const out = [];
    for (const [nsName, ns] of Object.entries(this.namespaces)) {
      const commands = Object.entries(ns.commands).map(([name, meta]) => ({
        namespace: nsName,
        command: name,
        canonical: `${nsName}:${name}`,
        description: meta.description || '',
      }));
      out.push({
        namespace: nsName,
        description: ns.description || '',
        commands,
      });
    }
    return out;
  }

  /**
   * Load command plugins from a directory of installed packages.
   */
  loadFromNodeModules(nodeModulesDir, options) {
    options = options || {};
    const scoped = options.scoped || '@simpleworkjs';
    const scopedDir = path.join(nodeModulesDir, scoped);
    if (fs.existsSync(scopedDir)) {
      for (const entry of fs.readdirSync(scopedDir, {withFileTypes: true})) {
        if (!isPackageDir(scopedDir, entry)) continue;
        const pkgPath = path.join(scopedDir, entry.name);
        this._loadPackagePlugin(pkgPath);
      }
    }

    // Also scan any package directly under node_modules that exposes simpleworks.commands.
    for (const entry of fs.readdirSync(nodeModulesDir, {withFileTypes: true})) {
      if (entry.name.startsWith('.') || entry.name.startsWith('@')) continue;
      if (!isPackageDir(nodeModulesDir, entry)) continue;
      const pkgPath = path.join(nodeModulesDir, entry.name);
      this._loadPackagePlugin(pkgPath);
    }
  }

  /**
   * Load commands from the current project (app).
   */
  loadFromProject(cwd) {
    const pkgPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) return;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg.simpleworks || !pkg.simpleworks.commands) return;

    const nsName = pkg.simpleworks.namespace || pkg.name || 'app';
    // App namespace overrides any package namespace in the app directory.
    this.namespace(nsName, {
      description: `Commands from ${pkg.name || 'this project'}`,
      plugin: pkg.name || 'project',
      locked: false,
    });

    this._registerModule(path.resolve(cwd, pkg.simpleworks.commands), nsName, cwd);
  }

  _loadPackagePlugin(pkgPath) {
    const pkgJsonPath = path.join(pkgPath, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (!pkg.simpleworks || !pkg.simpleworks.commands) return;

    const namespace = pkg.simpleworks.namespace || pkg.name;
    if (this.namespaces[namespace]) {
      const existing = this.namespaces[namespace];
      if (existing.locked) {
        throw new Error(`Namespace collision: "${namespace}" is claimed by both ${existing.plugin} and ${pkg.name}.`);
      }
      // Allow extending a namespace if not locked; warn if different plugin.
      if (existing.plugin && existing.plugin !== pkg.name) {
        console.warn(`Package ${pkg.name} is extending namespace "${namespace}" previously registered by ${existing.plugin}.`);
      }
    }

    this.namespace(namespace, {
      description: pkg.description || `${pkg.name} commands`,
      plugin: pkg.name,
      locked: true,
    });

    this._registerModule(path.resolve(pkgPath, pkg.simpleworks.commands), namespace, pkgPath);
  }

  _registerModule(modulePath, namespace, baseDir) {
    const resolved = baseDir
      ? require.resolve(modulePath, {paths: [baseDir]})
      : require.resolve(modulePath);
    const register = require(resolved);
    if (typeof register !== 'function') {
      throw new Error(`Command module "${modulePath}" must export a function.`);
    }
    register(new NamespaceBuilder(this, namespace));
  }
}

class NamespaceBuilder {
  constructor(registry, namespace) {
    this.registry = registry;
    this.namespace = namespace;
  }

  /**
   * Register a command in this namespace.
   */
  command(name, opts) {
    if (!opts || typeof opts.run !== 'function') {
      throw new Error(`Command "${this.namespace}:${name}" must have a run function.`);
    }
    this.registry.namespaces[this.namespace].commands[name] = {
      description: opts.description || '',
      usage: opts.usage || '',
      run: opts.run,
    };
    return this;
  }

  /**
   * Create or extend a sub-namespace.
   */
  namespace(name, opts) {
    return this.registry.namespace(name, opts);
  }

  /**
   * Register a short alias (delegates to the registry).
   */
  alias(short, canonical) {
    this.registry.alias(short, canonical);
    return this;
  }
}

function isPackageDir(parent, entry) {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    const target = fs.statSync(path.join(parent, entry.name));
    return target.isDirectory();
  }
  return false;
}

module.exports = {CommandRegistry};
