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

- `/api/:model` — REST API with `GET`, `POST`, `PUT`, `DELETE`, and `OPTIONS` for schema.
- `/:model/list`, `/:model/new`, `/:model/edit/:id`, `/:model/:id` — server-rendered pages.
- `/login`, `/logout` — built-in session authentication.
- `/custom/*` — custom routes from `routes/` if provided.

The navigation bar is built from loaded models (`navModels`) and links to each model's list page.

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

Unauthenticated users are denied unless the action includes the special `'*'` public flag.

## PubSub and live sync

By default the framework creates an in-memory pub/sub instance and emits model events over Socket.IO. Provide your own `pubsub` option to replace it (for example, with Redis).

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
