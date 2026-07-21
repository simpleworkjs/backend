/* SimpleWorkJS frontend messages and confirmations.
 *
 * Exposes:
 *   app.messages.action  — inline action message inside a card/form
 *   app.messages.confirm — promise-based confirmation dialog
 *   app.messages.toast   — page-wide toast notification
 */

(function($){
  'use strict';

  window.app = window.app || {};

  app.messages = (function(){
    const TOAST_CONTAINER_ID = 'sw-toast-container';

    function ensureToastContainer(){
      let $container = $('#' + TOAST_CONTAINER_ID);
      if (!$container.length){
        $container = $(`
          <div id="${TOAST_CONTAINER_ID}" class="toast-container position-fixed top-0 end-0 p-3">
          </div>
        `);
        $('body').append($container);
      }
      return $container;
    }

    function action(message, $targetPassed, type, callback){
      message = message || '';
      type = type || 'info';
      callback = callback || function(){};

      let $target = $targetPassed.closest('div.card').find('.actionMessage');
      if (!$target.length) $target = $($targetPassed.find('.actionMessage')[0]);
      if (!$target.length){
        // Fallback to toast if no inline target exists.
        toast(message, type);
        return setTimeout(callback, 10);
      }

      if ($target.html() === message) return setTimeout(callback, 10);

      if ($target.html()){
        $target.slideUp('fast', function(){
          $target.html('');
          $target.removeClass(function(index, className){
            return (className.match(/(^|\s)bg-\S+/g) || []).join(' ');
          });
          if (message) return action(message, $target, type, callback);
          $target.hide();
        });
      } else {
        if (type) $target.addClass('bg-' + type);

        if (!message.includes('<button')){
          message += `
            <button class="action-close btn btn-sm btn-outline-dark float-end">
              <i class="fa-solid fa-xmark"></i>
            </button>
          `;
        }
        $target.html(message).slideDown('fast');
        setTimeout(callback, 10);
      }
    }

    function confirm(message, $target, type){
      type = type || 'warning';
      return new Promise(function(resolve){
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);

        const html = `
          <h4 class="align-middle">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <b>${message}</b>
            <span class="float-end">
              <button type="button" class="btn btn-success confirm-${id}" data-confirm="true">
                <i class="fa-solid fa-circle-check"></i> Confirm
              </button>
              <button type="button" class="btn btn-danger confirm-${id}">
                <i class="fa-solid fa-circle-stop"></i> Cancel
              </button>
            </span>
          </h4>
        `;
        action(html, $target, type);

        $('body').one('click', '.confirm-' + id, function(){
          action('', $target, type);
          resolve(!!$(this).data('confirm'));
        });
      });
    }

    function toast(message, type){
      type = type || 'info';
      const $container = ensureToastContainer();
      const id = 'sw-toast-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
      const $toast = $(`
        <div id="${id}" class="toast align-items-center text-bg-${type} border-0" role="alert" aria-live="assertive" aria-atomic="true">
          <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
          </div>
        </div>
      `);
      $container.append($toast);
      const bsToast = new bootstrap.Toast($toast[0]);
      bsToast.show();
      $toast.on('hidden.bs.toast', function(){ $toast.remove(); });
    }

    return {action: action, confirm: confirm, toast: toast};
  })();

  $(document).on('click', '.actionMessage .action-close', function(){
    app.messages.action('', $(this).closest('.actionMessage'));
  });

})(jQuery);
