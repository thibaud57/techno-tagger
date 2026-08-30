import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'playlist' },
  { path: 'playlist', loadComponent: () => import('./features/playlist/playlist-page') },
  { path: 'tagging', loadComponent: () => import('./features/tagging/tagging-page') },
  { path: 'settings', loadComponent: () => import('./features/settings/settings-page') },
  // Pas de page 404 : l'application a trois onglets et personne n'y saisit
  // d'URL. Un deep-link mort ramene au premier onglet.
  { path: '**', redirectTo: 'playlist' },
];
