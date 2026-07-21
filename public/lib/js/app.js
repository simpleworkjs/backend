/* SimpleWorkJS frontend base.
 *
 * Exposes:
 *   app.api       — jQuery AJAX wrapper
 *   app.pubsub    — in-browser pub/sub bus
 *   app.socket    — Socket.IO client
 *   app.util      — small utilities
 *   app.ready     — queue callbacks after DOM + socket are ready
 */

(function($){
  'use strict';

  window.app = window.app || {};

  app.api = {
    get: function(path, data){ return $.ajax({url: path, method: 'GET', data: data, dataType: 'json'}); },
    options: function(path){ return $.ajax({url: path, method: 'OPTIONS', dataType: 'json'}); },
    post: function(path, data){ return $.ajax({url: path, method: 'POST', contentType: 'application/json', data: JSON.stringify(data), dataType: 'json'}); },
    put: function(path, data){ return $.ajax({url: path, method: 'PUT', contentType: 'application/json', data: JSON.stringify(data), dataType: 'json'}); },
    del: function(path){ return $.ajax({url: path, method: 'DELETE', dataType: 'json'}); },
  };

  app.pubsub = {
    listeners: {},
    subscribe: function(pattern, listener){
      const key = String(pattern);
      if (!this.listeners[key]) this.listeners[key] = [];
      this.listeners[key].push(listener);
      return {
        remove: function(){
          app.pubsub.listeners[key] = app.pubsub.listeners[key].filter(function(l){ return l !== listener; });
        }
      };
    },
    publish: function(topic, data){
      Object.keys(this.listeners).forEach(function(key){
        const re = new RegExp(key);
        if (re.test(topic)){
          app.pubsub.listeners[key].forEach(function(listener){
            try { listener(data, topic); } catch(e) { console.error(e); }
          });
        }
      });
    }
  };

  app.socket = null;
  app.onReady = [];

  app.ready = function(callback){
    if (app.isReady) return callback();
    app.onReady.push(callback);
  };

  app.util = {
    capitalize: function(s){ return s.charAt(0).toUpperCase() + s.slice(1); },
    uuid: function(){
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    },
    formToObject: function($form){
      const obj = {};
      $form.serializeArray().forEach(function(item){
        if (obj[item.name] !== undefined){
          if (!Array.isArray(obj[item.name])) obj[item.name] = [obj[item.name]];
          obj[item.name].push(item.value);
        } else {
          obj[item.name] = item.value;
        }
      });
      return obj;
    }
  };

  $(function(){
    if (typeof io !== 'undefined') {
      app.socket = io();
      app.socket.on('model:event', function(data){
        app.pubsub.publish('model:' + data.model + ':' + data.action, data);
        app.pubsub.publish('model:any', data);
      });
    }

    app.isReady = true;
    app.onReady.forEach(function(cb){ cb(); });
  });

})(jQuery);
