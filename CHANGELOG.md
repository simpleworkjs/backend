# Changelog

## 0.2.4

### Added

- **Access editor endpoint** `GET/PUT /api/:prefix/_access/:model`
  (`lib/modelRoute.js`): GET returns a model's tiered access grants; PUT
  (admin-only) writes the model's governing Role and rebuilds the policy so the
  change takes effect on the next request. The framework installs the runtime
  access policy on boot (`lib/framework.js` → `auth.installAccessPolicy`), and
  the WebSocket broadcast now scopes via the same `Model.canAccess` check as the
  REST layer. The layout exposes the current user to the client
  (`window.app.currentUser`) for the permission editor.

## 0.2.3

### Added

- **Auto-generated API reference page at `/api-docs`** (Swagger-style). Built
  from every model's `toSchema()` + `toPaths()`: a per-collection accordion
  listing the CRUD endpoints and any exposed methods (with HTTP-method badges,
  descriptions, and the required permission per endpoint) plus the field schema.
  Gated to logged-in users. New `views/apidocs.ejs` + route in `routes/pages.js`;
  added an **API** link to the nav.

## 0.2.2

### Added

- **Paginated list endpoint.** `GET /api/:model` accepts `?page` (1-based) and
  `?pageSize` (defaults to the model's `static pageSize`, else 20) and returns
  `{results, page, pageSize, total, pageCount}`. Still applies the per-row read
  permission filter (`lib/modelRoute.js`).
- **UI overhaul** (`views/layout.ejs`, `views/list.ejs`, `routes/pages.js`,
  `public/css/style.css`): sticky top nav with the menu on the right and a
  profile dropdown (Profile, Tokens, admin-only links to the identity
  collections, Log out) built from `res.locals.user` / `res.locals.isAdmin`;
  Bootstrap Icons; identity models moved out of the main nav into the profile
  Admin menu. `list.ejs` now renders the single collection-card view.

### Fixed

- **`layout.ejs` never loaded `app.messages.js`**, so the frontend's toasts and
  confirm dialogs (used by delete, form save, etc.) threw `app.messages is
  undefined`. Added the script.

## 0.2.1

### Added

- **Exposed methods** (`lib/modelRoute.js`): a model's `static exposedMethods`
  (see `@simpleworkjs/orm`) are now mounted as REST endpoints. Instance methods
  mount under `/:pk` and are gated by instance-level permission (so `owner`
  applies to the loaded record); static/class methods mount at the model root
  and are gated by model-level permission. Arguments are pulled from the body,
  route params, or query per the method's `args` config; handlers respond with
  `{data: <return value>}`. Mounted before the generic `/:pk` routes so a static
  route (e.g. `GET /search`) isn't shadowed. Exposed methods are advertised in
  the `OPTIONS` response under `paths.methods`.

## 0.2.0

### Changed

- **Bumped the `@simpleworkjs/orm`, `@simpleworkjs/orm-identity`, and
  `@simpleworkjs/frontend` ranges to `^0.2.0`** to pull in their dependency
  security updates (`bcrypt` 6, `sqlite3` 6, `uuid` 11). Added an `overrides`
  entry pinning `uuid` to `^11.1.1`. Consumers on `^0.1.x` should bump to
  `^0.2.0`.

### Fixed

- **`OPTIONS /api/:model` nested the field map under the wrong key, breaking
  every client-rendered page** (`lib/modelRoute.js`): the schema response put
  the per-field metadata under `schema`, but the browser renderer
  (`@simpleworkjs/frontend`'s `app.render`) and the server-side EJS both read
  it from `fields`. `app.render`'s `Object.values(schema.fields)` therefore
  threw a `TypeError` on every list/edit page that relied on `app.render.build()`.
  The endpoint now returns `Model.toSchema()` (`{name, pk, display, fields}`)
  plus `paths`, matching what every consumer expects. The frontend render tests
  missed this because they hand-build a fixture with a `.fields` key rather than
  exercising the real endpoint; added a backend regression test that asserts the
  `OPTIONS` body exposes `fields` (and not `schema`).
- **`npm test` was silently skipping root-level test files.** Same class of
  bug as `@simpleworkjs/orm`: `node --test test/**/*.test.js` relies on shell
  globbing, and without `bash` globstar enabled (the default), `**` only
  matches files in subdirectories, silently dropping any `test/*.test.js`
  file directly under `test/`. Changed to `node --test`.
- **WebSocket model events were broadcast to every connected socket,
  unauthenticated and unfiltered** (`lib/framework.js`): `io.emit('model:event',
  data)` sent every create/update/delete event — full serialized row data —
  to any client that opened a socket, regardless of that model's read
  permission or row ownership. Added a Socket.IO auth handshake
  (`io.use(...)`, resolving the same bearer token / cookie the REST API
  accepts) and now only forward each event to sockets whose resolved user
  passes the model's `read` permission check (including owner-scoped checks
  against the event's row data). Exposed via a new `attachSockets()` method
  on the app object (also called by `start()`).
- **The pub/sub bridge that would have carried those events was silently
  dead code** (`lib/pubsub.js`): `subscribe()` keyed listeners by
  `String(pattern)` (e.g. `String(/^model:/)` → `"/^model:/"`), and
  `_localPublish()` reconstructed a `RegExp` from that string. `new
  RegExp("/^model:/")` treats the literal `/` delimiters as characters to
  match and misplaces the `^` anchor, so the reconstructed pattern could
  never match any real topic string — every `RegExp`-based subscription,
  including the WebSocket bridge itself, silently received nothing. Fixed by
  matching directly against the original `RegExp`/string pattern instead of
  round-tripping it through `String()`.
- **Mass assignment on create/update** (`lib/modelRoute.js`): request bodies
  were passed straight to `Model.create()`/`instance.update()` with no way to
  exclude specific fields from client control. Added an opt-in
  `static protectedFields = [...]` convention on Model classes; the REST
  routes now strip those keys from the body before writing.
- **Ownership spoofing** (`lib/modelRoute.js`): `createdById` was taken from
  the client body when present (`req.body.createdById || req.user.id`),
  letting a client attribute a record to a different user. Now always
  derived from `req.user.id`.
- **IDOR on `GET /:model`** (`lib/modelRoute.js`): the route only checked
  model-level read permission before returning `Model.list()` unfiltered. For
  an owner-scoped model (e.g. `read: ['user', 'owner']`), any authenticated
  user could see every row, not just their own. The route now filters results
  through `instance.hasPermission(user, 'read')` per row.
- **Unauthenticated schema disclosure** (`lib/modelRoute.js`): `OPTIONS
  /:model` had no permission check at all, unlike every other generated
  route. Now requires `read` permission like the list/get routes.
- **Unhandled promise rejections in page routes** (`routes/pages.js`):
  `/:model/list`, `/:model/:pk/edit`, and `/:model/:pk` awaited
  `Model.list()`/`Model.get()` without a try/catch, so a thrown DB error
  bypassed Express's error handler and produced a raw crash page. Wrapped in
  try/catch with `next(error)`.

### Notes

- The built-in `User.isAdmin` / `User.isValid` fields should be marked
  `protectedFields` on the identity `User` model once `@simpleworkjs/orm-identity`
  publishes that change and this package's dependency is bumped — see that
  package's changelog.
