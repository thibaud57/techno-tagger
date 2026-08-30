import { bootstrapApplication } from '@angular/platform-browser';
import * as Sentry from '@sentry/angular';

import { App } from './app/app';
import { appConfig } from './app/app.config';

// TODO: injecter SENTRY_DSN_UI et la version au build. DSN vide = SDK inerte,
// et la release doit etre identique a celle du sidecar pour que les erreurs des
// deux cotes se croisent sur une meme livraison.
Sentry.init({
  dsn: '',
  release: '',
  environment: 'production',
  // Breadcrumbs capture la console et les interactions, donc les titres
  // affiches ; Replay capture le DOM.
  integrations: (defaults) =>
    defaults.filter((i) => i.name !== 'Breadcrumbs' && i.name !== 'Replay'),
});

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
