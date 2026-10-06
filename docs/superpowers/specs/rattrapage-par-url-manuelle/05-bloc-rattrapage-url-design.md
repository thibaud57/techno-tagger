---
feature: "Feature 4 — Rattrapage par URL manuelle"
subproject: "bloc-rattrapage-url"
goal: "Afficher sous la liste du run le bloc qui permet de coller une URL par morceau sans correspondance et de suivre la phase de rattrapage"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["04-service-rattrapage-ui-design.md"]
date: "2026-10-03"
---

# Bloc de rattrapage par URL

## Scope

Couvre le composant du bloc de rattrapage (en-tête, une ligne par morceau rattrapable avec son identité, son motif, son champ d'URL, son bouton, son attente et son erreur, état vide), son montage borné sous la liste du run, la barre de progression de la phase dans l'emplacement de celle du run, les libellés FR et EN, le nom de marque du paramètre `source` dans les messages d'erreur et la mise à jour de DESIGN.md et de `.design-sync/NOTES.md`.

Exclut le bouton « Confirmer l'écriture » et sa `ConfirmDialog` (Feature 5), le toast de fin de recherche, inchangé, et toute logique de reconnaissance d'URL, qui vit dans le sidecar (sub-project 01).

### État livré

À la fin de ce sub-project, on peut : dans `tauri dev`, après un run qui laisse des morceaux sans correspondance, coller une URL Bandcamp sur une ligne du bloc, voir le bouton attendre la réponse, la ligne de la liste du run passer en « URL » et la barre de phase avancer d'un cran ; coller une URL YouTube sur une autre ligne et lire l'erreur sous cette seule ligne.

## Dependencies

- `04-service-rattrapage-ui-design.md` (statut: draft) : `urlRecoveryOpen`, `urlRecoveryProgress`, `urlRecoveryBusy`, `urlRecoveryErrors`, `recoverableTracks`, `resolveByUrl` sur `SidecarService`.

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx` → `UrlRescue` (bloc, en-tête, état vide, ligne) et son montage dans `TaggingScreen` (bloc sous la table du run, barre de progression de la phase `urlRescue`) ; `ui_kits/techno-tagger/AppShell.jsx` → phase `urlRescue` (entrée à la fin de la recherche, `onResolveByUrl`)
- **Design system** : `components/forms/InputGroup`, `components/forms/InputText`, `components/forms/Button`, `components/data/PhaseProgress`, `components/feedback/ErrorMessage`, `components/feedback/EmptyState`, `components/overlay/TruncatedText` ; `components/icons/SourceLogo` lue pour la colonne Source de la liste du run, où la source d'un morceau rattrapé s'affiche, le bloc lui-même n'en montre aucune
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À créer** : `src/app/features/tagging/url-recovery.component.ts`, `src/app/features/tagging/url-recovery.component.html`, `src/app/features/tagging/url-recovery.component.spec.ts`
- **À modifier** : `src/app/features/tagging/tagging-page.component.ts`, `src/app/features/tagging/tagging-page.component.html` (montage borné du bloc, barre de la phase, lancement bloqué pendant un geste), `src/app/features/tagging/tagging-page.component.spec.ts`
- **À créer** : `src/app/shared/utils/sources.ts` (`SOURCE_NAMES`, déplacé de `run-list.component.ts`)
- **À modifier** : `src/app/features/tagging/run-list.component.ts` (import de `SOURCE_NAMES`)
- **À modifier** : `src/app/shared/components/error-message.component.ts`, `src/app/shared/components/error-message.component.spec.ts` (nom de marque du paramètre `source`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.recovery.*`, `tagging.blocked.recovering`, texte de `errors.track_not_found`)
- **À modifier** : `docs/DESIGN.md` (§ Mapping Composants > Arbitrage, § Structure de Page, § Maquette et design system externes > Arbitrages)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert)

## Architecture approach

- **Un composant de présentation** `UrlRecoveryComponent` (`app-url-recovery`), standalone, `OnPush` par défaut, qui n'injecte que `SidecarService` (`.claude/rules/angular/components.md`, `.claude/rules/angular/services.md`). Il lit `recoverableTracks`, `urlRecoveryBusy` et `urlRecoveryErrors` et en dérive ses lignes dans un `computed()`, jamais par un appel de méthode dans le template (`.claude/rules/angular/change-detection.md`). Aucune règle métier : quels morceaux, quelle source, quelle progression, tout vient du sidecar par le service.
- **Montage** : la page le monte comme nouvel enfant de sa colonne, après le conteneur `flex-1 min-h-0` de la liste du run et hors de lui, quand `urlRecoveryOpen()` est vrai. La phase s'ouvre aussi après une interruption (sub-project 03) : le bloc apparaît alors, là où la maquette ne montre rien en phase `interrupted`.
- **Hauteur bornée** (décision du propriétaire, 2026-10-03) : le bloc suit son contenu jusqu'à une borne d'environ deux cinquièmes de la page, au-delà ses lignes défilent dans le bloc. La liste du run garde le reste et son propre scroll, la page ne défile toujours pas (DESIGN.md § Structure de Page).
- **En-tête** : un titre `h2` et une phrase qui dit l'étape facultative et les trois sources acceptées. Les libellés suivent la maquette sans sa mention technique sur SoundCloud.
- **Ligne**, dans l'ordre :
  - **identité** : `app-truncated-text` sur « Artiste - Titre » ou le nom de fichier (`trackMainLine`, `shared/utils/identity.ts`), séparateur `-` (arbitrage « Séparateur artiste / titre ») ; en dessous, en texte secondaire, le motif d'échec (`tagging.reason.*`) d'un morceau `unresolved`, ou « Rattrapé sur <Source> » d'un morceau déjà résolu par URL ;
  - **saisie** : `p-inputgroup`, `input pInputText` qui absorbe la largeur restante et `button pButton` « Résoudre » en `outlined` `secondary` (fiche `Button`). Le bouton est actif dès que le champ n'est pas vide et que la ligne n'attend pas de réponse. Pendant l'attente, il est désactivé et porte un spinner enfant, `[loading]` étant déprécié en PrimeNG 22 (même motif que la modale d'arbitrage) ;
  - **erreur** : `app-error-message` sous la ligne, sur l'erreur de ce seul morceau (`urlRecoveryErrors`). Jamais un toast (fiche `ErrorMessage`).
- **Accessibilité du champ** : le champ porte un `aria-label` traduit qui nomme le morceau de sa ligne, l'identité visible n'étant pas un `label` lié ; la touche Entrée dans le champ vaut le clic sur « Résoudre », avec la même garde (champ vide ou ligne en attente : rien ne part).
- **Écart à la maquette : pas de zone hôte** (décision du propriétaire du sub-project 01, 2026-09-29) : ni logo de source à la frappe, ni « Hôte non reconnu », ni bouton grisé tant que l'hôte n'est pas reconnu. La reconnaissance vit dans le sidecar, un hôte refusé revient en `unsupported_url` sous la ligne. La source s'affiche dans la colonne Source de la liste une fois le morceau rattrapé.
- **Texte saisi** : tenu par le composant dans un signal par `track_id` (`.claude/rules/angular/signals.md`), lié au champ, et laissé dans le champ après un succès pour qu'on voie le lien utilisé et qu'on puisse le corriger. Le geste passe par une méthode du composant qui appelle `resolveByUrl` sans attendre, l'échec revenant plus tard dans `urlRecoveryErrors` (`.claude/rules/angular/forms.md`). Le texte part tel quel : la normalisation appartient au sidecar.
- **État vide** : `app-empty-state` (icône `check-circle`, titre et phrase, jamais le titre seul) quand `recoverableTracks` est vide.
- **Lancement d'un run pendant la phase** (décision ci-dessous) : le bouton « Lancer le run » reste actif une fois la phase ouverte, un nouveau run fermant la phase comme il efface déjà le run terminé. Il se bloque seulement tant qu'un geste de rattrapage attend sa réponse, avec son aide `tagging.blocked.recovering` dans `blockedReason`, juste après le run en cours : fermer le run couperait l'appel en vol.
- **Barre de phase** : `app-phase-progress` dans l'emplacement de la barre du run en haut de page, une seule phase tournant à la fois. Libellé de phase, compteur « rattrapés sur à rattraper » et valeur par `progressPercentage` (`shared/utils/progress.ts`). Masquée sur 0 sur 0, l'état vide disant déjà tout. Écart à la maquette, qui garde la barre réseau figée à 100 % pendant la phase.
- **Nom de marque dans les erreurs** : le sidecar envoie `params.source` en valeur de `Source` (`bandcamp`). `ErrorMessageComponent` le passe par `SOURCE_NAMES` (déplacé de `run-list.component.ts` vers `shared/utils/sources.ts`, une valeur, une source), sinon l'écran lirait « bandcamp ne répond pas ». `errors.track_not_found` ne s'affiche que dans ce contexte : son texte dit que le lien ne mène à aucun morceau sur la source.
- **Largeurs** : aucune largeur en dur sur le champ ni sur le bouton. Le bloc identité aligne ses lignes sur une largeur figée, mesurée sur son contenu le plus long en FR et en EN et commentée (arbitrage « Largeurs », `.claude/rules/primeng/composants.md`).
- **Libellés** : clés `tagging.recovery.*` dans les deux fichiers de langue, même commit, vouvoiement, espace insécable avant `:` en français (`.claude/rules/ngx-translate/i18n.md`). Tokens de couleur et classes Tailwind seulement (`.claude/rules/tailwindcss/utilitaires.md`).
- **Docs** : DESIGN.md (skill `design-doc`) perd « validation de l'hôte avant envoi » dans la ligne « Rattrapage par URL » du Mapping, décrit le bloc borné dans § Structure de Page et consigne dans § Arbitrages, datés, les écarts à la maquette tranchés par le propriétaire : zone hôte retirée, barre de phase dans l'emplacement de celle du run, lignes rattrapées conservées, bloc après interruption, bouton de lancement conservé pendant la phase. `.design-sync/NOTES.md` § Reste ouvert liste ce que le code livre et que la maquette n'a pas encore, pour la synchronisation.

## Acceptance criteria

### Scénario 1 : Bloc à l'ouverture de la phase
**GIVEN** un run terminé avec deux morceaux `unresolved` (motifs `no_result` et `below_threshold`) et un résolu en `auto`
**WHEN** la phase de rattrapage s'ouvre
**THEN** le bloc apparaît sous la liste du run avec deux lignes, chacune avec son identité et son motif
**AND** la barre de phase affiche 0 sur 2 dans l'emplacement de la barre du run

### Scénario 2 : Rattrapage d'une ligne
**GIVEN** le bloc ouvert
**WHEN** l'utilisateur colle une URL Bandcamp sur la première ligne et clique « Résoudre »
**THEN** `resolveByUrl` part avec ce morceau et cette URL
**AND** le bouton de la ligne est désactivé avec un spinner tant que la réponse n'est pas arrivée
**AND** la touche Entrée dans le champ aurait produit le même envoi

### Scénario 3 : Ligne rattrapée conservée
**GIVEN** une ligne dont le morceau vient d'être résolu par URL sur Bandcamp
**WHEN** l'écran se met à jour
**THEN** la ligne reste dans le bloc, son texte secondaire dit « Rattrapé sur Bandcamp » et le champ garde l'URL collée
**AND** la barre de phase affiche 1 sur 2

### Scénario 4 : Erreur sur une ligne
**GIVEN** le bloc ouvert avec deux lignes
**WHEN** le sidecar refuse le geste de la seconde en `unsupported_url`
**THEN** le message traduit s'affiche sous la seconde ligne seulement
**AND** aucun toast n'apparaît

### Scénario 5 : Bouton inactif sur un champ vide
**GIVEN** le bloc ouvert
**WHEN** le champ d'une ligne est vide
**THEN** son bouton « Résoudre » est désactivé

### Scénario 6 : Rien à rattraper
**GIVEN** un run dont tous les morceaux sont résolus en `auto` ou par arbitrage
**WHEN** la phase de rattrapage s'ouvre
**THEN** le bloc affiche son état vide, sans ligne
**AND** aucune barre de phase n'est affichée

### Scénario 7 : Nom de marque dans un message
**GIVEN** une erreur `source_unavailable` dont `params.source` vaut `bandcamp`
**WHEN** le message s'affiche
**THEN** il nomme « Bandcamp »

### Scénario 8 : Lancement bloqué pendant un geste
**GIVEN** la phase ouverte, un geste de rattrapage en attente de réponse
**WHEN** l'utilisateur survole « Lancer le run »
**THEN** le bouton est désactivé et son aide dit qu'un rattrapage est en cours
**AND** il redevient actif à la réponse, succès ou erreur

## Tests à écrire

### Unit
- `src/app/features/tagging/url-recovery.component.spec.ts` :
  - lists a line per recoverable track with its identity and its reason
  - names the source of a track already resolved by url
  - disables the resolve button on an empty field
  - sends the pasted url for its track
  - sends the pasted url on enter and ignores enter on an empty field
  - names the track in the field label
  - shows a spinner and disables the button while the track waits
  - shows an error under its own line only
  - shows the empty state when nothing is left to recover
- `src/app/features/tagging/tagging-page.component.spec.ts` :
  - mounts the url recovery block once the phase is open
  - shows the url recovery progress in place of the run progress
  - hides the url recovery progress when nothing is left to recover
  - blocks a new run while a url recovery waits
- `src/app/shared/components/error-message.component.spec.ts` :
  - names the source brand in a translated message

Aucun test ne vérifie PrimeNG, ngx-translate ni Angular : chacun échoue contre une régression de notre lecture de l'état, de notre geste, de notre placement de l'erreur ou de notre nom de marque.

## Edge cases

- **Entrée sur un champ vide ou une ligne en attente** : rien ne part, comme le bouton désactivé.
- **Texte fait d'espaces** : le bouton est actif, le geste part, le sidecar le refuse en `unsupported_url` sous la ligne. L'interface ne filtre que la chaîne vide.
- **Ligne rattrapée puis recollée avec un mauvais lien** : l'erreur s'affiche sous la ligne, qui garde « Rattrapé sur <Source> » : le sidecar n'a pas touché au morceau (sub-project 02).
- **Arbitrage refusé pendant la phase** : le morceau devient `unresolved` et sa ligne apparaît dans le bloc à la mise à jour de `recoverableTracks`, avec son motif.
- **Nouveau run** : la phase se ferme (sub-project 04), le bloc disparaît, les textes saisis tombent avec le composant.
- **Onglet quitté puis rouvert** : le composant est recréé, les textes saisis non envoyés sont perdus ; l'état de la phase, lui, vit dans le service.

## Architectural decisions

### Décision : Partage de la hauteur entre la liste du run et le bloc

**Options envisagées :**
- **A. Bloc borné sous la liste** : sa hauteur suit son contenu jusqu'à une borne, au-delà ses lignes défilent ; la liste garde le reste.
- **B. Moitié-moitié** : chacun son scroll, mais un bloc d'une ligne occupe la moitié de la page.
- **C. Le bloc remplace la liste pendant la phase** : on ne voit plus la ligne du run passer en « URL ».

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-10-03.
- Fidèle à la maquette, qui empile le bloc sous la table, sans laisser la page défiler (DESIGN.md § Structure de Page).

### Décision : Bouton « Lancer le run » pendant la phase

**Options envisagées :**
- **A. Conservé, bloqué seulement pendant un geste en vol** : un nouveau run ferme la phase, comme il efface déjà un run terminé sans rattrapage ; seul l'appel en cours est protégé.
- **B. Remplacé par « Confirmer l'écriture » dès la phase ouverte**, comme la maquette : sans la Feature 5, plus aucun moyen de relancer un run tant que l'app tourne.
- **C. Désactivé tant que la phase est ouverte** : même impasse que B, sans le bouton de sortie.

**Choix : A**

**Rationale :**
- Décidé le 2026-10-03. La perte d'un run terminé au lancement du suivant est le comportement de l'écran depuis la Feature 2, et la confirmation d'écriture qui donnera une sortie à la phase appartient à la Feature 5, qui reprendra la maquette à ce moment.
- Un geste en vol est le seul travail que la fermeture détruirait sans que l'utilisateur l'ait vu aboutir : il bloque le lancement le temps d'un appel à l'API.

### Décision : Emplacement de la barre de phase

**Options envisagées :**
- **A. Emplacement de la barre du run, en haut de page** : une seule barre à un seul endroit, la phase en cours.
- **B. Dans l'en-tête du bloc** : la barre colle à ses lignes, mais la page aurait deux emplacements de progression selon la phase.

**Choix : A**

**Rationale :**
- Validé par le propriétaire le 2026-10-03. Une seule phase tourne à la fois, la maquette garde aussi la barre en haut pendant `urlRescue`.
- `app-phase-progress` y est déjà monté pour la phase réseau : le bloc n'ajoute pas un second motif de progression à l'écran.
