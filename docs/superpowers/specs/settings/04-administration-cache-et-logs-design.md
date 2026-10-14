---
feature: "Feature 7 : Settings"
subproject: "administration-cache-et-logs"
goal: "Vider le cache disque et ouvrir le dossier des logs depuis les Réglages"
status: "draft"
complexity: "M"
tdd_scope: "partial"
depends_on: ["01-protocole-ndjson-reglages-design.md", "02-langue-et-signal-sonore-design.md"]
date: "2026-10-14"
---

# Cache et logs

## Scope

Ce sub-project ajoute deux rangées en tête de la section Administration des Réglages, avant Restauration et Runs passés :
- **Cache** : taille affichée, bouton « Vider le cache », toast des octets libérés, erreur sous la rangée ;
- **Logs** : bouton « Ouvrir le dossier des logs », qui révèle le fichier de logs courant dans l'Explorateur.

Il exclut l'envoi d'un rapport (Feature 9) et toute permission Tauri nouvelle.

### État livré

À la fin de ce sub-project, on peut, dans la fenêtre Tauri :
1. ouvrir Réglages, section Administration, et lire la taille du cache ;
2. cliquer « Vider le cache » : la taille retombe à zéro et un toast annonce les octets libérés ;
3. cliquer « Ouvrir le dossier des logs » : l'Explorateur s'ouvre dans `appLocalDataDir()/logs`, le fichier `tagger.log` sélectionné.

## Dependencies

- `01-protocole-ndjson-reglages-design.md` (statut: draft) : `get_cache_size`, `clear_cache` et leurs refus (`phase_busy`, `run_not_written`) ; `SidecarService.cacheSize`, `cacheCleared`, `logFile`, `loadCacheSize()`, `clearCache()`.
- `02-langue-et-signal-sonore-design.md` (statut: draft) : menu latéral, section `admin`, `mountWith(overrides, section)` dans la spec de la page.

## Références de design

- **Maquette** : `SettingsScreen`, section Administration, rangées « Cache » et « Logs » ; toast de `onClearCache` dans `AppShell`. Les aides de la maquette, qui recopient des constantes du sidecar, sont remplacées ; l'écart est au Reste ouvert de `.design-sync/NOTES.md`.
- **Design system** : fiches `components/forms/Button`, `components/forms/SettingsRow`, `components/icons/Icon`, `components/feedback/Message`.
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À créer** : `src/app/shared/utils/bytes.ts` (`formatBytes`)
- **À créer** : `src/app/shared/utils/bytes.spec.ts`
- **À modifier** : `src/app/shared/components/display/icon.component.ts` (icône `trash`)
- **À modifier** : `src/app/core/platform/completion-signal.service.ts` (`TOAST_LIFE`, durée partagée des toasts)
- **À modifier** : `src/app/core/sidecar/sidecar.service.ts` (`runLost`, exposé depuis le store du run)
- **À modifier** : `src/fixtures/sidecar-stub.ts` (`runLost`)
- **À modifier** : `src/app/features/settings/settings-page.component.ts` (taille, vidage, toast, raison de blocage, révélation des logs)
- **À modifier** : `src/app/features/settings/settings-page.component.html` (rangées Cache et Logs)
- **À modifier** : `src/app/features/settings/settings-page.component.spec.ts`
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`settings.admin.cache.*`, `settings.admin.logs.*`)
- **À modifier** : `docs/DESIGN.md` (actions d'administration, de « Post-MVP (non installés) » au Mapping ; Notifications ; Icônes)
- **À modifier** : `docs/ARCHITECTURE.md` (l.387 `opener`, l.414 `features/settings/`, l.948 bouton des logs)
- **À modifier** : `docs/PRODUCTION.md` (l.321 : le bouton des logs n'ajoute aucune permission)

## Architecture approach

### Rangée Cache

- Taille lue au montage, quand le moteur est disponible, avec `loadRollbackTarget()` et `listRuns()` dans l'`effect` existant : un run fait grossir le cache entre deux visites. Masquée tant qu'elle est inconnue.
- `formatBytes(bytes, language)` dans `shared/utils/bytes.ts` choisit l'unité (octet, ko, Mo, Go) en base décimale, comme `CACHE_MAX_BYTES` côté sidecar, et rend le nombre par `Intl.NumberFormat` dans la langue courante, chiffres en `tabular-nums`.
- Bouton « Vider le cache » : `button pButton` `secondary` outlined `size="small"`, icône `trash` (DESIGN.md § Mapping, actions d'administration), puis la taille, comme la maquette. Aide sur la ligne du bouton (arbitrage « Rangée de Réglages »), sans constante du sidecar ni jargon : ce que contient le cache, et qu'aucun fichier de musique n'est touché.
- Pas de confirmation : le cache est jetable (ADR-013), DESIGN.md réserve la confirmation aux gestes sur les fichiers.
- Raison de blocage, en tooltip sur le bouton grisé comme pour la restauration :
  - une phase longue tourne (`phase() !== "idle"`) ;
  - le run affiché attend son écriture : non confirmé (`committed`), ou confirmé avec des échecs d'écriture (`writeFailureCount`). Un run perdu par la mort du moteur n'attend plus rien, échecs restés à l'écran compris : `SidecarService` expose `runLost` depuis le store du run, `runFrozen` ne distinguant pas un run écrit d'un run perdu.
  L'interface grise sur ce qu'elle sait déjà, le sidecar reste l'arbitre : un refus `phase_busy` ou `run_not_written` s'affiche par `errorFor("clear_cache", "get_cache_size")` sous la rangée. Sans moteur, le bouton est grisé sans raison, comme « Enregistrer ».
- Toast `success` (`MessageService`, 4 s, sans signal sonore : ce n'est pas la fin d'une phase longue) : « Cache vidé », puis les octets libérés, puis, s'il en reste, ce qui reste, utilisé par un autre programme. Il part sur un nouveau `cacheCleared`, jamais sur celui déjà présent au montage de la page (un retour sur l'onglet ne le rejoue pas).

### Rangée Logs

- Bouton « Ouvrir le dossier des logs » : `secondary` outlined `size="small"`, icône `external-link`, aide sur sa ligne (joindre le fichier sélectionné à un signalement), sans recopier la rotation ni la taille.
- Il appelle `revealItemInDir(logFile)` du plugin `opener`. `opener:allow-reveal-item-in-dir` est déjà accordé et sans scope (`tauri-plugin-opener` 2.7.0, `reveal_item_in_dir`) : la capability ne change pas (`.claude/rules/tauri/capabilities.md`). Le fichier sélectionné est celui à joindre, là où révéler le dossier ouvrirait son parent.
- Grisé tant que `logFile()` est inconnu. Un échec de la révélation affiche un `app-message` d'erreur sous la rangée, avec le geste qui répare (relancer l'application recrée le fichier).

### Rules applicables

`.claude/rules/angular/components.md`, `.claude/rules/angular/signals.md`, `.claude/rules/angular/services.md`, `.claude/rules/angular/tests.md`, `.claude/rules/ngx-translate/i18n.md`, `.claude/rules/primeng/composants.md`, `.claude/rules/tailwindcss/echelles.md`, `.claude/rules/tailwindcss/utilitaires.md`, `.claude/rules/tauri/capabilities.md`, `.claude/rules/typescript/types.md`, `.claude/rules/design/claude-design.md`.

## Acceptance criteria

### Scénario 1 : taille du cache
**GIVEN** le moteur disponible et un cache de 418 Mo
**WHEN** l'utilisateur ouvre la section Administration
**THEN** la rangée Cache affiche la taille dans la langue de l'interface

### Scénario 2 : vidage
**GIVEN** aucun run en attente d'écriture ni phase longue
**WHEN** l'utilisateur clique « Vider le cache »
**THEN** `clear_cache` part
**AND** à la réponse, la taille affichée devient celle qui reste et un toast annonce les octets libérés

### Scénario 3 : vidage partiel
**GIVEN** un fichier du cache tenu par un autre programme
**WHEN** le vidage se termine
**THEN** le toast annonce les octets libérés puis ce qui reste

### Scénario 4 : run en attente d'écriture
**GIVEN** un run affiché, résolu et non confirmé
**WHEN** l'utilisateur survole « Vider le cache »
**THEN** le bouton est grisé et son tooltip dit que le run attend l'écriture de ses tags

### Scénario 5 : refus du sidecar
**GIVEN** un `clear_cache` refusé en `run_not_written`
**WHEN** l'erreur arrive
**THEN** elle s'affiche sous la rangée Cache

### Scénario 6 : logs
**GIVEN** `version.log_file` reçu
**WHEN** l'utilisateur clique « Ouvrir le dossier des logs »
**THEN** l'Explorateur s'ouvre sur le dossier des logs, le fichier courant sélectionné

### Scénario 7 : fichier de logs introuvable
**GIVEN** la révélation du fichier qui échoue
**WHEN** l'utilisateur clique « Ouvrir le dossier des logs »
**THEN** un message d'erreur sous la rangée dit de relancer l'application

## Tests à écrire

### Unit
- `src/app/shared/utils/bytes.spec.ts` :
  - garde les octets sous 1 000, passe au ko à 1 000, au Mo et au Go aux puissances de 1 000 suivantes
  - garde une décimale sous 10 d'une unité
- `src/app/shared/components/display/icon.component.spec.ts` :
  - rend l'icône `trash` : l'`it.each(ICON_NAMES)` existant la couvre dès son entrée dans `ICON_NAMES`, sans cas à écrire
- `src/app/features/settings/settings-page.component.spec.ts` :
  - demande la taille du cache une fois le moteur disponible (cas ajouté à l'`it.each` existant)
  - affiche la taille formatée
  - vider envoie `clear_cache`
  - un nouveau `cacheCleared` annonce les octets libérés, puis ce qui reste quand il en reste
  - un `cacheCleared` déjà présent au montage n'annonce rien
  - grise le vidage pendant une phase longue, sur un run non écrit, puis sur un run écrit avec des échecs ; le laisse actif après une écriture sans échec et pour un run perdu avec le moteur
  - affiche l'erreur de `clear_cache` sous la rangée
  - révèle `logFile` ; grisé sans `logFile` ; un échec affiche son message

## Edge cases

- **Moteur relancé** : `runLost` vaut vrai pour un run perdu, le vidage n'est pas grisé, même si des échecs d'écriture restent à l'écran : le sidecar redémarré n'a plus de run.
- **Taille d'un run en cours** : la taille affichée date de l'ouverture des Réglages ; elle se relit à la visite suivante ou après un vidage.
- **Onglet quitté avant la réponse** : le vidage se fait, le toast ne part pas ; la taille se relit au retour.
- **`load_run` en vol** : le sidecar accepte le vidage (sub-project 01), le récapitulatif rouvert retélécharge ses pochettes.

## Architectural decisions

### Décision : ouvrir les logs

**Options envisagées :**
- **A. `revealItemInDir` sur le dossier `logs`** : aucune permission de plus, mais l'Explorateur s'ouvre sur le parent, `logs` sélectionné.
- **B. `openPath` sur le dossier `logs`** : le dossier lui-même, mais `opener:allow-open-path` avec un scope à ajouter à la capability, surface sensible.
- **C. `revealItemInDir` sur `tagger.log`** : l'Explorateur s'ouvre dans `logs`, le fichier à joindre sélectionné, aucune permission de plus ; demande le chemin du fichier au sidecar (`version.log_file`).

**Choix : C**

**Rationale :**
- Le bouton sert à récupérer une trace chez un ami DJ : le fichier sélectionné est exactement ce qu'il doit envoyer.
- La capability reste inchangée, et le nom du fichier reste défini là où le logger s'arme (`LOG_FILE_NAME`, sub-project 01).

### Décision : griser le vidage côté interface

**Options envisagées :**
- **A. Bouton toujours actif, refus du sidecar affiché** : aucune règle recopiée, mais l'utilisateur découvre le refus après le clic.
- **B. Bouton grisé sur l'état connu de l'interface, le sidecar restant l'arbitre** : la raison se lit avant le clic, comme pour la restauration.

**Choix : B**

**Rationale :**
- Même patron que `restoreBlockedReason` sur la même page ; un écart entre l'état de l'interface et celui du sidecar reste visible, par l'erreur sous la rangée.
