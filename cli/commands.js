'use strict';

/**
 * Built-in `app:` namespace commands for the SimpleWorkJS CLI.
 *
 * The namespace metadata (name, description) is declared in package.json, so
 * this module only needs to register commands within that namespace.
 */

const path = require('path');
const generator = require('../generator');

module.exports = function registerAppCommands(cli) {
  cli
    .command('generate', {
      description: 'Generate a new SimpleWorkJS app',
      usage: 'simpleworks app:generate <project-name> [target-directory]',
      run: async function(ctx) {
        const projectName = ctx.args[0];
        if (!projectName) {
          ctx.error('Error: project name is required.');
          process.exit(1);
        }
        const targetDir = ctx.args[1] || path.join(ctx.cwd, projectName);
        generator.generate(projectName, targetDir);
        ctx.log(`Generated SimpleWorkJS app "${projectName}" at ${targetDir}`);
        ctx.log('Run:');
        ctx.log(`  cd ${targetDir}`);
        ctx.log('  npm install');
        ctx.log('  npm start');
      },
    })
    .command('start', {
      description: 'Start the current SimpleWorkJS app',
      usage: 'simpleworks app:start',
      run: async function(ctx) {
        const appPath = path.join(ctx.cwd, 'app.js');
        if (!require('fs').existsSync(appPath)) {
          ctx.error(`Error: no app.js found at ${appPath}`);
          process.exit(1);
        }
        require(appPath);
      },
    });

  cli.alias('generate', 'app:generate');
  cli.alias('start', 'app:start');
};
