import { InjectionToken } from '@angular/core';

/**
 * Base URL of the VISTA backend API, without trailing slash.
 *
 * Provided via `app.config.ts` from `public/api-config.json`, fetched at app
 * startup (see `ApiConfigStore`) instead of being baked into a tracked source
 * file — that JSON is gitignored and regenerated per developer/environment by
 * `frontend/scripts/generate-api-config.js`. Components and services inject
 * this token instead of hardcoding `/api/...` paths.
 *
 * Examples: '', 'http://localhost:8001', 'https://vista.example.com/api'
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');
