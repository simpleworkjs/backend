/* SimpleWorkJS custom escape hatch registry.
 *
 * Register named custom initializers here, then call them from any page
 * with `app.custom.run('name')`. This keeps custom JS organized and testable.
 */

(function($){
  'use strict';

  window.app = window.app || {};

  app.custom = {
    registry: {},

    register: function(name, init){
      this.registry[name] = init;
    },

    run: function(name){
      if (this.registry[name]) this.registry[name]();
      else console.warn('No custom initializer registered:', name);
    }
  };

  // Auto-run any initializer declared on the body.
  $(function(){
    const init = $('body').data('sw-custom');
    if (init) app.custom.run(init);
  });

})(jQuery);
