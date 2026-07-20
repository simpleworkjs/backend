/* SimpleWorkJS frontend render layer.
 *
 * Replaces elements like:
 *   <div data-sw-model="Task" data-sw-mode="table">
 * with generated Bootstrap UI bound to jq-repeat scopes.
 */

(function($){
  'use strict';

  window.app = window.app || {};

  app.render = {
    build: function(selector){
      $(selector).each(function(){
        const $el = $(this);
        const modelName = $el.data('sw-model');
        const mode = $el.data('sw-mode') || 'table';
        const pk = $el.data('sw-pk');
        const schema = app.model.schema(modelName);
        if (!schema) return console.warn('No schema for model', modelName);

        if (mode === 'table') app.render.table($el, modelName, schema);
        else if (mode === 'card') app.render.cards($el, modelName, schema);
        else if (mode === 'form') app.render.form($el, modelName, schema, pk);
      });
    },

    table: function($el, modelName, schema){
      const fields = Object.values(schema.fields).filter(function(f){ return !f.isPrivate && !f.references; });

      let html = '<div class="table-responsive"><table class="table table-striped sw-table"><thead><tr>';
      fields.forEach(function(f){ html += '<th>' + (f.display.name || f.name) + '</th>'; });
      html += '<th>Actions</th></tr></thead>';
      html += '<tbody jq-repeat="' + modelName + '" jq-index-key="' + schema.pk + '">';
      html += '<tr>';
      fields.forEach(function(f){ html += '<td>{{' + f.name + '}}</td>'; });
      html += '<td>';
      html += '<a class="btn btn-sm btn-primary me-1" href="/' + modelName + '/{{' + schema.pk + '}}">View</a>';
      html += '<a class="btn btn-sm btn-outline-primary me-1" href="/' + modelName + '/{{' + schema.pk + '}}/edit">Edit</a>';
      html += '<button class="btn btn-sm btn-danger sw-delete" data-pk="{{' + schema.pk + '}}">Delete</button>';
      html += '</td>';
      html += '</tr>';
      html += '</tbody></table></div>';

      $el.html(html);

      // jq-repeat discovers the template on the next tick.
      setTimeout(function(){
        const scope = $.scope[modelName];
        app.model.list(modelName).done(function(resp){
          scope.replace(resp.results || []);
        });
      }, 0);

      // Live refresh.
      app.pubsub.subscribe('^model:local:' + modelName + ':refresh$', function(ev){
        const scope = $.scope[modelName];
        if (scope) scope.update(ev.pk, ev.data);
      });
      app.pubsub.subscribe('^model:local:' + modelName + ':remove$', function(ev){
        const scope = $.scope[modelName];
        if (scope) scope.remove(ev.pk);
      });

      // Delete handler.
      $el.on('click', '.sw-delete', function(){
        const pk = $(this).data('pk');
        if (confirm('Delete this record?')){
          app.model.remove(modelName, pk);
        }
      });
    },

    cards: function($el, modelName, schema){
      const fields = Object.values(schema.fields).filter(function(f){ return !f.isPrivate && !f.references && f.name !== schema.display.titleField; });
      const scopeName = modelName + '-cards';

      let html = '<div class="row">';
      html += '<div class="col-md-4 mb-3" jq-repeat="' + scopeName + '" jq-index-key="' + schema.pk + '">';
      html += '<div class="card sw-card h-100">';
      html += '<div class="card-body">';
      html += '<h5 class="card-title">{{' + (schema.display.titleField || schema.pk) + '}}</h5>';
      fields.forEach(function(f){
        html += '<p class="card-text mb-1"><small class="text-muted">' + (f.display.name || f.name) + ':</small> {{' + f.name + '}}</p>';
      });
      html += '<a href="/' + modelName + '/{{' + schema.pk + '}}" class="btn btn-sm btn-primary">View</a>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
      html += '</div>';

      $el.html(html);

      setTimeout(function(){
        const scope = $.scope[scopeName];
        app.model.list(modelName).done(function(resp){
          scope.replace(resp.results || []);
        });
      }, 0);

      app.pubsub.subscribe('^model:local:' + modelName + ':refresh$', function(ev){
        const scope = $.scope[scopeName];
        if (scope) scope.update(ev.pk, ev.data);
      });
      app.pubsub.subscribe('^model:local:' + modelName + ':remove$', function(ev){
        const scope = $.scope[scopeName];
        if (scope) scope.remove(ev.pk);
      });
    },

    form: function($el, modelName, schema, pk){
      const fields = Object.values(schema.fields).filter(function(f){ return !f.isPrivate && !f.primaryKey; });
      const isCreate = !pk;

      let html = '<form class="sw-form row g-3" data-sw-form="' + modelName + '" novalidate>';
      fields.forEach(function(f){
        html += '<div class="col-md-6">';
        html += '<label class="form-label" for="' + f.name + '" data-field="' + f.name + '">' + (f.display.name || f.name) + '</label>';

        const inputName = (f.references && f.references.type === 'hasOne') ? f.foreignKey : f.name;
        if (f.references && f.references.type === 'hasOne'){
          html += '<select class="form-select" id="' + inputName + '" name="' + inputName + '" data-references="' + f.references.model + '">';
          html += '<option value="">— Select —</option>';
          html += '</select>';
        } else if (f.htmlType === 'checkbox'){
          html += '<div class="form-check">';
          html += '<input class="form-check-input" type="checkbox" id="' + f.name + '" name="' + f.name + '" value="true">';
          html += '</div>';
        } else if (f.htmlType === 'textarea'){
          html += '<textarea class="form-control" id="' + f.name + '" name="' + f.name + '" rows="3"></textarea>';
        } else {
          html += '<input class="form-control" type="' + f.htmlType + '" id="' + f.name + '" name="' + f.name + '"';
          if (f.isRequired) html += ' required';
          html += '>';
        }

        html += '</div>';
      });

      html += '<div class="col-12">';
      html += '<button type="submit" class="btn btn-primary">' + (isCreate ? 'Create' : 'Save') + '</button> ';
      html += '<a class="btn btn-outline-secondary" href="/' + modelName + '/list">Cancel</a>';
      html += '</div>';
      html += '</form>';

      $el.html(html);

      // Load related options for hasOne fields.
      $el.find('[data-references]').each(function(){
        const $sel = $(this);
        const refModel = $sel.data('references');
        app.model.list(refModel).done(function(resp){
          const refSchema = app.model.schema(refModel);
          const titleField = refSchema.display.titleField || refSchema.pk;
          (resp.results || []).forEach(function(row){
            $sel.append('<option value="' + row[refSchema.pk] + '">' + row[titleField] + '</option>');
          });
        });
      });

      // If editing, load current values.
      if (pk){
        app.model.get(modelName, pk).done(function(resp){
          const data = resp.data;
          Object.keys(data).forEach(function(key){
            const $input = $el.find('[name="' + key + '"]');
            if (!$input.length) return;
            if ($input.attr('type') === 'checkbox'){
              $input.prop('checked', !!data[key]);
            } else {
              $input.val(data[key]);
            }
          });
        });
      }

      // Submit handler.
      $el.find('form').on('submit', function(ev){
        ev.preventDefault();
        const data = app.util.formToObject($(this));
        // Coerce booleans.
        $el.find('input[type="checkbox"]').each(function(){
          data[this.name] = $(this).is(':checked');
        });

        const promise = isCreate
          ? app.model.create(modelName, data)
          : app.model.update(modelName, pk, data);

        promise.done(function(){
          window.location.href = '/' + modelName + '/list';
        }).fail(function(xhr){
          const resp = xhr.responseJSON || {};
          alert('Save failed: ' + (resp.error && resp.error.message ? resp.error.message : xhr.statusText));
        });
      });
    }
  };

})(jQuery);
