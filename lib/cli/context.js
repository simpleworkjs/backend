'use strict';

/**
 * Build the command context for SimpleWorkJS CLI commands.
 *
 * Loads the current project's package.json, resolves configuration paths,
 * and provides helpers to load the ORM and models on demand.
 */

const fs = require('fs');
const path = require('path');

async function buildContext(cwd, args, flags) {
  args = args || [];
  flags = flags || {};

  const pkgPath = path.join(cwd, 'package.json');
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};

  let conf = null;
  const confBasePath = path.join(cwd, 'conf', 'base.js');
  if (fs.existsSync(confBasePath)) {
    try {
      conf = require('@simpleworkjs/conf');
    } catch (error) {
      // conf is optional for some commands.
    }
  }

  const paths = resolvePaths(cwd, conf);
  const {orm, identityModels} = initORM(cwd, conf);

  const context = {
    cwd,
    args,
    flags,
    pkg,
    conf,
    paths,
    orm,
    log: console.log,
    error: console.error,
    warn: console.warn,
  };

  context.models = await loadModelClasses(cwd, paths.models, orm, identityModels);
  return context;
}

function resolvePaths(cwd, conf) {
  const ormConf = (conf && conf.orm) || {};
  const modelsPath = conf && conf.models && conf.models.path
    ? path.resolve(cwd, conf.models.path)
    : path.join(cwd, 'models');
  const migrationsPath = ormConf.migrationsPath
    ? path.resolve(cwd, ormConf.migrationsPath)
    : path.join(cwd, 'migrations');
  const seedsPath = ormConf.seedsPath
    ? path.resolve(cwd, ormConf.seedsPath)
    : path.join(modelsPath, 'seed');

  return {models: modelsPath, migrations: migrationsPath, seeds: seedsPath};
}

async function loadModelClasses(cwd, modelsPath, orm, identityModels) {
  if (!fs.existsSync(modelsPath)) {
    if (identityModels && identityModels.length) {
      return await orm.load([identityModels]);
    }
    return {};
  }

  const indexPath = path.join(modelsPath, 'index.js');
  let appModels = [];
  if (fs.existsSync(indexPath)) {
    appModels = require(indexPath);
  } else {
    appModels = fs.readdirSync(modelsPath)
      .filter(f => f.endsWith('.js') && f !== 'seed')
      .map(f => require(path.join(modelsPath, f)));
  }

  return await orm.load([identityModels, appModels]);
}

function resolveFromCwd(cwd, name) {
  try {
    return require(require.resolve(name, {paths: [cwd]}));
  } catch (error) {
    return require(name);
  }
}

function initORM(cwd, conf) {
  const ormIdentity = resolveFromCwd(cwd, '@simpleworkjs/orm-identity');
  const orm = new ormIdentity.ORM(conf || {orm: {dialect: 'sqlite', storage: ':memory:', logging: false}});
  const identityModels = ormIdentity.identity ? Object.values(ormIdentity.identity) : [];
  return {orm, identityModels};
}

module.exports = {buildContext};
