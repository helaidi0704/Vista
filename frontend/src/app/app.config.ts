import {
  ApplicationConfig,
  PLATFORM_ID,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { provideRouter } from '@angular/router';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { routes } from './app.routes';
import { API_BASE_URL } from './core/api-config';
import { ApiConfigStore } from './core/api-config-store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideHttpClient(),
    provideAppInitializer(() => {
      // Only the browser needs this: nothing here fetches API data during the
      // initial server-render, and the client re-runs this initializer anyway
      // during hydration, resolving the real value before any component reads it.
      if (!isPlatformBrowser(inject(PLATFORM_ID))) {
        return Promise.resolve();
      }
      const store = inject(ApiConfigStore);
      return fetch('/api-config.json')
        .then((response) => (response.ok ? response.json() : null))
        .then((config: { apiBaseUrl?: string } | null) => {
          if (config && typeof config.apiBaseUrl === 'string') {
            store.apiBaseUrl = config.apiBaseUrl;
          }
        })
        .catch(() => {
          // No local override served (e.g. fresh clone, nobody ran `npm start`
          // yet) — keep ApiConfigStore's default ('', same origin).
        });
    }),
    { provide: API_BASE_URL, useFactory: () => inject(ApiConfigStore).apiBaseUrl },
  ],
};
