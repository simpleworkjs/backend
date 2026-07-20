'use strict';

let P2PSub;
try {
  ({P2PSub} = require('p2psub'));
} catch (error) {
  // p2psub optional.
}

/**
 * Tiny pub/sub wrapper.
 *
 * Falls back to a local-only bus if p2psub is unavailable.
 */
class PubSub {
  constructor(config) {
    this.config = config || {};
    this.listeners = {};

    if (this.config.enabled !== false && P2PSub) {
      this.mesh = new P2PSub({});
    }
  }

  publish(topic, data) {
    if (this.mesh) {
      this.mesh.publish(topic, data);
    }
    this._localPublish(topic, data);
  }

  subscribe(pattern, listener) {
    if (this.mesh && pattern instanceof RegExp) {
      this.mesh.subscribe(pattern, listener);
    } else if (this.mesh) {
      this.mesh.subscribe(String(pattern), listener);
    }

    const key = String(pattern);
    if (!this.listeners[key]) this.listeners[key] = [];
    this.listeners[key].push(listener);

    return {
      remove: () => {
        this.listeners[key] = this.listeners[key].filter(l => l !== listener);
      },
    };
  }

  _localPublish(topic, data) {
    for (const [key, listeners] of Object.entries(this.listeners)) {
      const re = new RegExp(key);
      if (re.test(topic)) {
        for (const listener of listeners) {
          try {
            listener(data, topic);
          } catch (error) {
            console.error('PubSub listener error:', error);
          }
        }
      }
    }
  }
}

module.exports = {PubSub};
