---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "interruption-du-run"
goal: "Permettre d'arrêter un run en cours depuis l'écran, sans fermer l'application"
status: "implemented"
complexity: "S"
tdd_scope: "partial"
depends_on:
  [
    "07-protocole-ndjson-tagging-design.md",
    "08-service-sidecar-tagging-design.md",
    "10-onglet-tagging-page-design.md",
  ]
date: "2026-09-25"
---

# Interruption d'un run en cours

## Scope

Couvre l'arrêt d'un run de re-tagging à la demande de l'utilisateur : la commande `cancel_run` du contrat NDJSON, son émission par le service, et le bouton qui la déclenche dans l'onglet Tagging. Le run s'arrête là où il en est, les morceaux déjà résolus gardent leurs résultats, et ceux que le run n'a pas atteints portent l'état « Non traité » déjà livré.

Exclut la reprise d'un run arrêté (Feature 6), l'interruption d'une extraction, qui est au contraire attendue jusqu'à son terme (cf. `cancel_run` de `_Session`, décision de l'[ADR-005](../../../adrs/005-sidecar-python-protocole-ndjson.md)), et la confirmation d'écriture, que le run interrompu laisse disponible sur ses morceaux résolus (Feature 5).

### État livré

À la fin de ce sub-project, on peut : lancer un run sur un dossier, voir les premières lignes se résoudre, cliquer « Interrompre », constater que la progression s'arrête immédiatement, que les lignes déjà résolues gardent leur source et leurs scores, et que les suivantes affichent « Non traité ».

## Dependencies

- `07-protocole-ndjson-tagging-design.md` (statut: implemented) : `CommandName`, `parse_command`, le dispatch de `__main__.py`.
- `08-service-sidecar-tagging-design.md` (statut: implemented) : `SidecarService.send`, `TaggingRunStore.failed()`.
- `10-onglet-tagging-page-design.md` (statut: implemented) : l'en-tête de la page et son bouton de lancement, à côté duquel celui-ci prend place.

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx`, composant `TaggingScreen` en phase `running`, dont l'en-tête porte le bouton. La maquette n'a pas d'interruption : l'écart est tranché ici et consigné dans `.design-sync/NOTES.md`.
- **Design system** : `components/forms/Button.prompt.md`
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À modifier** : `sidecar/src/tagger/protocol.py` (`CancelRun`, `"cancel_run"` dans `CommandName` et dans `AnyCommand`)
- **À modifier** : `sidecar/src/tagger/__main__.py` (branche `CancelRun` du `_dispatch`, `cancel_run()` asynchrone)
- **À modifier** : `sidecar/tests/unit/test_protocol_models.py` (parsing de la commande)
- **À modifier** : `sidecar/tests/integration/test_ndjson_loop.py` (un run annulé n'émet plus rien et la boucle reste vivante)
- **À modifier** : `src/app/core/sidecar.service.ts` (`cancelTagging()`)
- **À modifier** : `src/app/core/models/protocol.ts` (`CancelRunCommand` dans l'union)
- **À modifier** : `src/app/core/sidecar.service.spec.ts` (émission de la commande, arrêt du run)
- **À modifier** : `src/app/features/tagging/tagging-page.component.html`, `.ts` (le bouton et sa condition d'affichage)
- **À modifier** : `src/app/features/tagging/tagging-page.component.spec.ts` (le bouton n'existe que pendant un run)
- **À modifier** : `src/app/shared/components/icon.component.ts` (icône `stop`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.cancel`)
- **À modifier** : `docs/ARCHITECTURE.md` (la commande dans le contrat NDJSON)
- **À modifier** : `docs/DESIGN.md` (le bouton dans le Mapping Composants § Liste du run)
- **À modifier** : `.design-sync/NOTES.md` (l'écart à la maquette, qui n'a pas d'interruption)

## Architecture approach

- **La mécanique d'annulation existe déjà** : `_Session.cancel_run()` annule la tâche du run, et `shutdown` s'en sert depuis le sub-project 07. Ce sub-project l'expose comme commande et la rend **asynchrone** : elle attend que le run ait fini de mourir avant de rendre la main, sa sortie du cache attendant les téléchargements en vol. Sans cette attente, une relance lue entre-temps trouvait la tâche vivante et partait en `tagging_in_progress`, code que l'interface lit comme un run qui continue : l'écran restait bloqué en chargement. `run_tagging` étant une coroutine et non un `to_thread`, l'annulation atteint réellement les requêtes en vol : le quota techno-scraper cesse d'être consommé, ce qui est la raison d'être de la commande.
- **Aucun événement de fin n'est ajouté au contrat.** L'interface sait que le run s'est arrêté puisqu'elle l'a demandé : lui renvoyer l'information serait un aller-retour pour une chose déjà connue. `cancelTagging()` envoie la commande puis appelle `TaggingRunStore.failed()`, exactement ce que `endRun()` fait déjà quand le process meurt.
- **Commande sans champ**, sur le modèle de `Shutdown` et `GetVersion` : le sidecar n'a qu'un run à la fois (`TaggingInProgressError` le garantit), il n'y a donc pas de `run_id` à désigner. Idempotente : `cancel_run()` ne fait rien si aucun run ne tourne, et l'interface ne montre le bouton que pendant un run.
- **Traitée par le `_dispatch` et non par la boucle**, contrairement à `Shutdown` qui doit en sortir : l'annulation laisse la session vivante, et le `assert_never` du `match` verrouille l'oubli d'un handler (cf. `.claude/rules/python/type-hints.md`).
- **Aucun état de morceau nouveau** : un morceau que le run n'a pas atteint porte « Non traité », `secondary` et `minus-circle`, livré le 2026-09-25. Du point de vue de la ligne, un run annulé et un run planté disent la même chose — rien ne lui est arrivé. La cause appartient au run, qui la porte une fois, en haut de l'écran : un bandeau d'erreur quand il a planté, rien quand l'utilisateur a cliqué (décision ci-dessous).
- **Le bouton s'ajoute à gauche de celui du lancement**, qui reste visible et grisé : DESIGN.md interdit de masquer une action désactivée, arbitrage déjà tranché dans le sub-project 10 contre la maquette, qui fait disparaître le lancement hors phase `idle`. `secondary` outlined et non `danger` : le rouge est réservé aux trois actions qui touchent aux fichiers musicaux, et la phase réseau n'écrit rien.
- **Sans confirmation** : rien d'irréversible ne se produit, aucun fichier n'étant modifié avant la confirmation globale de l'écriture (`.claude/CLAUDE.md` § Standards). Une modale à l'instant où l'utilisateur veut que ça s'arrête ajouterait un clic à un geste déjà décidé.
- **i18n** : `tagging.cancel` dans les deux langues au même commit, libellé d'action à l'infinitif (cf. `.claude/rules/ngx-translate/i18n.md`).

## Acceptance criteria

### Scénario 1 : Interruption d'un run en cours

**GIVEN** un run lancé sur un dossier de 100 morceaux, 30 résolus
**WHEN** l'utilisateur clique « Interrompre »
**THEN** la commande `cancel_run` part vers le sidecar
**AND** la progression disparaît
**AND** les 30 morceaux résolus gardent leur source, leurs scores et leur pochette
**AND** les 70 autres affichent « Non traité »

### Scénario 2 : Le bouton n'existe qu'en cours de run

**GIVEN** l'onglet Tagging sans run en cours
**WHEN** l'écran s'affiche
**THEN** l'en-tête porte « Lancer le run » seul, sans bouton d'interruption
**AND** pendant un run, les deux boutons coexistent, le lancement grisé

### Scénario 3 : Relance après une interruption

**GIVEN** un run interrompu
**WHEN** l'utilisateur clique « Lancer le run »
**THEN** un nouveau run démarre et la liste repart vide
**AND** le sidecar ne refuse pas la commande pour un run déjà en cours

### Scénario 4 : Le sidecar reste disponible

**GIVEN** un run interrompu
**WHEN** l'interface envoie une autre commande, par exemple `get_version`
**THEN** le sidecar y répond normalement

## Tests à écrire

### Unit

- `sidecar/tests/unit/test_protocol_models.py` :
  - `cancel_run` se parse en `CancelRun`
- `src/app/core/sidecar.service.spec.ts` :
  - `cancelTagging()` envoie la commande `cancel_run` et arrête le run
- `src/app/features/tagging/tagging-page.component.spec.ts` :
  - le bouton d'interruption n'est rendu que pendant un run

### Integration

- `sidecar/tests/integration/test_ndjson_loop.py` :
  - un run annulé n'émet aucun événement de fin et la boucle répond à la commande suivante
  - un run relancé juste après une annulation n'est pas refusé, sur un run qui met du temps à mourir

> Le test de cohérence de `CommandName` déjà en place (`test_protocol_models.py`) couvre sans ajout l'appariement du littéral et du modèle.

## Edge cases

- **Aucun run en cours** : `cancel_run()` ne trouve pas de tâche active et ne fait rien. Aucune erreur n'est émise, l'interface n'exposant pas le bouton hors run.
- **Interruption pendant le parcours du dossier**, avant `run_started` : la lecture des tags passe par des `to_thread` dont l'annulation attend la fin, quelques centaines de millisecondes sur un gros dossier. Le run s'arrête ensuite sans émettre `run_started`, et `TaggingRunStore.failed()` n'étiquette rien, aucune ligne n'existant encore.
- **Arbitrages déjà tranchés** : perdus avec le run, la Feature 3 n'ayant pas de persistance d'arbitrage. Rien ne les recharge à la relance.

## Architectural decisions

### Décision : Ce que le sidecar renvoie à l'annulation

**Options envisagées :**

- **A. Un événement `run_cancelled`** : le sidecar confirme l'arrêt, l'interface l'attend avant de changer d'état. Le contrat gagne un événement et un `case` dans le `switch` exhaustif de la webview ; l'interface reste passive, ce qui est sa doctrine.
- **B. Aucun événement** : l'interface pose l'état localement après avoir envoyé la commande. Rien à ajouter au contrat, mais l'interface agit sur une chose qu'elle n'a pas lue.

**Choix : B**

**Rationale :**

- L'interface ne devine rien ici : elle est la source du geste, et l'état qu'elle pose est la conséquence directe de sa propre commande. C'est le cas inverse du champ `command` ajouté à `Error` le 2026-09-25, où elle devinait la commande fautive d'une chose qu'elle n'avait pas émise.
- `endRun()` applique déjà ce patron pour la mort du process : `failed()` est appelé sans qu'aucun événement l'annonce, faute d'un sidecar pour l'émettre.
- Un événement de confirmation laisserait une fenêtre où le bouton a été cliqué mais où l'écran tourne encore, avec la question de son état pendant ce temps. Rien ne justifie cette latence pour un geste dont l'effet local est certain.

### Décision : Pas d'état de morceau distinct pour l'annulation

**Options envisagées :**

- **A. Un état « Annulé »** : distingue le morceau que l'utilisateur a choisi de ne pas traiter de celui que le run a raté. Demande une clé i18n, une ligne dans le tableau des libellés de DESIGN.md, et un glyphe de plus dans la famille Neutre.
- **B. Le « Non traité » existant** : les deux causes partagent l'état, et la cause vit au niveau du run.

**Choix : B**

**Rationale :**

- `state` / `resolution` / `failure_reason` décrivent ce qui est arrivé **au morceau**. Un run annulé et un run planté lui disent la même chose : il n'a pas eu son tour. La cause est une propriété du run, la répéter sur chaque ligne en ferait cent copies d'une information unique.
- Elle est déjà à l'écran une fois, au bon endroit : un run planté affiche son bandeau d'erreur traduit, un run arrêté n'affiche rien parce que l'utilisateur vient de cliquer. Dans les deux cas il sait avant de lire la colonne.
- Deux pastilles neutres à glyphe voisin ne se distinguent pas au balayage d'un tableau de cent lignes, et DESIGN.md interdit par ailleurs `warn` sur un état de morceau, ce qui exclut de les séparer par la couleur.
