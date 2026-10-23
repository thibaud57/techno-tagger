---
feature: "Feature 7 : Settings"
subproject: "seuils-de-matching-ui"
goal: "Régler le plancher et le seuil haut du matching depuis les Réglages et les appliquer aux runs suivants"
status: "implemented"
complexity: "M"
tdd_scope: "partial"
depends_on: ["01-protocole-ndjson-reglages-design.md", "02-langue-et-signal-sonore-design.md"]
date: "2026-10-14"
---

# Seuils de matching

## Scope

Ce sub-project ajoute la section Matching au menu des Réglages, entre API et Interface :
- rangées Plancher et Seuil haut, chacune un curseur lié à un champ numérique ;
- bouton « Rétablir les valeurs par défaut », qui efface le réglage.

Les valeurs de départ viennent du sidecar. Le réglage est persisté et envoyé dans `start_tagging` depuis l'onglet Tagging. Il exclut le recalibrage des défauts (ADR-008) et la reprise d'un run interrompu, qui garde les seuils de son plan.

### État livré

À la fin de ce sub-project, on peut, dans la fenêtre Tauri :
1. ouvrir Réglages, section Matching, et y lire les défauts du sidecar ;
2. régler le seuil haut à 95, puis lancer un run depuis Tagging : `start_tagging` porte `thresholds` (visible dans le plan du run et son rapport) ;
3. cliquer « Rétablir les valeurs par défaut », relancer un run : `start_tagging` part sans `thresholds` et le sidecar applique les siens.

## Dependencies

- `01-protocole-ndjson-reglages-design.md` (statut: draft) : `version.default_thresholds` et `SidecarService.defaultThresholds`, seule source des valeurs de départ.
- `02-langue-et-signal-sonore-design.md` (statut: draft) : menu latéral (`SettingsSection`, `SECTIONS`, `menuItems`), section Interface, `mountWith(overrides, section)` et `vi.mock("@tauri-apps/plugin-store")` dans la spec de la page.

## Références de design

- **Maquette** : `SettingsScreen`, section Matching, rangées « Plancher » et « Seuil haut ». Rangée « Mode agent IA » écartée (Post-MVP, agent IA d'arbitrage). Bouton « Rétablir les valeurs par défaut » absent de la maquette, ajouté au Reste ouvert de `.design-sync/NOTES.md`.
- **Design system** : fiches `components/forms/Slider`, `components/forms/InputNumber`, `components/forms/SettingsRow`, `components/forms/Button`. Les valeurs de départ 70 et 90 qu'écrivent les fiches Slider et InputNumber ne sont pas reprises (Reste ouvert).
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À modifier** : `src/app/core/sidecar/protocol.ts` (`SCORE_SCALE`, à côté de `ThresholdsPayload`)
- **À modifier** : `src/app/core/platform/preferences.ts` (préférence `thresholds`)
- **À modifier** : `src/app/core/platform/preferences.spec.ts`
- **À modifier** : `src/fixtures/tauri-store.ts` (`storeOf`, store dont chaque clé a sa valeur)
- **À modifier** : `src/app/features/settings/settings-page.component.ts` (section `matching`, modèle des seuils, bornes, enregistrement, retour aux défauts)
- **À modifier** : `src/app/features/settings/settings-page.component.html` (section Matching)
- **À modifier** : `src/app/features/settings/settings-page.component.spec.ts`
- **À modifier** : `src/app/features/tagging/run/tagging-page.component.ts` (`start()` lit la préférence)
- **À modifier** : `src/app/features/tagging/run/tagging-page.component.spec.ts`
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`settings.matching.*`)
- **À modifier** : `docs/DESIGN.md` (ligne Seuils de matching, de « Post-MVP (non installés) » au Mapping, sans les valeurs de départ)
- **À modifier** : `docs/ARCHITECTURE.md` (l.208 : seuils réglés dans la section Matching ; l.385 : `thresholds` dans le `store` ; l.414 : seuils câblés)
- **À modifier** : `docs/PRODUCTION.md` (l.242 : seuils dans le tableau de la configuration runtime)

## Architecture approach

### Préférence `thresholds`

- `definePreference<ThresholdsPayload | null>("thresholds", null, accept)` dans `preferences.ts`, `ThresholdsPayload` venant de `protocol.ts`. `null` signifie « suivre les défauts du sidecar ».
- Le filtre `accept` n'admet qu'un objet de deux nombres finis tels que `0 <= floor <= ceiling <= 100` : une valeur éditée à la main hors de ces bornes retombe sur `null`, sans quoi `start_tagging` serait refusé en `malformed_command`. L'échelle 0–100 est une constante TS unique, commentée comme l'échelle des scores rapidfuzz : la librairie la fixe, ce n'est pas un réglage du projet. Le sidecar garde son propre contrôle (`check_thresholds`).

### Section Matching

- `SettingsSection` gagne `"matching"`, `SECTIONS` devient `["api", "matching", "interface", "admin"]`.
- Deux rangées, chacune un `p-slider` lié à un `p-inputnumber` sur la même valeur par Signal Forms (fiches Slider et InputNumber), aide sous le contrôle (arbitrage « Rangée de Réglages ») :
  - Plancher : appliqué séparément au score artiste et au score titre, en dessous le candidat est écarté ;
  - Seuil haut : appliqué à leur moyenne, au-dessus validation automatique, entre les deux correspondance incertaine (arbitrage « Vocabulaire zone grise »).
- Valeurs affichées : le réglage enregistré, sinon `SidecarService.defaultThresholds()`. Tant que ni l'un ni l'autre n'est connu, les deux rangées sont grisées. Le réglage est lu au montage par `readThresholds()`.
- Bornes croisées : le maximum du plancher est la valeur du seuil haut, le minimum du seuil haut celle du plancher, sur le curseur comme sur le champ. Les valeurs sont entières (pas de 1).
- Enregistrement en fin de geste : `onSlideEnd` du curseur (relâché, ou perte du focus après les flèches) et `onBlur` du champ, jamais à chaque cran. Des valeurs égales aux défauts du sidecar s'enregistrent `null` : le réglage suit alors les défauts, recalibrage futur compris.
- Bouton « Rétablir les valeurs par défaut » (`button pButton` `secondary` outlined `size="small"`), aligné à droite sous les rangées : il écrit `null`, les rangées reviennent aux défauts. Grisé quand aucun réglage n'est enregistré, la raison en tooltip (`TOOLTIP`), seule exception admise au rôle du tooltip (DESIGN.md § Règles).

### Lancement d'un run

- `start()` de `tagging-page.component.ts` lit `readThresholds()` au clic et appelle `startTagging(folder, thresholds ?? undefined)`. `startTagging` omet déjà une clé `undefined` : sans réglage, ou store indisponible, la commande part sans seuils et le sidecar applique les siens (une valeur, une source).
- `resume_run` reste inchangé : un run repris garde les seuils de son plan.

### Rules applicables

`.claude/rules/angular/components.md`, `.claude/rules/angular/forms.md`, `.claude/rules/angular/signals.md`, `.claude/rules/angular/tests.md`, `.claude/rules/ngx-translate/i18n.md`, `.claude/rules/primeng/composants.md`, `.claude/rules/tailwindcss/echelles.md`, `.claude/rules/tailwindcss/utilitaires.md`, `.claude/rules/typescript/types.md`, `.claude/rules/rapidfuzz/matching.md`, `.claude/rules/design/claude-design.md`.

## Acceptance criteria

### Scénario 1 : défauts du sidecar sans réglage
**GIVEN** aucun réglage enregistré et `version.default_thresholds` reçu
**WHEN** l'utilisateur ouvre la section Matching
**THEN** les deux rangées affichent les défauts du sidecar
**AND** « Rétablir les valeurs par défaut » est grisé, sa raison en tooltip

### Scénario 2 : réglage enregistré
**GIVEN** un seuil haut réglé à 95
**WHEN** l'utilisateur lâche le curseur
**THEN** la préférence `thresholds` porte le plancher affiché et un seuil haut à 95
**AND** « Rétablir les valeurs par défaut » devient actif

### Scénario 3 : le run part avec le réglage
**GIVEN** la préférence `thresholds` enregistrée
**WHEN** l'utilisateur lance un run depuis Tagging
**THEN** `start_tagging` porte ces `thresholds`

### Scénario 4 : retour aux défauts
**GIVEN** un réglage enregistré
**WHEN** l'utilisateur clique « Rétablir les valeurs par défaut »
**THEN** la préférence `thresholds` vaut `null` et les rangées affichent les défauts du sidecar
**AND** le run suivant part sans `thresholds`

### Scénario 5 : défauts réglés à la main
**GIVEN** un réglage enregistré
**WHEN** l'utilisateur ramène les deux valeurs exactement sur les défauts
**THEN** la préférence `thresholds` vaut `null`

### Scénario 6 : seuils jamais croisés
**GIVEN** un seuil haut à 80
**WHEN** l'utilisateur pousse le plancher au-delà
**THEN** le plancher s'arrête à 80

## Tests à écrire

### Unit
- `src/app/core/platform/preferences.spec.ts` :
  - un réglage valide est relu tel quel
  - un réglage édité hors bornes, croisé ou non numérique retombe sur `null`
- `src/app/features/settings/settings-page.component.spec.ts` :
  - sans réglage, les rangées montrent les défauts du sidecar et le retour aux défauts est grisé
  - un réglage enregistré prime sur les défauts
  - sans défauts ni réglage, les rangées sont grisées
  - enregistrer d'autres valeurs que les défauts les écrit
  - enregistrer les défauts écrit `null`
  - « Rétablir les valeurs par défaut » écrit `null` et ramène les rangées aux défauts
  - le maximum du plancher suit le seuil haut, le minimum du seuil haut suit le plancher
- `src/app/features/tagging/run/tagging-page.component.spec.ts` :
  - lancer un run envoie le réglage enregistré
  - lancer un run sans réglage n'envoie aucun seuil

## Edge cases

- **Moteur pas encore répondu** : sans défauts ni réglage, les rangées sont grisées plutôt qu'à zéro ; elles s'activent à l'arrivée de `version`.
- **Store indisponible (`just dev-ui`)** : les rangées montrent les défauts, un réglage s'applique à la page sans être retenu, et le run part sans seuils.
- **Défauts recalibrés par une version suivante** : un utilisateur sans réglage les suit d'office ; un réglage enregistré reste le sien jusqu'au retour aux défauts.
- **Fenêtre fermée pendant un réglage au clavier** : le cran non encore enregistré (focus jamais perdu) est perdu, le dernier réglage enregistré vaut.

## Architectural decisions

### Décision : forme des seuils dans la section Matching

**Options envisagées :**
- **A. Deux rangées, comme la maquette** : lisible, mais aucun retour aux défauts sinon à les retaper.
- **B. Deux rangées et « Rétablir les valeurs par défaut »** : un geste pour suivre de nouveau les défauts du sidecar.
- **C. Une rangée, curseur double** : compact, mais la plage entre les poignées se lit comme l'intervalle d'un même score, alors que le plancher porte sur les scores séparés et le seuil haut sur leur moyenne.
- **D. Défaut rappelé et retour par rangée** : précis, mais deux retours et deux rappels pour un geste rare.

**Choix : B** (choisi par le propriétaire le 2026-10-14 sur une planche des quatre variantes)

**Rationale :**
- Les défauts sont à recalibrer aux premiers runs réels (ADR-008) : un utilisateur qui a touché aux seuils doit pouvoir rejoindre les nouveaux sans connaître leurs valeurs.

### Décision : ce que la préférence retient

**Options envisagées :**
- **A. Les valeurs affichées, toujours** : simple, mais un premier enregistrement fige les défauts du jour, et un recalibrage n'atteint plus personne.
- **B. Un écart aux défauts, `null` sinon** : seul un réglage qui diffère est retenu et envoyé.

**Choix : B**

**Rationale :**
- « Une valeur, une source » : tant que l'utilisateur n'a pas d'avis, la valeur reste celle du sidecar, jamais une copie côté interface.
