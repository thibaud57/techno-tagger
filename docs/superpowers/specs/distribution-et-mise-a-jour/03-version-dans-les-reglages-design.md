---
feature: "Feature 8 : Distribution et mise à jour"
subproject: "version-dans-les-reglages"
goal: "Afficher dans les Réglages la version installée de l'application et permettre de lancer à la main la recherche d'une mise à jour"
status: "implemented"
complexity: "S"
tdd_scope: "partial"
depends_on: ["02-invite-de-mise-a-jour-design.md"]
date: "2026-10-15"
---

# Version dans les Réglages

## Scope

Couvre :
- une rangée « Version », dernière de la section Administration : la version installée en aide, un bouton « Rechercher une mise à jour » ;
- `UpdateService.checkNow()`, qui ouvre la modale du sub-project 02 sur une mise à jour trouvée ou déjà connue ;
- un retour sous la rangée quand rien de plus récent n'existe ou que la vérification échoue ;
- les libellés FR/EN.

Exclut :
- toute nouvelle section ;
- les notes de version ;
- une vérification automatique hors du démarrage ;
- tout changement de la modale elle-même.

### État livré

À la fin de ce sub-project, on peut ouvrir Réglages > Administration et lire la version installée. Le clic sur « Rechercher une mise à jour » ouvre la modale si une version plus récente est publiée, ou affiche sous la rangée « à jour » ou l'échec. Le tout est montré par les specs Vitest, l'updater remplacé par un faux.

## Dependencies

- `02-invite-de-mise-a-jour-design.md` (statut: draft) : `UpdateService`, `APP_UPDATER`, les fixtures `availableUpdate` et `updaterStub`, plus la modale qu'ouvre une mise à jour trouvée.

Hors feature :
- la section Administration, `SettingsRowComponent`, les rangées Cache et Logs et le `mountWith(overrides, section)` de son spec, livrés par la Feature 7 (sub-projects `langue-et-signal-sonore` et `administration-cache-et-logs`).

## Références de design

- **Maquette** : `SettingsScreen`, section Administration. La rangée Version n'y figure pas, elle reprend le motif des rangées à bouton seul : aide à gauche, bouton `secondary` outlined à droite, retour dessous.
- **Design system** : `components/forms/SettingsRow.prompt.md`, `components/forms/Button.prompt.md`, `components/feedback/Message.prompt.md`
- Règle de lecture : `.claude/rules/design/claude-design.md`

Décision du propriétaire (2026-10-15) : rangée en dernière position d'Administration. Elle suit l'arbitrage « Rangée de Réglages » (libellé seul à gauche, aide avec le contrôle). La ligne d'arbitrage correspondante rejoint `docs/DESIGN.md`.

## Files touched

- **À modifier** : `src/app/core/platform/update.service.ts` (`checkNow()`) et `update.service.spec.ts`
- **À modifier** : `src/app/features/settings/settings-page.component.ts`, `settings-page.component.html`, `settings-page.component.spec.ts` (rangée Version)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`settings.admin.version`)
- **À modifier** : `docs/DESIGN.md` (rangées des Réglages, ligne d'arbitrage)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : rangée absente de `SettingsScreen`)

## Architecture approach

- **`checkNow()` sur `UpdateService`** (`.claude/rules/angular/services.md`) :
  - Une mise à jour déjà connue (badge présent, échec affiché) rouvre la modale sans nouvelle vérification.
  - Sinon, l'updater est interrogé : une mise à jour trouvée passe en état disponible et la modale s'ouvre.
  - Le résultat (« trouvée », « à jour », « échec ») revient à l'appelant pour le retour de la rangée. L'état du service ne porte que la mise à jour.
  - Un échec n'envoie rien à Sentry, comme la vérification du démarrage.
- **Recherche permise pendant un travail** : elle ne ferme rien. La modale garde « Installer » désactivé tant que `SidecarService.phase()` n'est pas `idle` (sub-project 02).
- **Rangée** dans le `@case ("admin")` de `settings-page.component.html`, après Runs passés :
  - `app-settings-row` sur le motif des rangées Cache et Logs.
  - L'aide `text-xs text-muted-color` porte la version issue de `APP_VERSION`, la constante de build déjà lue par `SidecarService` pour le contrôle de version.
  - Le bouton est `size="small"` `secondary` outlined, icône `refresh`, `spinner` et désactivé pendant la recherche (DESIGN.md § Actions).
  - Le retour est un `app-message` `size="small"` en projection par défaut de la rangée : success « à jour », error « échec ». Il est effacé au clic suivant.
  - L'état du retour vit dans le composant, un signal local, perdu en quittant la section.
- **Libellés** : `settings.admin.version.{label,installed,action,upToDate,failed}`, une phrase par ligne (`.claude/rules/ngx-translate/i18n.md`).
- Rules applicables : `.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`, `.claude/rules/angular/components.md`, `.claude/rules/angular/tests.md`, `.claude/rules/primeng/composants.md`, `.claude/rules/tailwindcss/utilitaires.md`, `.claude/rules/ngx-translate/i18n.md`, `.claude/rules/design/claude-design.md`.

## Acceptance criteria

### Scénario 1 : version installée
**GIVEN** l'application installée en version 1.0.0
**WHEN** l'utilisateur ouvre Réglages > Administration
**THEN** la rangée Version indique « Version 1.0.0 installée »

### Scénario 2 : mise à jour trouvée
**GIVEN** une version plus récente publiée
**WHEN** l'utilisateur clique « Rechercher une mise à jour »
**THEN** la modale « Mise à jour disponible » s'ouvre
**AND** aucun retour ne s'affiche sous la rangée

### Scénario 3 : mise à jour déjà connue
**GIVEN** une mise à jour trouvée au démarrage puis reportée au badge
**WHEN** l'utilisateur clique « Rechercher une mise à jour »
**THEN** la modale se rouvre sans nouvelle vérification

### Scénario 4 : application à jour
**GIVEN** aucune version plus récente publiée
**WHEN** l'utilisateur clique « Rechercher une mise à jour »
**THEN** « Vous utilisez la dernière version. » s'affiche sous la rangée

### Scénario 5 : vérification impossible
**GIVEN** une vérification qui échoue (hors ligne, manifeste en 404)
**WHEN** l'utilisateur clique « Rechercher une mise à jour »
**THEN** le message d'échec s'affiche sous la rangée
**AND** aucun événement Sentry n'est envoyé

### Scénario 6 : recherche en cours
**GIVEN** une vérification qui n'a pas encore répondu
**WHEN** l'utilisateur regarde la rangée
**THEN** le bouton est désactivé et porte le `spinner`

## Tests à écrire

### Unit
- `src/app/core/platform/update.service.spec.ts` :
  - rend « à jour » quand la recherche manuelle ne trouve rien
  - ouvre la modale sur une mise à jour trouvée par la recherche manuelle
  - rend « échec » sans Sentry quand la recherche manuelle échoue
  - rouvre une mise à jour déjà connue sans nouvelle vérification
- `src/app/features/settings/settings-page.component.spec.ts` :
  - affiche la version installée dans la rangée Version
  - affiche « à jour » après une recherche qui ne trouve rien
  - affiche l'échec après une recherche en échec
  - n'affiche aucun retour quand une mise à jour est trouvée
  - désactive le bouton pendant la recherche

## Edge cases

- **Clic pendant la recherche** : le bouton est désactivé, une seule vérification part.
- **Retour périmé** : un nouveau clic efface le retour précédent avant la vérification.
- **Hors Tauri (`ng serve`)** : la vérification lève, la rangée affiche l'échec, ce qui est exact.
- **Mise à jour en échec de téléchargement** : connue du service, elle rouvre la modale sur son échec et « Réessayer ».
