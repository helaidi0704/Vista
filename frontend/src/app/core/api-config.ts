import { InjectionToken } from '@angular/core';

/**
 * Base URL of the VISTA backend API, without trailing slash.
 *
 * Provided via `app.config.ts` from `environment.apiBaseUrl`. Components and
 * services inject this token instead of hardcoding `/api/...` paths.
 *
 * Examples: '', 'http://localhost:8001', 'https://vista.example.com/api'
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');
