---
feature: "Feature 6 : Plan de run, reprise et rapport"
subproject: "ecran-recapitulatif-ui"
goal: "Afficher le récapitulatif filtrable d'un run écrit, avec la recherche, l'avant / après de chaque morceau et le lien vers sa fiche source"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["04-protocole-ndjson-plan-rapport-design.md", "05-reprise-ui-design.md"]
date: "2026-10-12"
---

# Écran récapitulatif d'un run

> **Révisé le 2026-10-13** : le pied ne porte plus que « Retour à la liste » à gauche et la ligne de contexte à droite. « Restaurer le run » et « Nouveau run » en sortent (ils restent dans l'onglet Tagging), avec `clearRun()`, `prepareRun(null)` et l'icône `plus`. La règle en vigueur est l'arbitrage « Pied du récapitulatif » de `docs/DESIGN.md`. Les passages ci-dessous qui les décrivent (scope, état livré, en-tête, pied, Nouveau run, scénario 5, tests et cas limites associés) sont historiques.

## Scope

Ce sub-project ajoute l'écran récapitulatif d'un run écrit : un bouton « Récapitulatif » de la page Tagging ouvre la route `tagging/recap`, qui montre la table figée du run, filtrable par voie (Tout, Validés, Arbitrés, Échecs, chacun avec son compteur) et par recherche, avec le détail avant / après, l'état vide, « Restaurer le run » et « Nouveau run ». Il ajoute aussi le lien vers la fiche source dans le détail déplié (ouvert par le plugin `opener`) et les trois icônes manquantes (`search`, `external-link`, `plus`). Il exclut « Envoyer ce rapport » (Feature 9), la réouverture d'un run passé avec sa route `tagging/recap/:runId` (sub-project 07) et toute relance de l'écriture, qui reste au bouton d'action de la liste.

### État livré

À la fin de ce sub-project, on peut, après l'écriture d'un run :
- cliquer « Récapitulatif » ;
- filtrer les morceaux par voie et par recherche, chaque filtre affichant son compteur ;
- déplier un morceau pour voir son avant / après ;
- ouvrir sa fiche Beatport ou Bandcamp dans le navigateur ;
- revenir à un run neuf par « Nouveau run », puis lancer un autre run.

## Dependencies

- `04-protocole-ndjson-plan-rapport-design.md` (statut: draft) : `TrackResolvedEvent.source_url` dans `protocol.ts`.
- `05-reprise-ui-design.md` (statut: draft) : `SidecarService.prepareRun`, la remise à zéro d'un lancement, que ce sub-project élargit à un dossier nul pour `clearRun()`.

## Références de design

- **Maquette** : `TaggingScreen`, avec `Recap`, `runColumns` (appelé avec `settled=true`, `linkHint=false`) et `TrackDetail` ; `AppShell`, pour l'entrée du récapitulatif (lien de simulation remplacé par un bouton).
- **Design system** :
  - fiches `data/DataTable`, `forms/SelectButton`, `forms/IconField`, `forms/Button` ;
  - fiches `feedback/EmptyState`, `feedback/StateTag`, `feedback/Message`, `feedback/RollbackFailures` ;
  - fiches `icons/SourceLogo`, `icons/Icon`, `overlay/Tooltip`, `overlay/TruncatedText` ;
  - guidelines `color-states`, `type-separator`, `space-columns`.
- Règle de lecture : `.claude/rules/design/claude-design.md`.

## Files touched

- **À créer** : `src/app/features/tagging/recap-filter.ts`, `recap-filter.spec.ts` (règle des filtres, compteurs, recherche)
- **À créer** : `src/app/features/tagging/run-restore.ts` (`injectRunRestore()`, le geste de restauration extrait de la page Tagging)
- **À créer** : `src/app/features/tagging/recap-page.component.ts`, `.html`, `.spec.ts`
- **À créer** : `src/fixtures/virtual-scroll.ts` (`stubOffscreenLayout`, `settleScroller`, extraits de `run-list.component.spec.ts`)
- **À modifier** : `src/app/app.routes.ts` (route `tagging/recap`)
- **À modifier** : `src/app/core/tagging-run.store.ts`, `tagging-run.store.spec.ts` (`sourceUrl` dans `TaggingTrack`, `clear()`)
- **À modifier** : `src/app/core/sidecar.service.ts`, `sidecar.service.spec.ts` (`clearRun()`, `prepareRun` élargi à `string | null`)
- **À modifier** : `src/app/features/tagging/run-list.component.ts`, `.html`, `run-list.component.spec.ts` (entrée pour l'état vide, helpers de scroll virtuel importés de `src/fixtures/`)
- **À modifier** : `src/app/features/tagging/track-detail.component.ts`, `.html`, `.spec.ts` (lien vers la fiche source)
- **À modifier** : `src/app/features/tagging/tagging-page.component.ts`, `.html`, `.spec.ts` (restauration par `injectRunRestore()`, bouton « Récapitulatif »)
- **À modifier** : `src/app/shared/components/icon.component.ts` (`search`, `external-link`, `plus` : imports, `@case` et test d'exhaustivité existant)
- **À modifier** : `src/fixtures/tagging.ts` (`sourceUrl` de `PENDING_TRACK`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`recap.*`, `tagging.recap`)
- **À modifier** : `docs/DESIGN.md` (ligne « Récapitulatif filtrable », mapping du lien source, arbitrages)
- **À modifier** : `docs/ARCHITECTURE.md` (récapitulatif ouvert par un bouton et non automatiquement : § Écriture, diagramme de séquence, § Navigation)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert)

## Architecture approach

### Ouverture

- **Bouton « Récapitulatif »** : il apparaît dans la page Tagging dès que la phase d'écriture a rendu son bilan, dans un groupe `ml-auto flex gap-2` avec « Restaurer le run » : il y reste visible même quand ni la barre d'écriture ni « Restaurer le run » ne le sont. Il navigue vers `/tagging/recap`. La liste du run reste la vue par défaut après l'écriture : la relance et la restauration y vivent (maquette `Recap`, arbitrage « Relance de l'écriture »).
- **Route `tagging/recap`** : `loadComponent` en `export default` (`.claude/rules/angular/routing.md`, `.claude/rules/angular/routing.md`), placée avant le `**`. `tabFromUrl` lit le premier segment, donc l'onglet Tagging reste actif et le retour à la liste passe par « Retour à la liste » dans l'en-tête du récapitulatif.

### Règle des filtres

`recap-filter.ts` porte des fonctions pures, testées seules (DESIGN § Conventions de Code, ARCHITECTURE § filtres du récapitulatif) :

| Filtre | Condition | Champ lu |
|---|---|---|
| échecs | `state ∈ {unresolved, write_error}` | `state` |
| validés | `state ∈ {resolved, written}` et `resolution = auto` | `state` puis `resolution` |
| arbitrés | `state ∈ {resolved, written}` et `resolution ∈ {arbitration, url}` | `state` puis `resolution` |

- Un `rolled_back` n'appartient à aucun filtre et n'apparaît que sous « Tout ».
- Les compteurs suivent la même règle : la somme des trois peut être inférieure à « Tout ».
- La recherche porte sur l'artiste et le titre d'origine et sur le nom de fichier, casse et espaces de bord ignorés.
- L'écran filtre par `computed`, jamais par pipe (`.claude/rules/angular/signals.md`, `.claude/rules/angular/pipes-directives.md`).
- Les unions sont fermées par `never` (`.claude/rules/typescript/types.md`).

### Écran

`RecapPageComponent` vit dans `features/tagging/`, car il n'a qu'un seul écran (DESIGN § Librairies UI). Il lit les morceaux du run affiché par `SidecarService` et n'injecte aucun store (`.claude/rules/angular/services.md`). Son hôte porte `PAGE_HOST` et le fondu `animate.enter`, comme les trois pages d'onglet.

- **En-tête** : le bouton « Retour à la liste » (`text` `secondary`, `chevron-left`) puis le titre « Récapitulatif du run » (`text-2xl font-semibold`) à gauche. À droite, un `p-selectbutton` `size="small"` à quatre options puis un `p-iconfield` de recherche (`.claude/rules/primeng/composants.md`).
  - Le filtre et la recherche sont deux champs d'un même `signal`, lus par `form()` et liés par `[formField]`, comme la page Playlist (`.claude/rules/angular/forms.md`).
  - Chaque option porte son compteur selon la fiche `SelectButton` et un `label` traduit : sans lui, PrimeNG pose `aria-label="[object Object]"` sur chaque bouton. Le groupe est nommé par `ariaLabelledBy`, la recherche par un `aria-label`.
- **Échecs d'écriture** : le message existant (`tagging.write.failed`), en texte seul, compté sur les morceaux affichés par la page, suivi de `RollbackFailuresComponent`.
- **Table** : `RunListComponent` réutilisé, figé (`frozen`), sur les morceaux filtrés, avec le détail déplié par `TrackDetailComponent` (`.claude/rules/primeng/ligne-depliee.md`).
  - `run-list` gagne une entrée qui remplace son état vide par `EmptyStateComponent` : « Aucun morceau ne correspond », « Changez de filtre ou videz la recherche. ».
  - Un morceau que le filtre ou la recherche retire de la table perd son détail ouvert, car `openId` est un `linkedSignal` sur les morceaux de la table. Resté visible, le morceau ouvert garde le sien.
- **Pied** :
  - « Restaurer le run », qui reprend le geste et la confirmation existants de la page Tagging ;
  - « Nouveau run » en `text` `secondary` avec l'icône `plus`, qui appelle `SidecarService.clearRun()` puis navigue vers `/tagging`.
- **Sans run** (route ouverte directement, run vidé) : `EmptyStateComponent` encadré, « Aucun run à récapituler », sous l'en-tête réduit au retour et au titre.
- **Espacement** : `gap-6` entre les sections, la page ne défile jamais (DESIGN § Layout, `.claude/rules/tailwindcss/echelles.md`).

### Restauration partagée

`injectRunRestore()` (`run-restore.ts`) reprend de la page Tagging les morceaux restaurables, `canRestoreRun`, `restoringRun`, `restoringTrackId`, `restoreRun`, `restoreTrack` et le bilan `runRollbackFailures` du run affiché. La page Tagging et le récapitulatif l'appellent : la logique et la confirmation ne vivent qu'une fois. Le bouton « Restaurer le run » reste écrit dans les deux templates (une quinzaine de lignes) : un composant partagé ferait passer quatre entrées pour un bouton sans comportement propre.

### Nouveau run

`clearRun()` vide le run affiché sans envoyer de commande. Il passe par `TaggingRunStore.clear()`, qui remet le store à vide sans poser « en cours » (contrairement à `reset()`) et par `prepareRun(null)`, qui remet aussi le dossier demandé à `null` et vide l'écriture, les arbitrages et le rattrapage. Un test prouve que `startTagging` repart ensuite. Il refuse de vider tant qu'une phase tient le run ou les fichiers.

### Lien vers la fiche source

- **Donnée** : `TaggingTrack` gagne `sourceUrl`, alimenté par `track_resolved.source_url`.
- **Rendu** : dans `TrackDetailComponent`, la valeur de la ligne URL (le champ `url`) devient un bouton `link`, hors `size="small"` (DESIGN § Conventions de Code). Il porte l'icône `external-link` et appelle `openUrl` de `@tauri-apps/plugin-opener`, dont la capability `opener:allow-open-url` est déjà accordée (`.claude/rules/tauri/capabilities.md`).
- **Sans `sourceUrl`** : la ligne reste un texte tronqué.

### Icônes

`search`, `external-link` et `plus` entrent dans `ICON_NAMES`, importées chacune par son sous-chemin `@primeicons/angular/<nom>`, avec leur `@case` dans `IconComponent` (arbitrage « Icônes »).

### Textes

`recap.*` (titre, quatre filtres et leur libellé de groupe, recherche, état vide, sans run, Nouveau run, Retour à la liste) et `tagging.recap`, en FR et EN dans le même commit (`.claude/rules/ngx-translate/i18n.md`).

### Tokens et conventions

`text-sm`, `text-muted-color`, `gap-2`, `gap-4`, `gap-6`, jamais une valeur en dur (`.claude/rules/tailwindcss/utilitaires.md`). Composants `OnPush` (`.claude/rules/angular/change-detection.md`, `.claude/rules/angular/components.md`).

### Arbitrages de `docs/DESIGN.md` suivis

« Bouton d'action du run », « Relance de l'écriture », « Rouge des gestes sur les fichiers », « Boutons du `p-confirmdialog` », « Lignes du détail avant / après », « Colonne Champ du détail », « Détail d'un morceau », « Taille des boutons », « Position des tooltips », « Séparateur artiste / titre », « Densité des tables », « Container », « Largeurs », « Espacement entre sections », « Vocabulaire de la restauration », « Une phrase par ligne », « Icônes ».

## Acceptance criteria

### Scénario 1 : ouvrir le récapitulatif
**GIVEN** un run dont la phase d'écriture vient de se terminer
**WHEN** l'utilisateur clique « Récapitulatif »
**THEN** l'écran « Récapitulatif du run » s'affiche sur `/tagging/recap`, l'onglet Tagging restant sélectionné

### Scénario 2 : filtres
**GIVEN** un run qui compte deux morceaux écrits en `auto`, un écrit par arbitrage, un `write_error` arbitré, un non résolu et un restauré
**WHEN** l'utilisateur choisit successivement les quatre filtres
**THEN** « Tout » montre 6 morceaux, « Validés » 2, « Arbitrés » 1 et « Échecs » 2
**AND** le morceau restauré n'apparaît que sous « Tout »

### Scénario 3 : recherche sans résultat
**GIVEN** le filtre « Validés »
**WHEN** l'utilisateur cherche un titre absent
**THEN** la table affiche « Aucun morceau ne correspond » et la phrase qui dit de changer de filtre ou de vider la recherche

### Scénario 4 : fiche source
**GIVEN** un morceau écrit depuis Beatport, déplié
**WHEN** l'utilisateur clique le lien de la ligne URL
**THEN** le navigateur s'ouvre sur l'URL du candidat retenu

### Scénario 5 : nouveau run
**GIVEN** le récapitulatif affiché
**WHEN** l'utilisateur clique « Nouveau run »
**THEN** l'onglet Tagging revient à son état initial, sans run ni dossier demandé
**AND** il peut lancer un nouveau run, la page n'étant pas bloquée « en cours »

## Tests à écrire

### Unit
- `src/app/features/tagging/recap-filter.spec.ts` :
  - « Échecs » lit `state`, « Validés » et « Arbitrés » lisent `state` puis `resolution` : un `write_error` arbitré n'est que dans « Échecs » (scénario 2)
  - un `rolled_back` n'appartient à aucun filtre
  - les compteurs suivent la même règle
  - la recherche ignore la casse et les espaces de bord et porte sur l'artiste, le titre et le fichier
- `src/app/features/tagging/recap-page.component.spec.ts` (lignes en scroll virtuel, stubbé comme `run-list.component.spec.ts`) :
  - le filtre choisi réduit la table et chaque option porte son compteur
  - l'état vide apparaît quand rien ne correspond (scénario 3)
  - un morceau que le filtre retire perd son détail ouvert
  - le message d'échec d'écriture compte les morceaux affichés
  - « Nouveau run » vide le run et navigue vers `/tagging` (scénario 5)
  - sans run, l'état encadré s'affiche
  - « Restaurer le run » est désactivé pendant une restauration
- `src/app/features/tagging/track-detail.component.spec.ts` :
  - le lien appelle `openUrl` avec `sourceUrl` (scénario 4) et la ligne reste du texte sans `sourceUrl`
- `src/app/features/tagging/tagging-page.component.spec.ts` :
  - « Récapitulatif » n'apparaît qu'une fois l'écriture terminée et navigue vers `/tagging/recap` (scénario 1)
  - les tests de restauration passent par `runRestore` (comportement inchangé)
- `src/app/core/tagging-run.store.spec.ts` :
  - `sourceUrl` est repris de `track_resolved`
  - `clear()` vide le store sans poser « en cours »
- `src/app/core/sidecar.service.spec.ts` :
  - `startTagging` repart après `clearRun()` (scénario 5)
  - `clearRun()` ne vide rien pendant une recherche

## Edge cases

- **Run écrit puis entièrement restauré** : tous les morceaux sont `rolled_back`. « Tout » les montre, les trois autres filtres affichent 0 et l'état vide.
- **Relance de l'écriture depuis la liste, puis retour au récap** : les états à jour sont relus, puisque le récap lit les morceaux du run affiché.
- **Morceau rattrapé par URL SoundCloud** : `sourceUrl` désigne la page SoundCloud et le lien s'ouvre de même.
- **`openUrl` refusé** (aucun navigateur par défaut) : l'erreur est logguée en console, rien ne change à l'écran.
- **« Nouveau run » pendant une relance d'écriture ou une restauration** : `clearRun()` ne vide rien tant qu'une phase tient les fichiers et la navigation vers l'onglet Tagging a lieu quand même : il y montre le run en cours.
- **Filtre ou recherche qui retire un morceau déplié** : son détail se referme et ne se rouvre pas quand le morceau revient.

## Architectural decisions

### Décision : ouverture du récapitulatif
**Options envisagées :**
- **A. Bouton « Récapitulatif » et route dédiée** : la liste reste la vue par défaut après l'écriture, comme le veut la maquette.
- **B. Bascule automatique en fin d'écriture** (ARCHITECTURE § Flux) : un retour à la liste devient nécessaire pour relancer ou restaurer.
- **C. Filtres ajoutés à la liste du run** : pas d'écran à part, mais un run passé (sub-project 07) devrait passer par la même liste que le run vivant.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- La route sert aussi le sub-project 07 pour rouvrir un run passé.
- `docs/ARCHITECTURE.md` décrivait B : il est corrigé dans ce sub-project.

### Décision : emplacement du lien vers la fiche source
**Options envisagées :**
- **A. Dans le détail déplié**, sur la ligne URL : la table garde ses colonnes.
- **B. Logo de source cliquable** : deux gestes proches dans la même ligne, ouvrir le détail et ouvrir la fiche.
- **C. Icône en fin de ligne** : une colonne de plus à mesurer en FR et EN.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Le détail montre déjà ce que l'écriture a fait (arbitrage « Lignes du détail avant / après ») : l'URL y est à sa place.
