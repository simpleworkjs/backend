# @simpleworkjs/backend

Server framework for SimpleWorkJS apps. Combines Express, Socket.IO, EJS, and the `@simpleworkjs/orm-identity` ORM to give you a working backend from a single model definition.

## Features

- Auto-generated REST API with `OPTIONS` schema endpoints.
- Server-rendered Bootstrap pages (list, create, edit, detail, custom).
- WebSocket live sync for model changes.
- Built-in login/logout and RBAC permission middleware.
- `npx simpleworks` CLI to scaffold, start, migrate, and seed projects.
- See the [`demo-todo`](https://github.com/simpleworkjs/demo-todo) repo for a complete golden-path starter.

## Install

```bash
npm install @simpleworkjs/backend
```

For a full working starter, clone the [`demo-todo`](https://github.com/simpleworkjs/demo-todo) repository.

## Usage

```js
// app.js
const backend = require('@simpleworkjs/backend');
const conf = require('@simpleworkjs/conf');
const models = require('./models');

backend({conf, models}).start();
```

```js
// models/Task.js
const {Model} = require('@simpleworkjs/orm-identity');

class Task extends Model {
  static fields = {
    id: {type: 'uuid', primaryKey: true},
    title: {type: 'string', isRequired: true},
    done: {type: 'boolean', default: false},
    createdBy: {type: 'hasOne', model: 'User'},
  };

  static permissions = {
    read: ['user'],
    create: ['admin'],
    update: ['admin', 'owner'],
    delete: ['admin'],
  };
}

module.exports = Task;
```

## CLI

The CLI is pluggable and namespaced. Commands come from installed packages and from your own project. This prevents collisions between packages and lets apps add their own commands.

```bash
npx simpleworks <namespace>:<command> [args...]
```

### Built-in namespaces

| Namespace | Description |
|-----------|-------------|
| `app` | Framework commands (`generate`, `start`) |
| `orm` | ORM commands (`status`, `migrate:make`, `migrate`, `seed`) |
| `simpleworks` | CLI meta commands (`help`) |

### Aliases

For convenience the most common commands have short aliases:

| Alias | Canonical command |
|-------|-------------------|
| `generate` | `app:generate` |
| `start` | `app:start` |
| `migrate` | `orm:migrate` |
| `seed` | `orm:seed` |
| `help` | `simpleworks:help` |

### Common workflows

Generate a new project:

```bash
npx simpleworks generate my-app
cd my-app
npm install
```

Creates:

```
my-app/
  app.js
  package.json
  conf/
  models/
  routes/
  views/
  public/
  README.md
```

Check the current database schema against your models:

```bash
npx simpleworks orm:status
```

Create and run migrations:

```bash
npx simpleworks orm:migrate:make init
npx simpleworks orm:migrate
```

Run seed files from `models/seed/*.js`:

```bash
npx simpleworks seed
```

Start the app:

```bash
npx simpleworks start
# or
npm start
```

Get help for a namespace or command:

```bash
npx simpleworks help
npx simpleworks help orm
npx simpleworks help orm:migrate
```

### Adding your own commands

Add a `simpleworks` section to your project's `package.json`:

```json
{
  "name": "my-app",
  "simpleworks": {
    "namespace": "myapp",
    "commands": "./cli/commands.js"
  }
}
```

`cli/commands.js` exports a function that receives a namespace builder:

```js
module.exports = function(cli) {
  cli.command('hello', {
    description: 'Say hello',
    usage: 'simpleworks myapp:hello [name]',
    async run(ctx) {
      const name = ctx.args[0] || 'world';
      ctx.log(`Hello, ${name}!`);
    },
  });
};
```

Run it as:

```bash
npx simpleworks myapp:hello Alice
```

See [`docs/cli.md`](./docs/cli.md) for the full command context API and advanced examples.

## Factory options

| Option | Description |
|--------|-------------|
| `conf` | `@simpleworkjs/conf` object |
| `models` | App-specific Model classes |
| `pages` | Custom page router |
| `seed` | Async seed function run after sync |
| `pubsub` | Custom pub/sub instance |

## Routes and pages

When the app starts, the framework mounts:

- `/api/` — API root; lists every model and its path.
- `/api/:model` — REST API with `GET`, `POST`, `PUT`, `DELETE`, and `OPTIONS` for schema.
- `/:model/list`, `/:model/new`, `/:model/edit/:id`, `/:model/:id` — server-rendered pages.
- `/api-docs` — auto-generated, Swagger-style API reference (endpoints, permissions, schema) for every model. Requires login.
- `/login`, `/logout` — built-in session authentication.
- `/custom/*` — custom routes from `routes/` if provided.

The navigation bar is built from loaded models (`navModels`) and links to each model's list page.

### Built-in views

The generated pages render from EJS templates bundled in this package's
**`views/`** folder (`layout.ejs`, `index.ejs` — the home page —, `list.ejs`,
`edit.ejs`, `detail.ejs`, `apidocs.ejs`, `custom.ejs`, `login.ejs`, `error.ejs`).
Apps use these by default. To override them, set `conf.views.path` to your own
directory (which must then supply the full set) — otherwise the framework falls
back to the bundled `views/`.

### REST responses

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/:model` | `{results, page, pageSize, total, pageCount}` — paginated, permission-filtered list |
| `POST` | `/api/:model` | `{data: {...}}` — created record |
| `GET` | `/api/:model/:pk` | `{data: {...}}` |
| `PUT` | `/api/:model/:pk` | `{data: {...}}` — updated record |
| `DELETE` | `/api/:model/:pk` | `{data: {...}}` — deleted record |
| `OPTIONS` | `/api/:model` | schema (below) |

Every route is guarded by the model's `static permissions` via
`@simpleworkjs/orm-identity`'s `requireModelPermission` / `requireInstancePermission`
middleware. List results are additionally filtered to records the caller may read.

### Pagination

`GET /api/:model` accepts `?page` (1-based) and `?pageSize` and returns the
envelope `{results, page, pageSize, total, pageCount}`. `pageSize` defaults to
the model's `static pageSize` (or **20**) and is capped at 500:

```js
class Task extends Model {
  static pageSize = 50;   // rows per page for the list endpoint + generated UI
  static fields = {/* ... */};
}
```

```bash
GET /api/Task?page=2&pageSize=25
```

(For owner-scoped models the per-row read filter still applies to each page, so
`total` counts all rows and a page may come back partially filtered — an
accepted approximation; all-readable models are exact.)

### OPTIONS schema shape

The `OPTIONS` endpoint returns the metadata the frontend uses to build tables and forms:

```js
{
  name: 'Task',        // model name
  pk: 'id',            // primary-key field name
  display: {...},      // model-level display hints (name, titleField, pageSize, ...)
  fields: {...},       // per-field metadata (from Model.toSchema().fields)
  permissions: {...},  // required token(s) per action {read, create, update, delete}
  paths: {...},        // REST paths (from Model.toPaths())
}
```

This is exactly `Model.toSchema()` (which returns `{name, pk, display, fields}`)
plus `paths`. The bundled frontend renderer reads the field map from `.fields`.
`paths.methods` describes any exposed methods (below).

## Exposed methods

Beyond CRUD, a model can expose its own domain methods — instance **or**
static/class — as REST endpoints by declaring `static exposedMethods`. This
avoids hand-writing Express routes for actions like "invite a user to a thread"
or "search".

```js
class Thread extends Model {
  static exposedMethods = [
    // instance method  ->  POST /api/Thread/:pk/invite   (body: {username, role})
    {method: 'inviteUser', route: 'invite', verb: 'post',
     args: {from: 'body', names: ['username', 'role']},
     description: 'Invite a user to the thread'},

    // instance method  ->  GET  /api/Thread/:pk/participants
    {method: 'getParticipants', verb: 'get'},

    // params become path segments  ->  DELETE /api/Thread/:pk/users/:username
    {method: 'removeUser', route: 'users', verb: 'delete',
     args: {from: 'params', names: ['username']}, permission: 'update'},

    // static method  ->  GET /api/Thread/search?q=...
    {method: 'search', verb: 'get', args: {from: 'query', names: ['q']},
     description: 'Search threads by name'},
  ];

  async inviteUser(username, role) { /* ... */ }
  async getParticipants() { /* ... */ }
  async removeUser(username) { /* ... */ }
  static async search(q) { /* ... */ }
}
```

Whether an entry is an **instance** or a **static** method is auto-detected:
if the name exists on the prototype it mounts under `/:pk` and runs against the
loaded record (`this`); otherwise it mounts at the model root and runs against
the class. Force it with `kind: 'instance' | 'static'` if needed.

Config fields:

| Field | Default | Notes |
|-------|---------|-------|
| `method` | — (required) | Method name; must exist on the instance or the class. |
| `route` | the method name | URL segment appended to the model path. |
| `verb` | `'post'` | HTTP verb. |
| `args` | none (no-arg) | `{from: 'body' \| 'params' \| 'query', names?: [...]}`. With `names`, arguments are passed **positionally**; without, the whole source object is passed as one argument. `from: 'params'` turns each name into a `/:name` path segment. |
| `permission` | inferred from `verb` | Token(s) from the permission DSL. Default: `get→read`, `post`/`put`/`patch`→`update`, `delete→delete`. |
| `description` | `''` | Human-readable summary; surfaced in the OPTIONS `methods` metadata. |

Permission gating reuses `static permissions`: instance methods are checked at
the **instance** level (so `owner` is evaluated against the loaded record),
static methods at the **model** level. A `permission` token you haven't declared
in `static permissions` falls back to `['admin']` (deny-by-default). Handlers
respond with `{data: <return value>}`; a missing record yields `404`, an
unauthenticated caller `401`, and a forbidden one `403`.

Exposed methods are discoverable via `OPTIONS /api/:model` under
`paths.methods`, each entry `{method, route, verb, kind, args, path, permission, description}`.

## Permissions

Each model can declare `static permissions` with arrays of roles for each action:

```js
static permissions = {
  read: ['user'],
  create: ['admin'],
  update: ['admin', 'owner'],
  delete: ['admin'],
};
```

Special values:

- `'admin'` — anyone with the admin permission.
- `'user'` — any authenticated user.
- `'owner'` — the user who created the record (`createdById` match).

`static permissions` is the **default** now: on boot the framework seeds a
DB-backed access rule per model (translating those tokens into tiered grants),
and every access decision is made against that runtime policy.

### Runtime, editable access rules

Access is stored on **Roles** as `{owner, group, everyone} × {create, read,
update, delete}` grants (`entityModel` + `entityPermissions`), evaluated per
record: a caller gets the `owner` tier for records they created, otherwise the
`everyone` tier (grants cascade — an owner also gets `everyone` grants); admins
bypass. Rules are editable at runtime:

- `GET /api/_access/:model` — the model's current grants (any signed-in user).
- `PUT /api/_access/:model` — replace them (admin only); takes effect immediately.

The generated collection UI exposes this as an editable grid in the
**Permissions** modal. Seeded defaults preserve each model's original
`static permissions` behaviour until an admin changes them.

## PubSub and live sync

When a model changes, the framework publishes an event and pushes it to
connected clients over Socket.IO on the `model:event` channel:

```js
socket.on('model:event', ({model, action, pk, data}) => { /* ... */ });
// action is one of: 'create' | 'update' | 'delete'
```

The bundled [`@simpleworkjs/frontend`](https://github.com/simpleworkjs/frontend)
client re-publishes each event onto its in-browser bus under
`model:<Model>:<action>` and `model:any`, which is what drives live table/card
updates.

By default the framework uses an in-memory pub/sub bus (backed by `p2psub` if
it is installed, otherwise local-only). Provide your own `pubsub` option to
replace it — for example, to fan out across processes.

## Tests

```bash
npm test
```

For an end-to-end smoke test of the latest published packages, run:

```bash
./scripts/smoke-published.sh
```

## License

MIT
