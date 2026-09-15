---
feature: "Feature 1 — Onglet Playlist, extraction sélective"
subproject: "service-sidecar-angular"
goal: "Établir depuis la webview la frontière unique vers le sidecar, en lançant le binaire et en transformant son flux NDJSON en état observable"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["04-protocole-ndjson-playlist-design.md"]
date: "2026-09-08"
---

# Service sidecar : lancement, flux NDJSON et état par signals

## Scope

Couvre les types miroir du contrat dans `protocol.ts`, le lancement du sidecar par `Command.sidecar("binaries/tagger")` puis `spawn()`, l'abonnement à `stdout` et `stderr`, la conversion de chaque ligne en événement typé, l'état de l'extraction porté par des signals, l'émission des commandes sur `stdin`, le contrôle de version au démarrage et le mode dégradé quand le sidecar est indisponible.

Exclut la file d'arbitrage et l'état du pipeline de tagging, qui relèvent de la Feature 2, et tout rendu visuel, qui relève du sub-project 07. Exclut la génération des types depuis les modèles Python : ils sont maintenus à la main, une vingtaine de types stables ne rentabilisant pas une génération.

### État livré

À la fin de ce sub-project, on peut : lancer l'application, voir le sidecar démarré et son événement `version` reçu, constater dans les outils de développement qu'un signal du service porte la version reçue, et vérifier par un test unitaire qu'un flux d'événements simulé met à jour les signaux attendus.

## Dependencies

- `04-protocole-ndjson-playlist-design.md` (statut: draft) — définit les commandes et les événements dont ce service est le miroir côté TypeScript.

## Files touched

- **À modifier** : `src/app/core/models/protocol.ts` (remplace le stub par les types miroir du contrat)
- **À modifier** : `src/app/core/sidecar.service.ts` (remplace le stub par le service)
- **À créer** : `src/app/core/sidecar.service.spec.ts`
- **À créer** : `src/app/core/sidecar-transport.ts` (frontière vers Tauri, remplaçable en test)
- **À modifier** : `src/app/app.config.ts` (initializer de démarrage du sidecar)
- **À modifier** : `src-tauri/Cargo.toml` et `src-tauri/src/lib.rs` (rechargement de la webview coupé en release)
- **À modifier** : `sidecar/src/tagger/handlers.py` et `sidecar/tests/unit/test_handlers.py` (version nue dans l'événement `version`)

## Architecture approach

- **Types miroir écrits à la main** dans `protocol.ts`, en unions discriminées sur `command` et `event`, exactement comme les modèles Pydantic du sidecar. Tout changement de champ se répercute des deux côtés, ce qu'ADR-005 acte explicitement.
- **Une frontière `sidecar-transport.ts` isole l'API Tauri** : elle expose le lancement, l'écriture d'une ligne et l'abonnement aux lignes reçues. Le service ne connaît que cette frontière, ce qui permet de le tester en la remplaçant, conformément à `.claude/rules/angular/tests.md` qui demande de mocker le protocole au niveau du service qui l'expose plutôt que les plugins Tauri sous-jacents.
- **`spawn()` et jamais `execute()`** : le protocole est un flux continu sur un process long. `execute()` attendrait la fin du process et supprimerait toute progression (cf. `.claude/rules/tauri/sidecar.md`).
- **Aucun tampon de réassemblage** : Tauri livre déjà une ligne complète par événement `stdout`. Le parsing se limite à convertir une ligne JSON en événement typé.
- **`stdout` porte le protocole, `stderr` les logs**, sans jamais les mélanger : les lignes de `stderr` sont journalisées, jamais interprétées comme des événements.
- **Une ligne illisible ne casse pas le flux** : elle est journalisée et ignorée, l'abonnement continuant de vivre. Un sidecar qui émettrait une ligne non conforme ne doit pas rendre l'application muette pour le reste de la session.
- **Le type guard ne vérifie que le discriminant `event`**, pas chaque champ : le sidecar est notre propre émetteur, dont Pydantic valide la sortie, et un validateur par événement écrirait le contrat une troisième fois. Coût assumé : un champ désynchronisé se verrait en `undefined` à l'écran plutôt qu'en trace console.
- **État exposé par signals natifs**, sans bibliothèque de store : version du sidecar, disponibilité, divergence de version, format de playlist reconnu, playlists listées, progression, résultat d'extraction, extraction en cours, dernière erreur, et `ready` qui dit si un run peut partir (sidecar lancé, version reçue et concordante, aucune extraction en cours). Les composants lisent ces signaux et émettent des commandes, ils ne calculent rien.
- **Une commande efface ce qu'elle rend périmé** : toute commande efface la dernière erreur, `list_playlists` efface le format et les playlists du fichier précédent, `extract_playlist` le résultat précédent. Un écran n'affiche jamais la réponse d'une autre demande que la sienne.
- **Aucune commande ne rend de promesse résolue sur « son » événement** : le contrat ne porte aucun identifiant de corrélation, et deviner l'appariement en attendant le prochain événement du bon type serait faux dès que deux commandes se croisent. Une commande écrit sur `stdin` et l'état arrive par le flux.
- **Lancement par initializer applicatif**, comme la résolution de langue : le spawn et le `get_version` d'ouverture partent au bootstrap. Contrairement à la langue, le premier rendu ne les attend pas, l'écran lisant `available` et `ready` au fil de l'eau. ARCHITECTURE décrit le sidecar comme un process long lancé au démarrage et `get_version` comme émise avant toute autre commande.
- **Contrôle de version au démarrage** : la version reçue, nue (`X.Y.Z`, jamais la release Sentry `techno-tagger@X.Y.Z`), est comparée à la constante de build `APP_VERSION`. Une divergence lève un signal dédié, l'interface devant alors refuser de lancer un run. Ce cas n'est pas théorique : l'installeur NSIS ne remplace pas le binaire du sidecar lors d'une réinstallation de même version, et une mise en quarantaine antivirus peut laisser une copie ancienne (cf. [ADR-018](../../../adrs/018-versionnement-plan-de-run.md) § Notes).
- **Mode dégradé hors Tauri** : `Command.sidecar()` échoue sous le `ng serve` seul de `just dev-ui`, comme `locale()`. L'échec est capté, un signal d'indisponibilité est levé et l'interface reste navigable. C'est ce qui rend ce mode utilisable pour travailler la mise en page, son seul usage.
- **Arrêt par la commande `shutdown`** et non par `Process.kill()`, qui ne cible que le bootloader d'un binaire PyInstaller et laisserait le process Python vivant.
- **Rechargement de la webview coupé en release** par `tauri-plugin-prevent-default` (`RELOAD` et `CONTEXT_MENU` seulement) : chaque rechargement relance l'initializer, donc un sidecar de plus, sans arrêter le précédent. Le debug le garde, pour le live reload.

## Acceptance criteria

### Scénario 1 : Démarrage nominal
**GIVEN** un sidecar présent et lançable
**WHEN** l'application démarre
**THEN** le sidecar est lancé une seule fois
**AND** une commande `get_version` lui est envoyée avant toute autre
**AND** le signal de version porte la valeur reçue

### Scénario 2 : Sidecar indisponible
**GIVEN** une webview servie sans Tauri, où le lancement échoue
**WHEN** l'application démarre
**THEN** aucune erreur ne remonte à l'utilisateur sous forme de plantage
**AND** le signal de disponibilité indique que le sidecar est absent
**AND** l'interface reste navigable

### Scénario 3 : Version divergente
**GIVEN** un sidecar dont la version diffère de celle de l'interface
**WHEN** l'événement `version` est reçu
**THEN** le signal de divergence de version est levé
**AND** il porte les deux versions, pour que l'interface puisse les afficher

### Scénario 4 : Playlists reçues
**GIVEN** un sidecar démarré
**WHEN** un événement `playlists_listed` arrive
**THEN** le signal des playlists porte les entrées reçues, avec leur identifiant, leur nom et leur nombre de morceaux
**AND** le signal de format porte le format annoncé par le sidecar

### Scénario 5 : Progression reçue
**GIVEN** une extraction en cours
**WHEN** des événements `progress` arrivent
**THEN** le signal de progression porte la phase, le nombre traité et le total du dernier événement reçu

### Scénario 6 : Extraction terminée
**GIVEN** une extraction en cours
**WHEN** l'événement `extraction_finished` arrive
**THEN** le signal de résultat porte les cinq catégories et le chemin du rapport
**AND** la progression est remise à son état de repos

### Scénario 7 : Erreur reçue
**GIVEN** un sidecar démarré
**WHEN** un événement `error` arrive
**THEN** le signal d'erreur porte son `code` et ses `params`
**AND** le flux reste actif pour les événements suivants

### Scénario 8 : Ligne illisible
**GIVEN** un sidecar démarré
**WHEN** une ligne qui n'est pas du JSON valide arrive sur `stdout`
**THEN** elle est ignorée sans lever, et tracée en console
**AND** un événement valide reçu ensuite est bien traité

### Scénario 9 : Événement inconnu
**GIVEN** un sidecar démarré
**WHEN** une ligne JSON valide porte un type d'événement non reconnu
**THEN** elle est ignorée sans lever, et tracée en console comme contrat désynchronisé
**AND** aucun signal n'est modifié

### Scénario 10 : Lignes de `stderr`
**GIVEN** un sidecar démarré
**WHEN** une ligne arrive sur `stderr`
**THEN** elle n'est jamais interprétée comme un événement du protocole

### Scénario 11 : Commande envoyée
**GIVEN** un sidecar démarré
**WHEN** une commande d'extraction est émise
**THEN** une ligne JSON unique est écrite sur `stdin`, terminée par un saut de ligne
**AND** elle porte le champ discriminant attendu par le sidecar

### Scénario 12 : Extraction en cours
**GIVEN** un sidecar prêt
**WHEN** une commande d'extraction est émise
**THEN** le signal d'extraction en cours est levé et le service n'est plus prêt
**AND** il le redevient au résultat, à une erreur ou à la fin du process

## Tests à écrire

### Unit

- `src/app/core/sidecar.service.spec.ts` :
  - le démarrage lance le sidecar une seule fois
  - une commande `get_version` est envoyée au démarrage
  - un événement `version` alimente le signal de version
  - une version identique à celle de l'interface ne lève pas la divergence
  - une version différente lève la divergence et porte les deux valeurs
  - un échec de lancement laisse le service dans un état indisponible sans lever
  - un événement `playlists_listed` alimente le signal des playlists et celui du format
  - un événement `progress` alimente le signal de progression
  - un événement `extraction_finished` alimente le signal de résultat et remet la progression au repos
  - un événement `error` alimente le signal d'erreur sans interrompre le flux
  - une ligne non-JSON est ignorée, et un événement valide reçu ensuite est traité
  - un événement de type inconnu est ignoré sans modifier aucun signal
  - une ligne de `stderr` ne modifie aucun signal
  - une commande émise écrit une ligne JSON unique terminée par un saut de ligne
  - le service n'est pas prêt avant la version, l'est après une version concordante, ne l'est pas sur une divergence
  - une commande émise sans sidecar ou dont l'écriture échoue pose l'erreur d'indisponibilité et arrête le run
  - la fin du process, le résultat et une erreur arrêtent le run et remettent la progression au repos
  - une commande d'extraction lève le signal d'extraction en cours
  - une commande efface l'erreur précédente, et un nouveau listage la réponse du fichier précédent

Le lancement réel du binaire, le découpage des lignes par Tauri et la sérialisation JSON ne sont pas testés : ce sont des comportements de bibliothèque ou de plateforme, qu'une mise à jour ferait échouer sans qu'aucune règle du projet ait bougé.

## Edge cases

- **Sidecar qui se termine en cours de session** : l'événement `Terminated` fait repasser le service en indisponible et arrête le run en cours, ce que l'interface peut alors signaler. Aucun redémarrage automatique n'est tenté : une reprise silencieuse masquerait un défaut qu'il vaut mieux voir.
- **Événement reçu avant la fin du démarrage** : les signaux sont initialisés à leur valeur de repos, un événement arrivant tôt est traité normalement.
- **Deux extractions successives** : le signal de résultat est remplacé, pas accumulé. L'historique des runs passés vit dans les rapports sur disque, pas en mémoire.
- **Commande émise alors que le sidecar est indisponible** : l'écriture est refusée sans lever, et le signal d'erreur porte le code `sidecar_unavailable`. L'interface est censée avoir désactivé l'action, mais le service ne dépend pas de cette discipline. Une écriture qui échoue sur un sidecar mort entre le lancement et la commande aboutit au même état, sans rejet remonté jusqu'au bootstrap.
- **Erreur reçue pendant un run** : la boucle du sidecar étant séquentielle, elle a interrompu ce run (rapport impossible à écrire après le dernier `progress`, par exemple). La progression revient au repos au lieu de rester figée.
- **Rechargement de la webview** : en debug, chaque rechargement ajoute un sidecar, tous tués à la fermeture de l'application. En release, le rechargement est coupé.

## Architectural decisions

### Décision : État par signals plutôt que commandes rendant une promesse

**Options envisagées :**
- **A. Le service expose des signals, les commandes n'attendent rien** : une commande écrit sur `stdin`, l'état arrive par le flux d'événements. Les composants lisent des signaux, ce qui correspond à la description d'ARCHITECTURE.
- **B. Chaque commande rend une promesse résolue sur son événement de réponse** : plus ergonomique à l'appel, mais le contrat ne porte aucun identifiant de corrélation. Apparier une réponse à sa demande reviendrait à attendre le prochain événement du bon type, ce qui devient faux dès que deux commandes se croisent.

**Choix : A**

**Rationale :**
- L'absence d'identifiant de corrélation dans le contrat n'est pas un oubli : le protocole est un flux d'événements, pas un appel-retour, et plusieurs événements répondent parfois à une seule commande, comme la suite de `progress` d'une extraction
- ARCHITECTURE décrit explicitement des composants qui lisent et émettent sans calculer, ce que des signaux servent directement
- L'option B introduirait un état d'appariement en attente, à nettoyer sur erreur et sur terminaison du sidecar, pour un confort d'appel que des signaux rendent inutile

### Décision : Une frontière de transport isole l'API Tauri

**Options envisagées :**
- **A. Un module `sidecar-transport.ts` expose lancement, écriture et abonnement** : le service ne connaît que cette frontière, remplaçable en test par une implémentation qui pousse des lignes à la demande.
- **B. Le service appelle `Command.sidecar()` directement** : un fichier de moins, mais tout test devrait alors simuler le module Tauri lui-même, ce que la rule de test du projet écarte.

**Choix : A**

**Rationale :**
- La rule de test demande de mocker le protocole au niveau du service qui l'expose, pas les plugins Tauri sous-jacents : une frontière est ce qui rend cette consigne applicable
- Le mode dégradé hors Tauri se loge naturellement dans cette frontière, qui est le seul endroit où l'absence de Tauri se constate
- Le service reste lisible : il traite des lignes et des signaux, sans détail de plateforme

### Décision : Aucun redémarrage automatique du sidecar

**Options envisagées :**
- **A. Un sidecar terminé fait passer le service en indisponible**, et l'interface le signale. L'utilisateur relance l'application.
- **B. Relancer automatiquement le sidecar** : l'application se répare seule, au risque de boucler sur un binaire manquant ou mis en quarantaine, et de masquer la cause.

**Choix : A**

**Rationale :**
- Les causes réelles d'un sidecar mort sont un binaire absent, remplacé ou mis en quarantaine par un antivirus, aucune ne se corrigeant par une nouvelle tentative
- Une reprise silencieuse rendrait invisible exactement le défaut que le contrôle de version cherche à rendre visible
- Le MVP n'a aucun run qui survive à un redémarrage : la reprise d'un run interrompu appartient à la Feature 6

### Décision : Couper le rechargement de la webview plutôt que rendre le lancement idempotent

**Options envisagées :**
- **A. Couper `RELOAD` et `CONTEXT_MENU` en release par `tauri-plugin-prevent-default`** : l'utilisateur ne peut plus déclencher de rechargement, le debug le garde pour le live reload.
- **B. Retrouver le sidecar précédent après un rechargement** (pid gardé en `sessionStorage`) pour le réutiliser ou l'arrêter avant d'en lancer un autre.
- **C. Tuer les process enfants côté Rust au rechargement de la page.**

**Choix : A**

**Rationale :**
- B ne peut pas réutiliser le process : son flux `stdout` était lié au contexte JS détruit par le rechargement, et le plugin `shell` ne permet pas de s'y réabonner
- Arrêter l'ancien sidecar n'est pas sûr non plus. Le tuer pendant un déplacement laisse en destination un fichier tronqué que le run suivant classe « déjà présent ». Lui envoyer `shutdown` le laisse finir son run, la boucle étant séquentielle, pendant que le nouveau démarre sur la même bibliothèque
- C a le même défaut de kill en plein transfert, et sort `src-tauri/src/` de la seule initialisation des plugins
- A ne couvre que les raccourcis et le menu : aucun `location.reload()` ne doit apparaître dans le code (cf. `.claude/rules/tauri/sidecar.md`)
