#!/usr/bin/env node
'use strict';

/**
 * simpleworks CLI
 *
 * Commands:
 *   npx simpleworks generate my-app [targetDir]
 */

const path = require('path');
const fs = require('fs');
const generator = require('./generator');

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`
Usage:
  npx simpleworks generate <project-name> [target-directory]

Examples:
  npx simpleworks generate my-app
  npx simpleworks generate my-app ./my-app
`);
  process.exit(1);
}

if (!command || command === 'help' || command === '--help' || command === '-h') {
  usage();
}

if (command === 'generate' || command === 'g') {
  const projectName = args[1];
  if (!projectName) {
    console.error('Error: project name is required.');
    usage();
  }

  const targetDir = args[2] || path.join(process.cwd(), projectName);
  generator.generate(projectName, targetDir);
  console.log(`Generated SimpleWorkJS app "${projectName}" at ${targetDir}`);
  console.log('Run:');
  console.log(`  cd ${targetDir}`);
  console.log('  npm install');
  console.log('  npm start');
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
usage();
