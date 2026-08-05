import { Injectable } from '@angular/core';

/**
 * Holds the apiBaseUrl resolved at app startup (see `app.config.ts`'s app
 * initializer). Defaults to '' (same origin) until the initializer resolves,
 * and stays '' if `public/api-config.json` is missing or unreachable.
 */
@Injectable({ providedIn: 'root' })
export class ApiConfigStore {
  apiBaseUrl = '';
}
