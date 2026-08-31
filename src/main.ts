import { bootstrapApplication } from '@angular/platform-browser';
import * as Sentry from '@sentry/angular';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { scrub } from './app/core/scrub';

// DSN vide = SDK inerte : c'est ainsi qu'on coupe la remontee en developpement.
Sentry.init({
  dsn: SENTRY_DSN_UI,
  release: `${APP_NAME}@${APP_VERSION}`,
  environment: APP_ENVIRONMENT,
  // Breadcrumbs capture la console et les interactions, donc les titres
  // affiches ; Replay capture le DOM ; CultureContext envoie locale, calendrier
  // et fuseau horaire, qui localisent grossierement l'utilisateur.
  integrations: (defaults) =>
    defaults.filter(
      (i) => i.name !== 'Breadcrumbs' && i.name !== 'Replay' && i.name !== 'CultureContext',
    ),
  // Pendant du before_send du sidecar : les chemins que le sidecar envoie dans
  // ses evenements finissent affiches, donc dans un message d'erreur.
  beforeSend: scrub,
});

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
