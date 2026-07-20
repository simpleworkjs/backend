# @simpleworkjs/backend

Server framework for SimpleWorkJS apps. Combines Express, Socket.IO, EJS, and the `@simpleworkjs/orm-identity` ORM to give you a working backend from a single model definition.

## Features

- Auto-generated REST API with `OPTIONS` schema endpoints.
- Server-rendered Bootstrap pages (list, create, edit, detail, custom).
- WebSocket live sync for model changes.
- Built-in login/logout and RBAC permission middleware.
- `npx simpleworks generate` CLI to scaffold new projects.

## Install

```bash
npm install @simpleworkjs/backend
```

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

Generate a new project:

```bash
npx simpleworks generate my-app
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

## Factory options

| Option | Description |
|--------|-------------|
| `conf` | `@simpleworkjs/conf` object |
| `models` | App-specific Model classes |
| `pages` | Custom page router |
| `seed` | Async seed function run after sync |
| `pubsub` | Custom pub/sub instance |

## Tests

```bash
npm test
```

## License

MIT
