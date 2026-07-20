/* SimpleWorkJS frontend model layer.
 *
 * Loads schemas from OPTIONS endpoints, keeps a simple in-memory cache,
 * and provides helpers to fetch model records.
 */

(function($){
  'use strict';

  window.app = window.app || {};

  app.model = {
    schemas: {},
    cache: {},
    readyCallbacks: [],
    isReady: false,

    ready: function(callback){
      if (this.isReady) return callback();
      this.readyCallbacks.push(callback);
    },

    init: function(){
      const dfd = $.Deferred();
      app.api.get('/api/').done(function(root){
        let pending = root.models.length;
        if (!pending) return finish();

        root.models.forEach(function(meta){
          app.api.options(meta.path).done(function(schemaResp){
            app.model.schemas[schemaResp.name] = schemaResp;
            app.model.cache[schemaResp.name] = {};
          }).always(function(){
            pending--;
            if (!pending) finish();
          });
        });

        function finish(){
          app.model.isReady = true;
          app.model.readyCallbacks.forEach(function(cb){ cb(); });
          dfd.resolve();
        }
      }).fail(function(){
        console.error('Failed to load model root');
        dfd.reject();
      });
      return dfd.promise();
    },

    schema: function(name){
      return this.schemas[name];
    },

    list: function(modelName, params){
      return app.api.get('/api/' + modelName, params);
    },

    get: function(modelName, pk){
      return app.api.get('/api/' + modelName + '/' + pk);
    },

    create: function(modelName, data){
      return app.api.post('/api/' + modelName, data);
    },

    update: function(modelName, pk, data){
      return app.api.put('/api/' + modelName + '/' + pk, data);
    },

    remove: function(modelName, pk){
      return app.api.del('/api/' + modelName + '/' + pk);
    },

    relatedList: function(modelName, pk, association){
      return app.api.get('/api/' + modelName + '/' + pk + '/' + association);
    }
  };

  app.ready(function(){
    app.model.init();
  });

})(jQuery);
