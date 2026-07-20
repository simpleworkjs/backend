'use strict';

/**
 * Server-side page helpers.
 */
function pageHelpers(models) {
  return function(req, res, next) {
    res.locals.models = models;
    res.locals.modelNames = Object.keys(models);
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
