/* SimpleWorkJS frontend sync layer.
 *
 * Listens to model:* events and publishes refresh events that app.render
 * and jq-repeat can react to.
 */

(function($){
  'use strict';

  window.app = window.app || {};

  app.sync = {
    onAny: function(listener){
      return app.pubsub.subscribe('model:any', listener);
    },

    on: function(modelName, action, listener){
      return app.pubsub.subscribe('model:' + modelName + ':' + action, listener);
    },

    init: function(){
      // When any model changes, refresh all bound scopes for that model.
      this.onAny(function(data){
        const modelName = data.model;
        const pk = data.pk;

        // Re-fetch the changed record and notify renderers.
        app.model.get(modelName, pk).done(function(resp){
          app.pubsub.publish('model:local:' + modelName + ':refresh', {
            model: modelName,
            pk: pk,
            data: resp.data,
          });
        }).fail(function(){
          // Record may have been deleted; signal removal.
          app.pubsub.publish('model:local:' + modelName + ':remove', {
            model: modelName,
            pk: pk,
          });
        });
      });
    }
  };

  app.ready(function(){
    app.sync.init();
  });

})(jQuery);
