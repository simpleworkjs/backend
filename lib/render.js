'use strict';

/**
 * Server-side page helpers.
 */
function pageHelpers(models) {
  return function(req, res, next) {
    res.locals.models = models;
    res.locals.modelNames = Object.keys(models);
    res.locals.navModels = Object.values(models).map(function(m) {
      return {
        name: m.name,
        display: m.toSchema().display,
      };
    });
    next();
  };
}

function modelForName(models, name) {
  return models[name];
}

module.exports = {
  pageHelpers,
  modelForName,
};
