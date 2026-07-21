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
    this.subscriptions = [];

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

    const entry = {pattern, listener};
    this.subscriptions.push(entry);

    return {
      remove: () => {
        this.subscriptions = this.subscriptions.filter(e => e !== entry);
      },
    };
  }

  _localPublish(topic, data) {
    for (const {pattern, listener} of this.subscriptions) {
      // Matching used to be done by stringifying the pattern (`String(/^model:/)`
      // -> "/^model:/") and reconstructing a RegExp from that string. The
      // reconstructed pattern treats the literal "/" delimiters as characters
      // to match and misplaces the "^" anchor, so it can never match any real
      // topic — every regex-pattern subscription was silently dead. Match
      // directly against the original pattern instead.
      const matches = pattern instanceof RegExp ? pattern.test(topic) : pattern === topic;
      if (matches) {
        try {
          listener(data, topic);
        } catch (error) {
          console.error('PubSub listener error:', error);
        }
      }
    }
  }
}

module.exports = {PubSub};
