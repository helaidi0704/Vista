'use strict';

// Regenerates public/api-config.json's apiBaseUrl from API_PORT (repo-root .env, or
// the process environment — e.g. docker-compose's env_file), so the frontend never
// hardcodes a backend port in a git-tracked source file. This file is gitignored and
// fetched at runtime by src/app/app.config.ts's app initializer — see
// src/app/core/api-config.ts. Used by dev-server.js (bare-metal `npm start`) and by
// infra/docker/docker-compose.yml's `ui` service command (containerized dev server).
//
// Note: this project's dev server always runs with SSR active (@angular/ssr), which
// intercepts every request before Vite's own --proxy-config middleware ever sees it —
// so `ng serve --proxy-config` cannot be used to reach the backend here. A plain
// static JSON asset (this file) is unaffected by that, since it's served directly by
// Angular's assets middleware before any SSR/proxy logic runs.

const fs = require('fs');
const path = require('path');
const { resolvePort } = require('./resolve-env');

const FRONTEND_DIR = path.join(__dirname, '..');

function generateApiConfig() {
  const apiPort = resolvePort('API_PORT', '8001');
  const configFile = path.join(FRONTEND_DIR, 'public', 'api-config.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({ apiBaseUrl: `http://127.0.0.1:${apiPort}` }, null, 2) + '\n',
  );
}

module.exports = { generateApiConfig };

if (require.main === module) {
  generateApiConfig();
}
