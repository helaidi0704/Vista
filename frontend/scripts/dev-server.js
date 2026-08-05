'use strict';

// Cross-platform wrapper around `ng serve`: reads UI_PORT from the repo-root .env
// (single source of truth, see ../../.env.example) instead of the dev-server port
// being hardcoded independently in package.json/angular.json, and regenerates
// public/api-config.json (see generate-api-config.js) instead of hardcoding the
// backend URL in a tracked source file.

const { spawnSync } = require('child_process');
const path = require('path');
const { resolvePort } = require('./resolve-env');
const { generateApiConfig } = require('./generate-api-config');

generateApiConfig();

const uiPort = resolvePort('UI_PORT', '4201');

const result = spawnSync(`npx ng serve --host 0.0.0.0 --port ${uiPort}`, {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  shell: true,
});
if (result.error) {
  console.error(result.error);
}
process.exit(result.status === null ? 1 : result.status);
