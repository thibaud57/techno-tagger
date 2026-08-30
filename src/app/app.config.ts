import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import Aura from '@primeuix/themes/aura';
import * as Sentry from '@sentry/angular';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler() },
    provideRouter(routes, withComponentInputBinding()),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          // Doit rester identique au @custom-variant dark de styles.css
          darkModeSelector: '.app-dark',
          // Laisse les utilitaires Tailwind gagner sur les styles de composant
          cssLayer: { name: 'primeng', order: 'theme, base, primeng' },
        },
      },
      // TODO: passer PRIMENG_LICENSE_KEY, requise meme en Community. Le canal
      // reste a trancher : elle ne doit jamais etre commitee.
    }),
  ],
};
