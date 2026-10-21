# Échec d'installation d'une mise à jour : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signaler au lancement suivant qu'une installation de mise à jour n'a pas abouti, dans la modale de mise à jour existante.

**Architecture:** Trois tâches :
- une préférence `update_attempt` (`{ from, to }`) dans `PreferencesService` ;
- `UpdateService` note la tentative avant le téléchargement, l'efface sur un téléchargement en échec, et la compare à `APP_VERSION` au démarrage pour poser `installFailed` et prévenir Sentry ;
- la modale affiche la note d'échec et « Réessayer » dans son état disponible, plus libellés et docs.

**Tech Stack:** Angular 22 (signals), `@tauri-apps/plugin-store`, ngx-translate 18, Vitest.

**Spec:** `docs/superpowers/specs/distribution-et-mise-a-jour/05-echec-installation-design.md`

## Global Constraints

- **Dépend du sub-project 02** : `UpdateService` (`state`, `update`, `check()`, `install()`, `retry()`, `download()` privé), `APP_UPDATER`, `availableUpdate()`, `failingUpdate()`, `hangingUpdate()`, `updaterStub()` de `src/fixtures/updater.ts`.
- **Version de référence** : `APP_VERSION` (constante de build, `src/build-constants.d.ts`) pour `from` à l'écriture comme à la détection. Les specs comparent à `APP_VERSION`, jamais à une version écrite en dur.
- **Signal d'une session** : la tentative est effacée dès sa lecture au démarrage, et sur un téléchargement en échec.
- **Sentry** : `CAPTURE_EXCEPTION`, une erreur au message fixe `update install did not complete`, tag `area: updater`, sans versions en extra.
- **Libellés** : ngx-translate, deux fichiers dans le même commit, une phrase par ligne (`\n`), vouvoiement, espace insécable avant `:` en français.
- **Commentaires TypeScript sans accents**, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, l'Act est l'appel testé, aucun test de plomberie (no-lib-test). Lancer par `just test-ui`, jamais `vitest` en direct.
- **Docs gouvernées par un skill** : `Skill[design-doc]` avant `docs/DESIGN.md`.
- **Gate vert à chaque commit** : `just format-ui && just lint-ui && just typecheck-ui && just test-ui`. Commits `type(scope): description`, scope `ui`.

## Review Focus

- **Téléchargement en échec dans la session** : la tentative est effacée, le relancement ne signale rien de plus (Task 2, `clears the attempt when the download fails`).
- **Application relancée dans la version visée** : rien n'est signalé, la tentative est effacée (Task 2, `reports nothing when the app runs the targeted version`).
- **Préférence éditée à la main** : une valeur mal formée vaut « aucune tentative » (Task 1, `ignores a malformed stored update attempt`).
- **Nouvelle tentative depuis la note** : « Réessayer » relance l'installation et retire la note (Task 2, `forgets the failed installation once a new attempt starts`).
- **Hors Tauri** : le store est indisponible, la lecture rend `null`, rien n'est signalé (couvert par le repli existant de `definePreference`, aucun test nouveau).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/platform/preferences.service.ts` | `UpdateAttempt`, `isUpdateAttempt`, préférence `update_attempt` |
| `src/fixtures/preferences-stub.ts` | `updateAttempt` en mémoire |
| `src/app/core/platform/update.service.ts` | Tentative notée, `installFailed`, détection au démarrage |
| `src/app/shared/components/dialogs/update-dialog.component.ts` | Note d'échec, libellé du bouton |
| `public/i18n/{fr,en}.json` | `update.installFailed` |
| `docs/DESIGN.md`, `.design-sync/NOTES.md` | Ligne « Invite de mise à jour », reste ouvert |

---

### Task 1: Préférence de la tentative d'installation

**Files:**
- Modify: `src/app/core/platform/preferences.service.ts`, `src/fixtures/preferences-stub.ts`
- Test: `src/app/core/platform/preferences.service.spec.ts`

**Interfaces:**
- Produces :
  - `export interface UpdateAttempt { readonly from: string; readonly to: string }`
  - `export const isUpdateAttempt = (stored: unknown): stored is UpdateAttempt` : objet aux deux champs `string` non vides
  - `PreferencesService.readUpdateAttempt(): Promise<UpdateAttempt | null>` et `writeUpdateAttempt(value: UpdateAttempt | null): Promise<void>`, clé `update_attempt`, défaut `null`
  - `preferencesStub({ updateAttempt })` : champ `updateAttempt: UpdateAttempt | null` (défaut `null`) avec `readUpdateAttempt` / `writeUpdateAttempt` en mémoire

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `preferences.service.spec.ts` :
- `it.each` « ignores a malformed stored update attempt » sur `{ from: "1.0.0" }`, `{ from: 1, to: "2.0.0" }`, `"1.0.0"` : `readUpdateAttempt()` rend `null`.
- Une ligne de plus dans le `it.each` « writes the %s preference under its key » : `["update_attempt", (target) => target.writeUpdateAttempt({ from: "1.0.0", to: "2.0.0" }), { from: "1.0.0", to: "2.0.0" }]`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `just test-ui`
Expected: FAIL, `readUpdateAttempt` et `writeUpdateAttempt` n'existent pas.

- [ ] **Step 3: Implémenter la préférence et le stub**

`definePreference<UpdateAttempt | null>("update_attempt", null, isUpdateAttempt)`, méthodes sur le motif de `readThresholds` / `writeThresholds`. Stub sur le motif de `thresholds`.

- [ ] **Step 4: Vérifier qu'ils passent**

Run: `just typecheck-ui && just test-ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/platform/preferences.service.ts src/app/core/platform/preferences.service.spec.ts src/fixtures/preferences-stub.ts
git commit -m "feat(ui): préférence de la tentative d'installation d'une mise à jour"
```

---

### Task 2: Tentative notée et échec détecté dans `UpdateService`

**Files:**
- Modify: `src/app/core/platform/update.service.ts`
- Test: `src/app/core/platform/update.service.spec.ts`

**Interfaces:**
- Consumes : `UpdateAttempt`, `readUpdateAttempt`, `writeUpdateAttempt`, `preferencesStub({ updateAttempt })` (Task 1).
- Produces : `UpdateService.installFailed: Signal<string | null>`, la version visée par l'installation qui n'a pas abouti, `null` sinon.

- [ ] **Step 1: Écrire les tests qui échouent**

`mount` gagne un paramètre `preferences = preferencesStub()`, fourni comme `{ provide: PreferencesService, useValue: preferences }`. Cas :
- `records the attempt before downloading` : `install()` sur `hangingUpdate()`, puis `writeUpdateAttempt` appelé avec `{ from: APP_VERSION, to: "2.0.0" }`.
- `flags a failed installation when the app still runs the version it left` : `preferencesStub({ updateAttempt: { from: APP_VERSION, to: "99.0.0" } })`, `await service.check()`, puis `installFailed()` vaut `"99.0.0"` et `captureException` est appelé avec une `Error` de message `update install did not complete` et `{ tags: { area: "updater" } }`.
- `reports nothing when the app runs the targeted version` : `{ from: "0.0.1", to: APP_VERSION }`, `check()`, puis `installFailed()` vaut `null`, `captureException` non appelé.
- `clears the attempt once read at startup` : quel que soit le cas, `writeUpdateAttempt(null)` après `check()`.
- `clears the attempt when the download fails` : `install()` sur `failingUpdate()`, puis le dernier appel de `writeUpdateAttempt` est `null`.
- `forgets the failed installation once a new attempt starts` : échec détecté, puis `install()` sur `hangingUpdate()`, puis `installFailed()` vaut `null`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `just test-ui`
Expected: FAIL, `installFailed` n'existe pas.

- [ ] **Step 3: Implémenter**

- `PreferencesService` injecté en `private readonly`, signal privé `_installFailed` exposé en `asReadonly()`.
- `check()` lit la tentative avant `lookup()` : `from === APP_VERSION` pose `_installFailed` à `to` et appelle `captureException` ; dans tous les cas `writeUpdateAttempt(null)`. Lecture et écriture ne lèvent jamais (`definePreference`).
- `download(update)` : `_installFailed` à `null`, puis `await writeUpdateAttempt({ from: APP_VERSION, to: update.version })` avant `downloadAndInstall`. Le `catch` écrit `null` en plus de son traitement actuel.

- [ ] **Step 4: Vérifier qu'ils passent**

Run: `just typecheck-ui && just test-ui`
Expected: PASS, aucun test existant cassé (les specs sans `PreferencesService` fourni tombent sur le repli du vrai service hors Tauri).

- [ ] **Step 5: Commit**

```bash
git add src/app/core/platform/update.service.ts src/app/core/platform/update.service.spec.ts
git commit -m "feat(ui): installation de mise à jour qui n'a pas abouti détectée au lancement suivant"
```

---

### Task 3: Note d'échec dans la modale, libellés et docs

**Files:**
- Modify: `src/app/shared/components/dialogs/update-dialog.component.ts`, `public/i18n/fr.json`, `public/i18n/en.json`, `docs/DESIGN.md`, `.design-sync/NOTES.md`
- Test: `src/app/shared/components/dialogs/update-dialog.component.spec.ts`

**Interfaces:**
- Consumes : `UpdateService.installFailed` (Task 2), `preferencesStub({ updateAttempt })` (Task 1).

- [ ] **Step 1: Écrire les tests qui échouent**

`mount` gagne un paramètre `preferences = preferencesStub()` fourni de la même façon (sa `check()` déclenche la détection). Cas :
- `shows the failure note and retry after an installation that did not complete` : `preferencesStub({ updateAttempt: { from: APP_VERSION, to: "2.0.0" } })`, puis la modale contient un `app-message` `severity="warn"` dont le texte contient `update.installFailed`, et `action("install")?.textContent` contient `update.retry`.
- `shows no failure note without a failed installation` : mount par défaut, aucun `app-message` dans le corps disponible, bouton à `update.install`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `just test-ui`
Expected: FAIL, aucune note rendue.

- [ ] **Step 3: Implémenter**

- `@default` du `@switch` : `@if (installFailed())`, un `app-message` `severity="warn"` en tête du corps, texte `update.installFailed`.
- Libellé du bouton : `update.retry` si `failed()` ou `installFailed()`, sinon `update.install`. `confirm()` reste inchangé : l'état « disponible » appelle `install()`.
- `public/i18n/fr.json`, sous `update` : `"installFailed": "La dernière installation n'a pas abouti.\nRéessayez, ou téléchargez l'installeur depuis la page des nouveautés."`
- `public/i18n/en.json`, sous `update` : `"installFailed": "The last installation did not complete.\nTry again, or download the installer from the release notes page."`
- `docs/DESIGN.md` (`Skill[design-doc]` d'abord), ligne « Invite de mise à jour » du Mapping : « Après une installation qui n'a pas abouti, `MessageComponent` `warn` en tête et « Réessayer » à la place d'« Installer » ».
- `.design-sync/NOTES.md` § Reste ouvert : « **`AppShell`** : note d'échec d'installation de l'invite de mise à jour, livrée par le code, absente de la maquette (constaté le 2026-10-21). »

- [ ] **Step 4: Vérifier qu'ils passent**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/shared/components/dialogs/update-dialog.component.ts src/app/shared/components/dialogs/update-dialog.component.spec.ts public/i18n/fr.json public/i18n/en.json docs/DESIGN.md .design-sync/NOTES.md
git commit -m "feat(ui): note d'échec d'installation et Réessayer dans la modale de mise à jour"
```
