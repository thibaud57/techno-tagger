import { Routes } from "@angular/router"

import { DEFAULT_TAB } from "./core/tabs"

export const routes: Routes = [
  { path: "", pathMatch: "full", redirectTo: DEFAULT_TAB },
  { path: "playlist", loadComponent: () => import("./features/playlist/playlist-page.component") },
  { path: "tagging", loadComponent: () => import("./features/tagging/tagging-page.component") },
  { path: "settings", loadComponent: () => import("./features/settings/settings-page.component") },
  // Pas de page 404 : on navigue par les onglets et personne n'y saisit
  // d'URL. Un deep-link mort ramene au premier onglet.
  { path: "**", redirectTo: DEFAULT_TAB },
]
