---
feature: "Post-MVP Feature 1 : Démo web publique"
subproject: "rejeu-du-scenario"
goal: "Rejouer le scénario enregistré pour que chaque action du visiteur reçoive la réponse produite par le vrai sidecar, du choix de la playlist à la restauration du run"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["01-enregistreur-de-scenario-design.md", "02-shell-de-demo-design.md"]
date: "2026-10-25"
---

# Rejeu du scénario

## Scope

Ce lot complète le `ReplayTransport` du lot 2 :
- toute commande enregistrée reçoit sa réponse, choisie selon les issues courantes des trois morceaux à décision et la phase du run ;
- les lignes arrivent au rythme d'une vraie phase longue ;
- le rattrapage de « Lowlands » est pré-rempli ;
- les actions non enregistrées sont grisées en amont : interruption du run, second tagging, URL d'un morceau refusé ;
- un lien « Recommencer la démo » s'ajoute au bandeau.

Aucune règle métier n'est recalculée en TypeScript : la démo cherche une réponse et applique l'issue et la phase que celle-ci porte. Exclut l'image, la CI et Dokploy (lot 4).

### État livré

À la fin de ce sub-project, on peut jouer sous `just dev-demo`, de bout en bout dans le navigateur, le parcours playlist, extraction, tagging, arbitrage, rattrapage, écriture avec un échec relancé, récap, puis restauration. On peut ensuite repartir de zéro par « Recommencer la démo ».

## Dependencies

- `01-enregistreur-de-scenario-design.md` (statut: draft) : le scénario, avec sa table `key_fields`, ses issues de départ, ses réponses sans état et avec état, `sets` (issue donnée) et `enters` (phase atteinte). Modèle exact : `docs/superpowers/plans/demo-web-publique/01-enregistreur-de-scenario.md`, Task 3.
- `02-shell-de-demo-design.md` (statut: draft) : `demoConfig`, `DemoScenarioService`, `ReplayTransport` de démarrage (deux commandes), miroir `src/app/demo/scenario.ts`, constructeur de test `scenarioWith`, `APP_EDITION`, bandeau et raison `demo.unavailable`.

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx` (`TaggingScreen` : bouton d'action du run), `ArbitrationDialog.jsx` (`ArbitrationDialog` : étape lien), `AppShell.jsx` (bandeau sous la barre d'onglets)
- **Design system** : `components/overlay/Tooltip.prompt.md` (`force`, raison d'une action désactivée), `forms/Button.prompt.md` (variante `link`)
- **Arbitrages en vigueur** (`docs/DESIGN.md`) : icônes en SVG inline par `IconComponent` ; logo `size-5` dans la barre d'onglets ; barre d'onglets fusionnée avec la barre de titre, 40px.
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À créer** : `src/app/demo/replay.ts` + `replay.spec.ts` (fonctions pures : clé d'une commande, recherche d'une réponse, état suivant)
- **À créer** : `src/app/demo/replay-scenario.spec.ts` (rejeu de chaque combinaison enregistrée sur le vrai `src/demo/scenario.json`)
- **À modifier** : `src/app/demo/replay-transport.ts` + spec (toutes les commandes, rythme, état)
- **À créer** : `src/app/features/tagging/url-recovery/recovery-url-hint.ts` (jeton `RECOVERY_URL_HINT`)
- **À modifier** : `src/app/features/tagging/url-recovery/recovery-ui.store.ts` + spec (brouillon pré-rempli et verrouillé en démo)
- **À modifier** : `src/app/features/tagging/url-recovery/url-link-form.component.html` (champ en lecture seule s'il est verrouillé)
- **À modifier** : `src/app/features/tagging/url-recovery/url-link-actions.component.ts` + `.html` (raison de démo sur « Résoudre »)
- **À modifier** : `src/app/features/tagging/run/tagging-page.component.ts` + spec (interruption et second tagging grisés en démo)
- **À modifier** : `src/app/demo/demo-banner.component.ts` + `.html` + spec (lien « Recommencer la démo »)
- **À modifier** : `src/app/demo/demo.config.ts` (`RECOVERY_URL_HINT` tiré du scénario)
- **À modifier** : `src/fixtures/demo-scenario.ts` (défauts de `scenarioWith` étendus si un test le demande, aucun second constructeur)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`demo.banner.restart`)
- **À modifier** : `docs/DESIGN.md` (ligne « Bandeau de démo » du Mapping : second lien ; états du rattrapage en démo, via `Skill[design-doc]`)
- **À modifier** : `tsconfig.spec.json` (`resolveJsonModule`, si absent, pour lire `src/demo/scenario.json` dans un test)

## Architecture approach

- **Clé d'une commande** (`replay.ts`, fonctions pures, `.claude/rules/typescript/types.md`) :
  - La recherche ne compare jamais la commande entière : l'interface et l'enregistreur n'écrivent pas forcément les mêmes champs optionnels (`thresholds` absent, `playlist_name` à `null`).
  - Les champs qui comptent par commande sont lus dans `key_fields` du scénario, seule source, écrite par le lot 1 et fermée sur les commandes du protocole par sa garde Python. `commandKey(command, keyFields)` sérialise le nom de la commande et ces champs aux clés triées, un champ absent valant `null`, exactement comme `command_key` côté Python. Aucune table en TypeScript.
  - Elle s'applique aux deux côtés, à la commande reçue comme aux commandes du scénario.
  - `call` reste le rang d'une même clé dans la session. Au-delà du dernier rang enregistré, le dernier sert : la troisième extraction rend la même réponse que la deuxième.
- **État du rejeu** :
  - `{ outcomes, phase, calls }`. Au départ, `outcomes` vaut `initial_outcomes` du scénario (aucun `track_id` en dur en TypeScript), `phase` vaut `idle` et `calls` est vide. `start_tagging` fait entrer en `not_written`, comme sa réponse le porte.
  - Une réponse se cherche d'abord avec état, sur `(clé, outcomes, phase)` en égalité exacte des trois issues, puis sans état, sur `(clé, rang)`.
  - `calls[clé]` n'avance que lorsqu'une réponse sans état sert, comme l'enregistreur numérote `call`.
  - L'état suivant applique `sets` puis `enters` dès que la réponse est choisie, avant l'émission de ses lignes. Les requêtes que l'interface envoie pendant cette émission, comme `list_runs` et `get_rollback_target` après `run_finished`, voient déjà la nouvelle phase.
  - La démo ne déduit ni issue ni phase d'une commande.
  - L'état vit dans le transport, en signals privés (`.claude/rules/angular/signals.md`, `.claude/rules/angular/services.md`).
- **Couverture de l'ordre libre**, assurée par l'enregistrement du lot 1 :
  - Un geste d'arbitrage, retour à Beatport compris, est une réponse avec état : la progression du rattrapage qui le suit compte les morceaux à rattraper du run entier, elle dépend donc des issues des autres morceaux (relevé le 2026-10-26 au lot 1). Il se cherche comme toute réponse avec état, sur les issues courantes des trois morceaux à décision et la phase. Son `sets` porte l'issue qu'il produit ; le refus de Beatport et le retour à Beatport, gestes intermédiaires, n'en portent aucune.
  - Les sessions courtes du lot 1 enregistrent chaque geste d'arbitrage dans chaque état des deux autres morceaux, « Lowlands » rattrapé compris : le visiteur tranche dans l'ordre qu'il veut sans que la démo impose d'ordre. L'assemblage du lot 1 refuse deux réponses différentes pour une même clé.
  - Le rattrapage de « Lowlands » est avec état. Dans les 16 combinaisons où il est rattrapé, il vient après les autres décisions, donc il couvre chaque issue des deux autres morceaux, `pending` compris : un visiteur qui le rattrape en premier trouve la réponse enregistrée avec les deux autres en attente.
- **Émission toujours en différé** :
  - Aucune ligne n'est émise pendant `send`. L'interface pose son état d'attente avant d'envoyer, et `cancelTagging` agit encore après l'envoi.
  - Les lignes d'une phase longue (`extract_playlist`, `start_tagging`, `commit_run`, `retry_write`, `rollback`, `resolve_by_url`) partent espacées de `DEMO_LINE_DELAY_MS = 200` (mon choix, 2026-10-25) : la ligne d'index `i` (à partir de 0) à `i × 200` ms après l'envoi, la première au tour suivant de la boucle. Celles d'une consultation partent toutes au tour suivant.
  - Chaque ligne a son échéance, calculée depuis l'instant de son `send` : une réponse demandée pendant une phase longue s'intercale entre les lignes encore à venir, comme avec le vrai sidecar.
  - Le rythme se règle par une seule constante.
- **Version** : toute ligne `version` reprend `APP_VERSION` (déjà en place au lot 2).
- **Commande non enregistrée** : aucune réponse, et un `console.error` qui nomme la clé. C'est un défaut de scénario à corriger, pas un état normal. Les actions de l'interface qui y mènent sont grisées en amont, comme suit. La vérification du parcours complet (`/verify`) s'assure qu'aucune action accessible n'en produit.
- **Rattrapage de « Lowlands »** :
  - Le jeton `RECOVERY_URL_HINT: InjectionToken<(trackId: string) => string | null>` vaut `() => null` par défaut. `demoConfig` le fournit depuis les réponses `resolve_by_url` du scénario : `url` par `track_id`, toutes identiques pour « Lowlands ».
  - La fonction fournie lit `DemoScenarioService.scenario()` à chaque appel, pas à l'injection : le scénario est chargé par `ReplayTransport.start()` (lot 2), et le rattrapage ne s'ouvre qu'après le démarrage.
  - `RecoveryUiStore.draft(trackId)` rend le brouillon saisi, sinon l'indice.
  - En édition `demo`, un morceau avec indice a son champ en lecture seule. Un morceau sans indice a « Résoudre » grisé avec `demo.unavailable` en tooltip (`TOOLTIP`). Ces deux états visuels s'écrivent dans DESIGN.md avec le bandeau.
- **Bouton d'action du Tagging** : en édition `demo`, `blockedReason` prend `demo.unavailable` pour la seule action `start` dès qu'un run du visiteur a démarré (`taggingRunId() !== null`). L'action `cancel` reçoit la même raison. `commit` et `retry` restent libres.
- **« Recommencer la démo »** :
  - bouton `link` après « Me contacter », clé `demo.banner.restart` (« Recommencer la démo », « Restart the demo ») ;
  - il recharge `/` par `location.assign` : l'état du run vit en mémoire et disparaît, la langue enregistrée reste ;
  - la ligne « Bandeau de démo » de DESIGN.md (lot 2) est mise à jour : deux liens `link`.
- **i18n** : `.claude/rules/ngx-translate/i18n.md`. **Composants** : `.claude/rules/primeng/composants.md`. **Tests** : `.claude/rules/angular/tests.md`, flux en Observable selon `.claude/rules/angular/rxjs-interop.md` si un test le demande.

## Acceptance criteria

### Scénario 1 : parcours complet
**GIVEN** la démo ouverte sur Playlist
**WHEN** le visiteur choisit les dossiers et la playlist, extrait, passe au tagging, lance, tranche les deux arbitrages, rattrape « Lowlands », confirme l'écriture, relance l'écriture en échec, ouvre le récap puis restaure le run
**THEN** chaque étape affiche ce que le vrai sidecar a émis pour ces choix, compteurs et récap compris
**AND** aucune commande n'atterrit en console comme non enregistrée

### Scénario 2 : les choix changent la fin
**GIVEN** deux visites, l'une qui choisit le premier candidat Beatport de « Sub Rosa », l'autre qui le refuse
**WHEN** chacune confirme l'écriture
**THEN** le nombre de fichiers écrits et le récap diffèrent selon ce que l'enregistrement a produit pour chaque combinaison

### Scénario 3 : ordre libre
**GIVEN** un run en cours avec les deux arbitrages en file
**WHEN** le visiteur rattrape « Lowlands » d'abord, puis tranche « Тишина » avant « Sub Rosa »
**THEN** chaque réponse correspond à l'état du moment, et le compteur de rattrapage suit les issues courantes

### Scénario 4 : la progression se voit
**GIVEN** le tagging lancé
**WHEN** les réponses arrivent
**THEN** la barre de progression avance ligne à ligne, environ 200 ms entre deux événements
**AND** l'ouverture d'un run passé ou des Réglages répond sans attendre

### Scénario 5 : rattrapage pré-rempli
**GIVEN** « Lowlands » sans correspondance
**WHEN** le visiteur ouvre son rattrapage
**THEN** le champ montre l'URL enregistrée, non modifiable, et « Résoudre » est actif
**AND** pour un morceau refusé, « Résoudre » est grisé et le tooltip dit « Indisponible dans la démo. »

### Scénario 6 : un seul run, puis recommencer
**GIVEN** un run du visiteur démarré
**WHEN** il survole « Interrompre », puis, après l'écriture, « Lancer »
**THEN** les deux sont grisés avec « Indisponible dans la démo. »
**AND** « Recommencer la démo » recharge la démo sur Playlist, dans la langue choisie

### Scénario 7 : chaque combinaison enregistrée se rejoue
**GIVEN** le `src/demo/scenario.json` versionné
**WHEN** un test rejoue, depuis l'état initial, chaque combinaison d'issues et chacune de ses deux branches par les seules fonctions du rejeu
**THEN** aucune commande du parcours ne reste sans réponse, et chaque rejeu finit en phase restaurée

## Tests à écrire

### Unit
- `src/app/demo/replay.spec.ts` :
  - keys a command on the fields the scenario names, whatever the optional fields
  - treats a missing key field as null
  - answers the n-th identical command with the reply of its rank, then keeps the last one
  - prefers the stateful reply matching the current outcomes and phase
  - advances the rank only when a stateless reply serves
  - applies the outcome and the phase a reply carries before its lines are sent
  - returns nothing for an unrecorded command
- `src/app/demo/replay-scenario.spec.ts` (sur le vrai `src/demo/scenario.json`) :
  - replays every recorded combination from the initial state to its rollback
- `src/app/demo/replay-transport.spec.ts` :
  - emits nothing while send runs
  - emits a query's line on the next tick
  - spaces the lines of a long phase and answers a query at once
  - interleaves a reply requested during a long phase in order
  - answers a query sent during an emission with the new phase
  - reports an unrecorded command in the console without answering
- `src/app/features/tagging/url-recovery/recovery-ui.store.spec.ts` :
  - prefills and locks a recorded recovery URL in the demo edition
  - greys out resolving a track without recorded URL in the demo edition
  - keeps recovery free in the desktop edition
- `src/app/features/tagging/run/tagging-page.component.spec.ts` :
  - greys out interrupting and a second launch in the demo edition
  - keeps interrupting and launching again in the desktop edition
- `src/app/demo/demo-banner.component.spec.ts` :
  - restarts the demo from its home page

## Edge cases

- **Arbitrage tranché avant la fin de la phase réseau** : la réponse enregistrée est rejouée telle quelle (décidé le 2026-10-26). Le vrai sidecar n'émet le `progress` du rattrapage qu'après la phase réseau (`__main__.py`, `_then_url_progress`), la démo l'émet avec le geste. Seul effet visible : un refus tranché dans la fenêtre d'environ 2,4 s entre `arbitration_required` et `run_finished` voit le dernier `progress` enregistré du tagging remettre le total du rattrapage à 1 au lieu de 2, jusqu'au geste suivant ; lignes et boutons restent justes. Écartés : mettre la réponse en file après la phase (clic sans réponse pendant 2 s) et griser les arbitrages jusqu'au `run_finished` (raison de démo de plus dans la modale), plus coûteux que l'écart.
- **Run passé ouvert depuis les Réglages** : `load_run` du run passé, réponse sans état.
- **« Restaurer le dernier run » avant l'écriture du visiteur** : la réponse du démarrage dit qu'aucune cible n'existe, le bouton reste grisé par sa raison habituelle.
- **Rechargement de la page en cours de run** : tout repart de zéro, comme « Recommencer la démo ».
- **Clic répété sur « Extraire »** : rangs 1, 2, puis la réponse du rang 2 (tout déjà présent).
- **Réglages rouverts au milieu des arbitrages** : le lot 1 enregistre les trois requêtes de la page dans chaque état intermédiaire, la réponse avec état existe pour l'état courant.
- **Même issue atteinte par un autre chemin** (« Тишина » refusée sans passer par Bandcamp) : la réponse enregistrée est celle du chemin de l'enregistreur. La taille du cache peut différer d'une pochette de ce qu'un vrai run aurait donné, sans effet sur le parcours (mon choix, 2026-10-25).

## Architectural decisions

### Décision : comment reconnaître une commande

**Options envisagées :**
- **A. La commande entière, aux clés triées** : aucune table, mais un champ optionnel écrit d'un seul côté (`thresholds`, `playlist_name`) fait manquer la réponse.
- **B. Les seuls champs qui comptent, par une table portée par le scénario** : indifférente aux champs optionnels. La table est écrite par l'enregistreur, qui compte ses rangs avec, et fermée sur les commandes du protocole par la garde Python du lot 1. Une table TypeScript close par `never` aurait été une seconde source.

**Choix : B**

**Rationale :**
- L'interface et l'enregistreur construisent leurs commandes chacun de leur côté, et doivent compter les rangs de la même façon
- La table est de la configuration du rejeu, pas une règle métier : la lire ne calcule rien

### Décision : d'où vient la phase du run

**Options envisagées :**
- **A. Déduite en TypeScript** (après `commit_run`, écriture en échec, etc.) : rien à enregistrer de plus, mais l'interface reconstruirait l'état du sidecar.
- **B. Portée par la réponse (`enters`)**, comme l'issue (`sets`) : l'enregistreur sait quelle branche il joue.

**Choix : B**

**Rationale :**
- Le métier reste dans le sidecar, la démo n'applique que ce qu'il a produit
- `enters` fait partie du modèle du lot 1, gardé par le miroir du lot 2

### Décision : que faire des actions non enregistrées

**Options envisagées :**
- **A. Répondre par une erreur propre à la démo** : un message visible, mais un code que le sidecar ne connaît pas casse le miroir des codes d'erreur.
- **B. Les griser en amont avec `demo.unavailable`, et signaler en console une commande qui passerait quand même** : le visiteur voit la raison avant d'agir.

**Choix : B**

**Rationale :**
- Même motif que les actions indisponibles du lot 2
- Une commande qui passe malgré tout est un défaut de scénario, rendu visible plutôt que maquillé
