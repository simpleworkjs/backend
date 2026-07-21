# SimpleWorkJS CLI

The `simpleworks` command is a pluggable, namespaced runner. It lets installed packages and your own app contribute commands without stepping on each other.

## How commands are discovered

When you run `npx simpleworks` inside a project, the CLI:

1. Scans `node_modules/@simpleworkjs/*/package.json` for a `simpleworks` field.
2. Scans top-level `node_modules/*` packages for the same field.
3. Loads commands from the current project's `package.json` `simpleworks` field.
4. Registers the built-in `simpleworks:help` command.

Each plugin declares a namespace. Two different packages cannot claim the same namespace; the same package can extend its own namespace across multiple modules.

```json
{
  "name": "@simpleworkjs/orm",
  "simpleworks": {
    "namespace": "orm",
    "commands": "./cli/commands.js"
  }
}
```

## Command module format

A command module exports a single function. It receives a `NamespaceBuilder` bound to the plugin's namespace.

```js
'use strict';

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

For nested command names, use colons:

```js
cli.command('migrate:make', {
  description: 'Generate a migration',
  usage: 'simpleworks orm:migrate:make [name]',
  async run(ctx) {
    // ...
  },
});
```

## Command context

Every `run` function receives a context object:

| Property | Description |
|----------|-------------|
| `ctx.cwd` | The project root directory. |
| `ctx.args` | Positional command arguments. |
| `ctx.flags` | Parsed `--key` / `--key=value` flags. |
| `ctx.pkg` | The project's `package.json` contents. |
| `ctx.conf` | Loaded `@simpleworkjs/conf` object, or `null`. |
| `ctx.paths.models` | Resolved `models/` directory. |
| `ctx.paths.migrations` | Resolved `migrations/` directory. |
| `ctx.paths.seeds` | Resolved seed directory. |
| `ctx.orm` | Initialized ORM instance with adapters. |
| `ctx.models` | Loaded model classes (including identity models). |
| `ctx.log` | `console.log` alias. |
| `ctx.error` | `console.error` alias. |
| `ctx.warn` | `console.warn` alias. |

## Aliases

Register short aliases with `registry.alias(alias, canonical)` or `cli.alias(alias, canonical)`:

```js
cli.alias('migrate', 'orm:migrate');
```

Aliases are resolved before default-namespace fallback, so `npx simpleworks migrate` maps to `orm:migrate` even though the default namespace is `app`.

## Default namespace

The registry has a `defaultNamespace` option. If a user types a bare command and no alias matches, the CLI tries `<defaultNamespace>:<command>`.

```js
const registry = new CommandRegistry({defaultNamespace: 'app'});
```

This is why `npx simpleworks start` resolves to `app:start`.

## App-defined commands example

`package.json`:

```json
{
  "name": "my-app",
  "simpleworks": {
    "namespace": "myapp",
    "commands": "./cli/commands.js"
  }
}
```

`cli/commands.js`:

```js
'use strict';

module.exports = function(cli) {
  cli.command('reset-password', {
    description: 'Reset a user password',
    usage: 'simpleworks myapp:reset-password <userName>',
    async run(ctx) {
      const [userName] = ctx.args;
      if (!userName) {
        ctx.error('Usage: simpleworks myapp:reset-password <userName>');
        process.exit(1);
      }

      const users = await ctx.models.User.list({where: {userName}});
      if (!users.length) {
        ctx.error(`User not found: ${userName}`);
        process.exit(1);
      }

      await users[0].update({password: 'Changeme1!'});
      ctx.log(`Password reset for ${userName}`);
    },
  });
};
```

## Migration workflow

1. Define or change models in `models/`.
2. Run `npx simpleworks orm:status` to see the diff.
3. Run `npx simpleworks orm:migrate:make <name>` to generate a migration.
4. Run `npx simpleworks orm:migrate` to apply pending migrations.
5. (Optional) Run `npx simpleworks seed` to execute `models/seed/*.js` files.

Migrations are tracked in a `SequelizeMeta` table.

## Seeds

Seed files live in `models/seed/` (or the path configured by `conf.orm.seedsPath`). Each file exports an `up(models)` function:

```js
// models/seed/admin.js
'use strict';

module.exports = {
  async up(models) {
    const existing = await models.User.list({where: {userName: 'admin'}});
    if (existing.length) return;

    await models.User.create({
      userName: 'admin',
      email: 'admin@example.com',
      password: 'Changeme1!',
      isAdmin: true,
      isValid: true,
    });
  },
};
```

## Help system

The CLI ships with a built-in help command:

```bash
npx simpleworks help              # list namespaces and aliases
npx simpleworks help orm          # list orm namespace commands
npx simpleworks help orm:migrate  # show usage for one command
```

Help skips building a full project context so it works even in empty directories.
