---
feature: "Feature 8 : Distribution et mise à jour"
subproject: "echec-installation"
goal: "Signaler au lancement suivant qu'une installation de mise à jour n'a pas abouti, dans la modale de mise à jour existante"
status: "implemented"
complexity: "S"
tdd_scope: "partial"
depends_on: ["02-invite-de-mise-a-jour-design.md"]
date: "2026-10-21"
---

# Échec d'installation d'une mise à jour

## Scope

Sous Windows, le plugin updater lance l'installeur NSIS puis ferme l'application sans attendre : un échec de l'installeur (fichier verrouillé, antivirus, Smart App Control, disque plein) passe inaperçu ([plugins-workspace#3514](https://github.com/tauri-apps/plugins-workspace/issues/3514)). Ce sub-project note la version visée avant l'installation et, au lancement suivant, signale l'échec dans la modale « Mise à jour disponible ».

Exclut : toute nouvelle modale, tout lien autre que « Voir les nouveautés », une nouvelle tentative automatique. Ne protège que les mises à jour lancées depuis une version qui contient ce code : celle de la 0.10.0 vers la suivante n'en profite pas.

### État livré

À la fin de ce sub-project, on peut simuler dans les specs Vitest une installation lancée depuis 1.0.0 vers 2.0.0 puis un relancement toujours en 1.0.0 : la modale affiche la note d'échec et « Réessayer ».

## Dependencies

- `02-invite-de-mise-a-jour-design.md` (statut: implemented) : `UpdateService`, la modale, le badge, `APP_UPDATER` et les fixtures `availableUpdate` / `updaterStub`.

## Références de design

- **Maquette** : `AppShell`, invite de mise à jour. La note d'échec n'y figure pas : elle rejoint `.design-sync/NOTES.md` § Reste ouvert.
- **Design system** : `components/overlay/Dialog.prompt.md`, `components/feedback/Message.prompt.md`
- Règle de lecture : `.claude/rules/design/claude-design.md`

Décision du propriétaire (2026-10-21) : la note vit dans la modale habituelle (option A du brainstorming), pas dans une modale dédiée, un badge ou un toast.

## Files touched

- **À modifier** : `src/app/core/platform/preferences.service.ts` et `preferences.service.spec.ts` (préférence de la tentative d'installation)
- **À modifier** : `src/fixtures/preferences-stub.ts` (la nouvelle préférence)
- **À modifier** : `src/app/core/platform/update.service.ts` et `update.service.spec.ts` (tentative notée, échec détecté)
- **À modifier** : `src/app/shared/components/dialogs/update-dialog.component.ts` et `update-dialog.component.spec.ts` (note d'échec, libellé du bouton)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`update.installFailed`)
- **À modifier** : `docs/DESIGN.md` (ligne « Invite de mise à jour » du Mapping)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert)

## Architecture approach

- **Tentative notée** : `UpdateService` écrit `{ from, to }` (version installée, version visée) par `PreferencesService` juste avant `downloadAndInstall`, sur « Installer » comme sur « Réessayer ». L'écriture est attendue : l'application se ferme à l'installation. Un téléchargement qui échoue dans la session efface la tentative : l'échec est déjà affiché et capturé, le relancement ne doit pas le redire.
- **Préférence** : une clé de plus dans `preferences.json`, sur le motif de `definePreference`, avec un garde de type comme `isThresholds` (`.claude/rules/angular/services.md`).
- **Échec détecté au démarrage**, dans `check()` avant la vérification, une seule fois par lancement :
  - version de l'application (`APP_VERSION`) égale à `from` : l'installation n'a pas abouti. Le service expose la version visée en signal (`installFailed`), que la modale lit même si la recherche des Réglages l'a ouverte avant. Il envoie par `CAPTURE_EXCEPTION` une erreur au message fixe, sans versions en extra (la release Sentry porte déjà la version), tag `area: updater` (`.claude/rules/sentry/angular.md`) ;
  - toute autre version : rien à signaler ;
  - dans les deux cas la préférence est effacée : le signal vaut pour la session.
- **Modale** : quand `installFailed` est posé, l'état « disponible » (`@default` du gabarit) porte un `app-message` `warn` en tête du corps, et « Réessayer » à la place d'« Installer ». Le clic remet `installFailed` à `null` : la nouvelle tentative a son propre suivi (téléchargement, échec). Le reste est inchangé : « Voir les nouveautés » mène à la page de la version, où se trouve l'installeur.
- **Libellés** : `update.installFailed`, une phrase par ligne (`.claude/rules/ngx-translate/i18n.md`).
- Rules applicables : `.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`, `.claude/rules/angular/components.md`, `.claude/rules/angular/tests.md`, `.claude/rules/sentry/angular.md`, `.claude/rules/ngx-translate/i18n.md`, `.claude/rules/primeng/composants.md`.

## Acceptance criteria

### Scénario 1 : installation qui n'a pas abouti
**GIVEN** une installation lancée depuis 1.0.0 vers 2.0.0
**WHEN** l'application redémarre toujours en 1.0.0 et trouve une mise à jour
**THEN** la modale « Mise à jour disponible » affiche en tête « La dernière installation n'a pas abouti. » avec le geste à faire
**AND** son bouton principal est « Réessayer »
**AND** un événement Sentry tagué `area: updater` part

### Scénario 2 : installation réussie
**GIVEN** une installation lancée depuis 1.0.0 vers 2.0.0
**WHEN** l'application redémarre en 2.0.0
**THEN** rien n'est signalé et la tentative notée est effacée

### Scénario 3 : la tentative est notée avant l'installation
**GIVEN** une mise à jour 2.0.0 proposée à une application en 1.0.0
**WHEN** l'utilisateur clique « Installer » ou « Réessayer »
**THEN** `{ from: "1.0.0", to: "2.0.0" }` est écrit avant le téléchargement

### Scénario 4 : signal d'une session
**GIVEN** un échec signalé au démarrage
**WHEN** l'application redémarre une seconde fois sans nouvelle tentative
**THEN** la modale ne porte plus la note d'échec

## Tests à écrire

Les versions des scénarios sont illustratives : les specs partent de `APP_VERSION` pour `from` ou `to`.

### Unit
- `src/app/core/platform/preferences.service.spec.ts` :
  - ignore une tentative d'installation stockée mal formée
- `src/app/core/platform/update.service.spec.ts` :
  - note la tentative avant de télécharger
  - signale l'échec quand l'application tourne encore dans la version quittée, et l'envoie à Sentry
  - ne signale rien quand l'application tourne dans la version visée
  - efface la tentative notée après la détection
  - efface la tentative quand le téléchargement échoue dans la session
- `src/app/shared/components/dialogs/update-dialog.component.spec.ts` :
  - affiche la note d'échec et « Réessayer » après une installation qui n'a pas abouti
  - n'affiche aucune note sans échec signalé

## Edge cases

- **Hors ligne au relancement** : la vérification échoue, la modale ne s'ouvre pas et la note est perdue. La mise à jour sera reproposée sans note au lancement suivant.
- **Version plus récente publiée entre-temps** : l'échec reste signalé, la modale propose la plus récente.
- **Installation à la main d'une autre version** : la version n'est plus `from`, rien n'est signalé.
- **Invite de reprise au démarrage** : la mise à jour part au badge comme d'habitude (sub-project 02), la note reste visible quand le badge rouvre la modale.
- **Hors Tauri (`ng serve`)** : le store est indisponible, la lecture rend « aucune tentative », rien n'est signalé.

## Architectural decisions

### Décision : durée du signal

**Options envisagées :**
- **A. Une session** : la tentative est effacée dès la détection. Simple, pas de Sentry répété à chaque lancement, mais la note se perd si la modale ne s'ouvre pas cette fois-là.
- **B. Jusqu'au succès** : la tentative reste tant que la version n'a pas changé. La note revient à chaque lancement, mais il faut un drapeau de plus pour n'envoyer Sentry qu'une fois.

**Choix : A**

**Rationale :**
- La modale repropose la mise à jour à chaque lancement de toute façon : seule la note se perd, pas la mise à jour.
- Un seul état, effacé au même endroit qu'il est lu.
