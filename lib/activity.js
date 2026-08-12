'use strict';

const {Model} = require('@simpleworkjs/orm');

/**
 * Notification history: one row per model event that went out over the socket.
 *
 * The idea this rests on is that there is nothing to build. A notification
 * system's hard problem is "who should see this", and the socket bridge already
 * answers it — `Model.canAccess(user, 'read', record)`, per socket, per event.
 * So there is no recipient resolution here and no fan-out table: a notification
 * is an event that passed that check, and history is the same events replayed
 * through the same check.
 *
 * SHAPE ONLY: model, action, pk, actor, owner, timestamp. Deliberately no
 * payload. The feed says "something was added over here", so the body is not
 * needed — and not storing it means history never becomes a second copy of the
 * data, retaining a deleted record's contents after it is gone. `owner` is kept
 * so an owner-tier read can still be judged once the record itself is gone.
 *
 * A compliance/audit trail extends this rather than replaces it: what it adds
 * is before/after values and immutability, not a different shape.
 */
class ActivityEvent extends Model {
  static fields = {
    id: {type: 'uuid', primaryKey: true},
    model: {type: 'string', max: 100, isRequired: true},
    action: {type: 'string', max: 40, isRequired: true},
    // Primary key of the record that changed.
    target: {type: 'string', max: 500},
    // Who caused it. Kept, not suppressed — your own actions belong in your
    // history.
    actor: {type: 'string', max: 200},
    // Owner of the record, for owner-tier access checks after the fact.
    owner: {type: 'string', max: 200},
    createdAt: {type: 'date', default: () => new Date()},
  };

  // Nobody writes these through the API — they are produced by the bridge, and
  // the feed route reads them directly. Every write action is admin-only so the
  // generated REST routes cannot be used to forge history.
  static permissions = {
    read: ['admin'],
    create: ['admin'],
    update: ['admin'],
    delete: ['admin'],
  };

  static display = {name: 'Activity Event', titleField: 'model'};
}

/**
 * How far a user has read their feed. One row per user, not one per
 * notification: the unread count is "events since this timestamp that you may
 * read", which makes marking-as-read a single write and clears the badge on
 * every device at once.
 */
class ActivitySeen extends Model {
  static fields = {
    id: {type: 'uuid', primaryKey: true},
    userId: {type: 'string', max: 200, isRequired: true},
    seenAt: {type: 'date', default: () => new Date(0)},
  };

  // Written only through PUT <prefix>/activity/seen, which scopes to the
  // caller; the generated routes stay admin-only.
  static permissions = {
    read: ['admin'],
    create: ['admin'],
    update: ['admin'],
    delete: ['admin'],
  };

  static display = {name: 'Activity Seen', titleField: 'userId'};
}

// Fields a payload may carry the actor under, most specific first, and the
// owner. `__NONE__` and friends are placeholders some apps write for "not set";
// treating them as absent stops "__NONE__ added a host".
const ACTOR_FIELDS = ['updatedById', 'createdById', 'updated_by', 'created_by', 'actor'];
const OWNER_FIELDS = ['createdById', 'created_by', 'ownerId', 'owner', 'uid', 'username'];
const PLACEHOLDERS = new Set(['__NONE__', 'undefined', 'null']);

function pick(record, candidates) {
  if (!record || typeof record !== 'object') return '';
  for (const field of candidates) {
    const value = record[field];
    if (value === undefined || value === null || value === '') continue;
    if (PLACEHOLDERS.has(String(value))) continue;
    return String(value);
  }
  return '';
}

/**
 * Record an event that has just gone out over the bus.
 *
 * Best-effort by design: a model write must never fail, or wait, because its
 * history row did not save.
 *
 * ActivityEvent's own writes are skipped — otherwise recording an event creates
 * a row whose write is an event, which records again, forever. Obvious here and
 * baffling at 2am, so it is asserted in the tests too.
 */
async function record(models, event) {
  try {
    if (!event || !event.model || !event.action) return null;
    if (event.model === 'ActivityEvent' || event.model === 'ActivitySeen') return null;
    if (!models.ActivityEvent) return null;

    return await models.ActivityEvent.create({
      model: String(event.model),
      action: String(event.action),
      target: event.pk === undefined || event.pk === null ? '' : String(event.pk),
      actor: pick(event.data, ACTOR_FIELDS),
      owner: pick(event.data, OWNER_FIELDS),
    });
  } catch (error) {
    console.error('[activity] could not record', event && event.model, error.message);
    return null;
  }
}

/**
 * Mount the feed.
 *
 *   GET  <prefix>/activity       the caller's history + unread count
 *   PUT  <prefix>/activity/seen  move the watermark
 *
 * The feed replays stored events through `Model.canAccess` — the same decision
 * the socket bridge made when the event was live, so what you can read back is
 * exactly what you could have seen at the time.
 */
function mountFeed(app, models, prefix, options) {
  const limit = (options && options.limit) || 200;

  function visibleTo(user, event) {
    const Model = models[event.model];
    // A model that no longer exists, or one the caller cannot read at all.
    if (!Model) return false;
    try {
      // Shape-only history means a partial record. `owner` is what an
      // owner-tier check needs; everything else is decided by the model.
      return Model.canAccess(user, 'read', {
        createdById: event.owner || undefined,
        ownerId: event.owner || undefined,
        id: event.target || undefined,
      });
    } catch (error) {
      console.error(`[activity] read check for '${event.model}' threw:`, error.message);
      return false;
    }
  }

  function reqUser(req) {
    return req.user ? {id: req.user.id, permissions: req.permissions || new Set()} : null;
  }

  app.get(`${prefix}/activity`, async function(req, res, next) {
    try {
      const user = reqUser(req);
      const rows = await models.ActivityEvent.list({
        order: [['createdAt', 'DESC']],
        limit,
      });
      const events = rows.filter(event => visibleTo(user, event));

      let seenAt = 0;
      if (req.user && models.ActivitySeen) {
        const [seen] = await models.ActivitySeen.list({where: {userId: String(req.user.id)}, limit: 1});
        if (seen && seen.seenAt) seenAt = new Date(seen.seenAt).getTime();
      }

      res.json({
        results: events.map(e => ({
          model: e.model,
          action: e.action,
          target: e.target,
          actor: e.actor,
          created_on: new Date(e.createdAt).getTime(),
        })),
        unread: events.filter(e => new Date(e.createdAt).getTime() > seenAt).length,
        seen_at: seenAt,
      });
    } catch (error) {
      next(error);
    }
  });

  app.put(`${prefix}/activity/seen`, async function(req, res, next) {
    try {
      if (!req.user) return res.status(401).json({error: {message: 'Authentication required'}});
      const seenAt = new Date(Number(req.body && req.body.seen_at) || Date.now());
      const userId = String(req.user.id);

      const [existing] = await models.ActivitySeen.list({where: {userId}, limit: 1});
      if (existing) await existing.save({seenAt});
      else await models.ActivitySeen.create({userId, seenAt});

      res.json({results: {seen_at: seenAt.getTime()}});
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {ActivityEvent, ActivitySeen, record, mountFeed};
