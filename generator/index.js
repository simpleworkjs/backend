'use strict';

/**
 * Project generator for `npx simpleworks generate`.
 */

const fs = require('fs');
const path = require('path');

function mkdirp(dir) {
  fs.mkdirSync(dir, {recursive: true});
}

function writeFile(dest, content) {
  mkdirp(path.dirname(dest));
  fs.writeFileSync(dest, content, 'utf8');
}

function copyDir(src, dest) {
  mkdirp(dest);
  for (const entry of fs.readdirSync(src, {withFileTypes: true})) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function generate(projectName, targetDir) {
  targetDir = path.resolve(targetDir);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length) {
    console.error(`Target directory ${targetDir} is not empty.`);
    process.exit(1);
  }

  // Core app files.
  writeFile(path.join(targetDir, 'package.json'), packageJson(projectName));
  writeFile(path.join(targetDir, 'app.js'), appJs());
  writeFile(path.join(targetDir, '.gitignore'), gitignore());
  writeFile(path.join(targetDir, 'README.md'), readmeMd(projectName));

  // Config.
  mkdirp(path.join(targetDir, 'conf'));
  writeFile(path.join(targetDir, 'conf', 'base.js'), confBaseJs());
  writeFile(path.join(targetDir, 'conf', 'development.js'), confDevelopmentJs());
  writeFile(path.join(targetDir, 'conf', 'secrets.js'), confSecretsJs());

  // Models.
  mkdirp(path.join(targetDir, 'models'));
  writeFile(path.join(targetDir, 'models', 'index.js'), modelsIndexJs());
  writeFile(path.join(targetDir, 'models', 'Task.js'), taskModelJs());

  // Custom routes/views/public.
  mkdirp(path.join(targetDir, 'routes'));
  mkdirp(path.join(targetDir, 'views'));
  mkdirp(path.join(targetDir, 'public'));

  // Copy default views and public assets.
  const backendDir = path.join(__dirname, '..');
  copyDir(path.join(backendDir, 'views'), path.join(targetDir, 'views'));
  copyDir(path.join(backendDir, 'public'), path.join(targetDir, 'public'));
}

function packageJson(projectName) {
  return JSON.stringify({
    name: projectName,
    version: '0.1.0',
    description: `A SimpleWorkJS app`,
    main: 'app.js',
    scripts: {
      start: 'node app.js',
      dev: 'nodemon app.js',
      test: 'node --test test/**/*.test.js',
    },
    dependencies: {
      '@simpleworkjs/backend': '^0.1.0',
      '@simpleworkjs/conf': '^1.2.0',
      '@simpleworkjs/orm-identity': '^0.1.0',
    },
    devDependencies: {
      nodemon: '^3.0.2',
    },
    engines: {
      node: '>=18.0.0',
    },
  }, null, 2) + '\n';
}

function appJs() {
  return `'use strict';

const backend = require('@simpleworkjs/backend');
const conf = require('@simpleworkjs/conf');
const models = require('./models');

const app = backend({conf, models});

app.start();
`;
}

function confBaseJs() {
  return `'use strict';

module.exports = {
  app: {
    name: 'SimpleWorkJS App',
    port: 3000,
  },

  database: {
    dialect: 'sqlite',
    storage: 'data.sqlite',
    logging: false,
  },

  redis: {
    enabled: false,
    prefix: 'swjs_app:',
  },

  ldap: {
    enabled: false,
  },

  pubsub: {
    enabled: true,
  },

  models: {
    path: 'models',
  },

  static: {
    path: 'public',
  },

  views: {
    engine: 'ejs',
    path: 'views',
  },
};
`;
}

function confDevelopmentJs() {
  return `'use strict';

module.exports = {
  app: {
    port: 3000,
  },

  database: {
    storage: 'data-dev.sqlite',
    logging: false,
  },
};
`;
}

function confSecretsJs() {
  return `'use strict';

// Keep secrets out of version control.
// This file is merged on top of base + environment configs.
module.exports = {};
`;
}

function modelsIndexJs() {
  return `'use strict';

// Export all app models in load order.
module.exports = [
  require('./Task'),
];
`;
}

function taskModelJs() {
  return `'use strict';

const {Model} = require('@simpleworkjs/orm-identity');

class Task extends Model {
  static fields = {
    id: {type: 'uuid', primaryKey: true},
    title: {type: 'string', isRequired: true, max: 200, display: {searchable: true}},
    description: {type: 'text'},
    done: {type: 'boolean', default: false},
    createdBy: {type: 'hasOne', model: 'User'},
  };

  static display = {
    name: 'Task',
    titleField: 'title',
  };

  static permissions = {
    read: ['user'],
    create: ['admin'],
    update: ['admin', 'owner'],
    delete: ['admin'],
  };
}

module.exports = Task;
`;
}

function gitignore() {
  return `node_modules/
data*.sqlite
*.log
.DS_Store
conf/secrets.js
`;
}

function readmeMd(projectName) {
  return `# ${projectName}

Generated with [SimpleWorkJS](https://github.com/wmantly/backend).

## Quick start

\`\`\`bash
npm install
npm start
# open http://localhost:3000
\`\`\`

The demo seeds an admin user:

- Username: \`admin\`
- Password: \`Changeme1!\`

## Add a model

Create a file in \`models/\` that extends \`@simpleworkjs/orm-identity\`'s \`Model\` class. The framework will auto-generate the REST API, database table, and server-rendered pages.

See the \`Task.js\` example for the field DSL and permission declarations.
`;
}

module.exports = {generate};
