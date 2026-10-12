---
name: verify
description: Recette de /verify pour techno-tagger. Pilote le sidecar Python par son protocole NDJSON sur stdin/stdout sur une arborescence de test isolée et l'interface sous ng serve (Playwright) ou dans la fenêtre Tauri (CDP de WebView2). Écrite et maintenue par /verify lui-même.
allowed-tools: Bash(PYTHONPATH=tests/helpers uv run --directory sidecar python ${CLAUDE_SKILL_DIR}/scripts/*), Bash(LOCALAPPDATA=* PYTHONPATH=tests/helpers uv run --directory sidecar python ${CLAUDE_SKILL_DIR}/scripts/*), Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)
---

# verify - Recette de vérification runtime

## Surface

- **Sidecar** : process `python -m tagger`, commandes NDJSON sur `stdin`, événements sur `stdout`, logs sur `stderr`. Handle : `just dev-sidecar` (recette `[working-directory('sidecar')]`), alimenté par un pipe
- **Interface** (Angular + Tauri) : deux handles. `just dev-ui` sert la webview seule sur `http://localhost:4200`, pilotée par le MCP Playwright. `just dev` ouvre la vraie fenêtre Tauri : lancée avec `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"`, WebView2 s'inspecte par CDP (`http://127.0.0.1:9222/json`, puis `Runtime.evaluate` et `Page.captureScreenshot` depuis un script Node, `WebSocket` natif)

## Scripts

Tout code de pilotage vit dans `scripts/` et s'y range : **jamais un script dans le scratchpad**, qui meurt avec la session et laisse la recette pointer vers un fichier disparu. Le scratchpad ne reçoit que des **données** jetables, bibliothèques de test, dumps et sorties. Un besoin nouveau se couvre en étendant un script existant ou en en ajoutant un ici, jamais en recopiant.

**Les sondes Python se lancent par `PYTHONPATH=tests/helpers uv run --directory sidecar python <script>`** : elles importent les helpers de test du sidecar (`audio_samples`, `scraper_responses`, `rename_samples`...) sans `sys.path` à la main (rule `python/imports-modules.md`). Le cwd de `uv run --directory sidecar` est `sidecar/` : le chemin est `tests/helpers` et non `sidecar/tests/helpers` (relevé le 2026-10-11 : ce dernier rend `ModuleNotFoundError`). Sans la variable, les scripts rendent `{"error": true, "message": "No module named 'audio_samples' ..."}`. Pour ajouter un second dossier (le code de référence d'un `git archive`, § Pilotage du run de re-tagging), les séparer par `:` avec un chemin Git Bash (`PYTHONPATH=tests/helpers:/c/.../base/sidecar/src`) : un `;` fait mal convertir le second chemin (`C:\c\...`). `scripts/_probe.py` porte ce que les sondes partagent (`emit`, `fail`, `read_disk`) : il se trouve de lui-même, étant dans le dossier du script lancé.

| Script | Rôle | Lancement |
|---|---|---|
| `build_fixture.py` | Bibliothèque de test : trois morceaux connus du faux serveur, `--unique N` titres inédits pour qu'un run dure, `--arbitration` un seul morceau en zone grise, `--vlc-dump` un dump `vlc_media.db`, ou `--formats` un morceau valide par format (MP3, FLAC, WAV, AIFF) nommé d'après un titre du vrai catalogue et sali comme par `write_tags_probe.py` | `PYTHONPATH=tests/helpers uv run --directory sidecar python ${CLAUDE_SKILL_DIR}/scripts/build_fixture.py <dossier> [--unique N \| --arbitration \| --vlc-dump \| --formats]` |
| `fake_api.py` | Faux techno-scraper sur une vraie socket. `FAKE_DELAY` tient les requêtes en vol, `REJECT_ALL` rend 403 à tout. `BY_URL` sert les routes par URL du rattrapage (`/bandcamp/tracks`, `/soundcloud/resolve`, morceau ou profil), `FAILING_IDS` fait rendre 403 ou 503 à un id Beatport précis | importé par `drive.py` |
| `drive.py` | Vraie boucle NDJSON contre le faux serveur, ou contre une vraie gateway locale si `GATEWAY_URL` et `GATEWAY_KEY` sont posées. Une ligne `{"wait": 1.5}` du fichier de commandes retarde la suivante, `"$run_id"` dans une commande prend à son envoi le `run_id` du dernier `run_started`, une ligne `{"lock": "<fichier>", "for": 3}` tient ce fichier comme un lecteur audio pendant 3 s sans retarder la suivante. `BINARY=<exe>` lance le binaire figé à la place de la boucle en process, contre la vraie API et la clé du trousseau | `PYTHONPATH=tests/helpers uv run --directory sidecar python ${CLAUDE_SKILL_DIR}/scripts/drive.py <commandes.ndjson> [sortie.ndjson]` |
| `_probe.py` | Socle des sondes Python : `emit` (verdict JSON sur stdout), `fail` (verdict d'erreur, sortie 1) et `read_disk` (tags relus tels qu'écrits par `translate=False`, version ID3 et images à part, `ignore` pour écarter des clés). Importé, jamais lancé | néant |
| `write_tags_probe.py` | Écriture des tags hors protocole : bâtit un fichier par format, le salit (commentaires, verso et recto, date complète en v2.4, frames Serato), y écrit le candidat Beatport des fixtures avec une pochette, puis relit le disque par `read_disk` | `PYTHONPATH=tests/helpers uv run --directory sidecar python ${CLAUDE_SKILL_DIR}/scripts/write_tags_probe.py <dossier> [mp3 wav aiff flac]` |
| `restore_probe.py` | Aller-retour du dump des tags d'origine hors protocole : tague un MP3 v2.3, un MP3 v2.4, un WAV, un AIFF et un FLAC, lit leur origine, l'enregistre dans le dump (`folder` compris) sous `dump_dir()`, écrit le candidat Beatport des fixtures, consigne le chemin renommé au journal `.renames.ndjson` voisin, relit le dump (journal fusionné), le réécrit comme la fin de phase (journal supprimé) et restaure, puis compare le disque relu avant et après | `LOCALAPPDATA=<scratch>/appdata PYTHONPATH=tests/helpers uv run --directory sidecar python ${CLAUDE_SKILL_DIR}/scripts/restore_probe.py <dossier>` |
| `rename_probe.py` | Renommage de vrais fichiers hors protocole, par `plan_rename` puis `RenamePlan.apply()` (le plan est relevé avant que le fichier ne bouge) : simple (extension en majuscules), caractères interdits, collision, casse seule, sans artiste, titre tronqué, titre d'emojis, fichier dont l'ancien chemin dépasse 259 caractères, fichier tenu par un lecteur. Chaque cas bat son sous-dossier et relit le disque sous le nouveau nom | `PYTHONPATH=tests/helpers uv run --directory sidecar python ${CLAUDE_SKILL_DIR}/scripts/rename_probe.py <dossier>` |
| `write_phase_probe.py` | Phase d'écriture d'un run hors protocole : cinq fichiers tagués (deux résolus MP3 et FLAC, un troisième résolu tenu par un lecteur, un non résolu, un en attente), run ouvert par `open_run`, `RunWriter.write()` sous le verrou puis `retry()` une fois levé. `write()` et `retry()` ne rendent rien : le bilan compte les états des morceaux réglés (leurs `TrackResolved`). Un espion sur `write_tags` relit le dump au premier fichier écrit, un autre sur `RenamePlan.apply` relit le journal avant que le premier fichier ne bouge. Exige un dossier neuf | `LOCALAPPDATA=<scratch>/appdata PYTHONPATH=tests/helpers uv run --directory sidecar python ${CLAUDE_SKILL_DIR}/scripts/write_phase_probe.py <dossier neuf>` |
| `cdp.mjs` | Évalue un script de page dans la fenêtre Tauri, arguments dans `__args` ; `--key <touche>` frappe une vraie touche (`Input.dispatchKeyEvent`), `--screenshot <png>` capture la fenêtre, `--click <x> <y>` et `--move <x> <y>` donnent un vrai clic ou un survol souris (coordonnées CSS) ; une page qui meurt pendant l'appel rend `{"success": true, "pageClosed": true}` | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs <script.js> [argument ...]` |
| `page/demo-run.js` | Parcours de la démo pour une revue à l'écran : `playlist <demo-data>` pose les chemins et la playlist, `extract` clique « Extraire », `tagging` passe au tagging et lance le run, `run <dossier>` lance un run sans extraction dans la session, `state` compte les issues, `commit-dialog` ouvre la confirmation de l'écriture sans l'accepter et rend son texte, `column [onglet]` relève les enfants de la colonne d'une page et la marge sous le dernier visible (attendue nulle : relevé le 2026-10-11, 48px sur Tagging, venus des balises hôtes des modales fermées, ramenés à 0), `last-destination [clear]` lit la préférence, ou l'efface quand la démo l'a posée, `tag-widths <clé>` mesure en pixels les libellés d'une clé, FR et EN, dans la police d'un tag affiché | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs ${CLAUDE_SKILL_DIR}/scripts/page/demo-run.js <action> [cible]` |
| `page/arbitration-dialog.js` | Mesures de la modale d'arbitrage et de la liste du run, sans geste envoyé : `open` (par le badge), `state` (taille de la modale, sélection, options, message vide et leurs rectangles), `banner` (cellule réservée au-dessus de la liste, son contenu et le haut de la liste : 26px et liste immobile, avant comme après un refus Beatport, relevé le 2026-10-11), `footer`, `covers`, `rows` (lignes du run et leurs rectangles, onglet Tagging ouvert au besoin, pour viser l'une d'elles par `--click`), `state-icons` (centres du tag d'état et de l'icône d'info, fond et transition du tag), `tag-demo` (couleur du premier tag alternée avec puis sans sa transition, pour la juger à l'œil), `cursors` (curseur des éléments cliquables, bouton d'action du run compris), `trace` puis `trace-read` (journal souris et valeurs de `choice`) | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs ${CLAUDE_SKILL_DIR}/scripts/page/arbitration-dialog.js <action>` |
| `page/dialog-header.js` | En-tête de la modale ouverte : padding, titre, croix et son icône, écart du titre au bord gauche face à celui de l'icône au bord droit, décalage vertical de l'icône sur la ligne du titre (attendus égaux et nul, relevé le 2026-10-11 : 19px, 19px, 0), logo de la source face au titre (`logoToTitleCenter`, attendu nul), passage par `app-dialog-header` (arbitrage et lien). Sonde réalignée le 2026-10-11, à rejouer | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs ${CLAUDE_SKILL_DIR}/scripts/page/dialog-header.js`, modale ouverte par une autre sonde |
| `page/close-guard.js` | Garde de fermeture : pose un travail en cours (`pending extraction`, qui retient la fenêtre, `pending run-arbitrations`, qui ne la retient plus depuis le 2026-10-12, `clear` retire l'extraction posée), lit la confirmation (`state`, retours à la ligne des phrases compris : `itemWhiteSpace` attendu à `pre-line`), clique `stay`, `leave` ou `cross`, bascule la langue (`lang en`) | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs ${CLAUDE_SKILL_DIR}/scripts/page/close-guard.js <action> [cible]` |
| `page/resume-prompt.js` | Invite de reprise dans la fenêtre Tauri, sur un plan laissé par `drive.py` sous le même `LOCALAPPDATA` : `state` (titre, phrases, dossier tronqué et son sens, boutons, focus, largeur), `click <resume\|discard\|later>`, `restart` (arrête le moteur et le relance, pour reproposer un plan posé entre deux passes sans rouvrir la fenêtre), `tagging` (onglet Tagging après une reprise : dossier, bouton d'action, lignes, file d'arbitrage) | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs ${CLAUDE_SKILL_DIR}/scripts/page/resume-prompt.js <action> [cible]` |
| `page/app-health.js` | Premier contrôle après une montée de dépendances ou un changement de décorateur DI : `state` (service résolu par l'injecteur, `available`, `version`, `versionMismatch`, langue, onglets), `tabs` (chaque `p-tab` cliqué, URL et `h1` relevés, plus sur Réglages le placeholder de la clé, l'absence de tag d'état et de l'œil), `list <dump>` (`listPlaylists` par le vrai sidecar) | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs ${CLAUDE_SKILL_DIR}/scripts/page/app-health.js <action> [dump]` |
| `page/preamble.js` | Ce que toutes les sondes partagent : `wait`, `until` (attente d'une condition de page) et `__sidecarService()`, le service vivant de la page | préalable injecté par `cdp.mjs` devant chaque script de page, jamais recopié dans une sonde |
| `page/cancel-run.js` | Interruption d'un run puis relance immédiate, de bout en bout, par le bouton d'action unique (`data-action` relevé à chaque étape). Un run interrompu qui garde un morceau résolu laisse « Confirmer l'écriture » sur son dossier : la relance passe alors par `service.startTagging`, le geste du bouton en `start`, et le rendu dit laquelle des deux voies a servi (`restart.via`) | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs ${CLAUDE_SKILL_DIR}/scripts/page/cancel-run.js <dossier>`, dossier de `build_fixture.py --unique 20` |
| `page/arbitration-replay.js` | Rejoue dans la fenêtre le flux réel d'un run d'arbitrage (sortie de `drive.py`) en intercalant les gestes du service, `send` relevé au lieu d'envoyé ; les groupes en surplus partent après la dernière ligne, geste encore sans réponse, et `["click", "<sélecteur>"]` y clique un élément de la page | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs ${CLAUDE_SKILL_DIR}/scripts/page/arbitration-replay.js "$(cat <sortie.ndjson>)" '<gestes JSON>'` |
| `page/url-recovery-modal.js` | Rattrapage par modale sous `ng serve`, sidecar simulé : tout le parcours de § Pilotage du rattrapage par URL > Côté webview, un contrôle par règle ; captures dans `.playwright-mcp/verify-recovery/` | MCP Playwright `browser_run_code_unsafe` avec `filename` sur ce fichier, `just dev-ui` lancé |
| `page/track-detail.js` | Détail avant / après déplié sous la ligne, sous `ng serve`, sidecar simulé : un contrôle par règle de § Pilotage du détail déplié ; captures dans `.playwright-mcp/verify-detail/` | MCP Playwright `browser_run_code_unsafe` avec `filename` sur ce fichier, `just dev-ui` lancé |
| `page/write-confirmation.js` | Confirmation et suivi de l'écriture sous `ng serve`, sidecar simulé : un contrôle par règle de § Pilotage de la confirmation d'écriture ; captures dans `.playwright-mcp/verify-write/` | MCP Playwright `browser_run_code_unsafe` avec `filename` sur ce fichier, `just dev-ui` lancé |
| `run_page.mjs` | Lance une sonde `page/*.js` sous `ng serve` dans un Chromium headless, sans le MCP Playwright : sortie limitée au JSON de la sonde (le MCP recopie le code), et une recette qui avance quand le MCP reste bloqué (relevé le 2026-10-11 : 30 minutes sans réponse). `PLAYWRIGHT_CORE` désigne un `playwright-core` dont la révision de navigateur est téléchargée (cache npx du MCP) | `PLAYWRIGHT_CORE=<dossier> node ${CLAUDE_SKILL_DIR}/scripts/run_page.mjs ${CLAUDE_SKILL_DIR}/scripts/page/<sonde>.js`, depuis la racine du dépôt, `just dev-ui` lancé |
| `page/rollback-ui.js` | Rollback depuis l'interface sous `ng serve`, sidecar simulé : un contrôle par règle de § Pilotage du rollback depuis l'interface, Réglages compris ; captures dans `.playwright-mcp/verify-rollback/` | MCP Playwright `browser_run_code_unsafe` avec `filename` sur ce fichier, `just dev-ui` lancé |
| `page/recap.js` | Récapitulatif d'un run écrit sous `ng serve`, sidecar simulé : un contrôle par règle de § Pilotage du récapitulatif ; `__TAURI_INTERNALS__` posé après le démarrage relève l'ouverture de la fiche source ; captures dans `.playwright-mcp/verify-recap/` | `PLAYWRIGHT_CORE=<dossier> node ${CLAUDE_SKILL_DIR}/scripts/run_page.mjs ${CLAUDE_SKILL_DIR}/scripts/page/recap.js`, `just dev-ui` lancé |
| `page/past-runs.js` | Runs passés sous `ng serve`, sidecar simulé par le transport (`svc.transport.send` relevé, le vrai `send` gardé) : un contrôle par règle de § Pilotage des runs passés, rangée des Réglages et récapitulatif en lecture seule compris ; `__TAURI_INTERNALS__` posé après le démarrage relève l'ouverture de la fiche source ; captures dans `.playwright-mcp/verify-past-runs/` | `PLAYWRIGHT_CORE=<dossier> node ${CLAUDE_SKILL_DIR}/scripts/run_page.mjs ${CLAUDE_SKILL_DIR}/scripts/page/past-runs.js`, `just dev-ui` lancé |
| `page/playlist-run-guard.js` | « Extraire » sous `ng serve`, sidecar simulé : actif avant le run, désactivé pendant la recherche (tooltip `playlist.blocked.tagging` sous le bouton), réactivé à `run_finished` ; réalignée le 2026-10-11, à rejouer | MCP Playwright `browser_run_code_unsafe` avec `filename` sur ce fichier, `just dev-ui` lancé |
| `page/url-recovery.js` | Modale du lien dans la fenêtre Tauri : `open <n>` l'ouvre par la ligne rattrapable d'index `n` (base 0), `paste <url>` colle, clique « Résoudre » et attend la réponse, `state` relève la barre, le badge, la modale (en-tête par `app-dialog-header`) et l'écart de l'erreur au champ et au pied (attendu égal, DESIGN.md § Feedback et chargement) | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs ${CLAUDE_SKILL_DIR}/scripts/page/url-recovery.js <action> [n \| url]` |
| `page/recovery-demo.js` | Démo vivante pour une revue à l'écran : un run simulé défile dans la fenêtre Tauri, puis chaque geste reçoit une réponse plausible (lien Beatport, Bandcamp ou SoundCloud rattrapé, autre lien refusé, refus Beatport puis Bandcamp vers l'étape lien) sans rien envoyer au sidecar ni à l'API. Perdue au moindre rechargement : ne rien éditer pendant la démo | `node ${CLAUDE_SKILL_DIR}/scripts/cdp.mjs ${CLAUDE_SKILL_DIR}/scripts/page/recovery-demo.js` |

Chaque script rend `{"success": true, ...}` ou `{"error": true, "message": "..."}` sur `stdout`, code de sortie 1 en erreur. Rapporter le message tel quel : il nomme le geste qui répare, lancer par `PYTHONPATH=tests/helpers uv run --directory sidecar` ou ouvrir la fenêtre avec le port de débogage.

## Fixture isolée

Les données dans le scratchpad de session, jamais dans le dépôt ni dans une vraie bibliothèque. `scripts/build_fixture.py` bâtit une bibliothèque de morceaux, ou par `--vlc-dump` un dump aux playlists `test playlist` et `other playlist` : c'est de la mise en place, pas une vérification.

Pour l'onglet Playlist, `just demo` bâtit `demo-data/` (git-ignoré) : 30 morceaux de plusieurs dizaines de Mo, qui couvrent les cinq catégories du rapport, dump `vlc_media.db` avec la playlist `test playlist`. L'échec de transfert demande `just demo --lock <secondes>` en arrière-plan pendant le run. `--lock` ne reconstruit rien : relancer `just demo` seul avant chaque run, verrou arrêté, sinon la destination garde le run précédent.

## Pilotage

```bash
{ printf '{"command":"get_version"}\n'
  printf '{"command":"extract_playlist","source_folder":"%s","destination_folder":"%s","playlist_path":"%s","playlist_name":"test playlist"}\n' "$V/library" "$V/work" "$V/vlc_media.db"
} | just dev-sidecar > "$V/out" 2> "$V/err"; echo "EXIT=$?"
```

Relire `stdout` (chaque ligne doit se parser seule en objet JSON, sans indentation), `stderr` à part, puis l'état du disque (`work`, rapports, bibliothèque intacte).

Poser `LOCALAPPDATA="$V/appdata"` sur le lancement isole la racine des données (`tagger.paths.app_data_dir()`) : le sidecar écrit alors ses logs et plus tard son cache, sous `$V/appdata/fr.empiricmind.techno-tagger/`, jamais dans le profil réel. C'est aussi ce qui prouve que la racine est bien composée avec l'identifiant de bundle.

### Flux qui valent le coup

- Nominal : `get_version`, `list_playlists` (dump puis M3U8), `extract_playlist` avec homonyme, rapport `.json` + `.md` présents
- Refus sans arrêt de la boucle : champ en trop, ligne non-JSON, commande inconnue (`params.command`), playlist inconnue, fichier non décodable, destination impossible à créer (chemin occupé par un fichier). Enchaîner un `get_version` après chacun
- Fin : `shutdown` suivi d'une commande (ignorée, sortie 0), `stdin` vide (sortie 0)
- État : relancer la même extraction dans la même destination (catégorie `already_present`, rapports suffixés `-2`, `-3` dans la même seconde)

## Pilotage du cache disque

Les classes de `tagger/cache.py` s'exercent hors protocole tant que la boucle de commandes ne les câble pas. Aucun script ne les pilote encore : au premier besoin, en écrire un dans `scripts/`, lancé par `PYTHONPATH=tests/helpers uv run --directory sidecar python`. Il vaut mieux qu'un test : vrai système de fichiers, vrai `httpx2.AsyncClient` contre un `http.server` local servant de faux CDN, ni `MockTransport` ni horloge injectée.

L'âge d'une entrée se force en renommant l'epoch de son nom (`<hash>.<epoch>.<ext>`), là où le cache le lit : `DiskCache` rouvert sur le dossier purge alors ce qui a dépassé le TTL, sans qu'aucune horloge ait été truquée.

Le faux CDN se scinde en deux, parce qu'`ArtworkFetcher` refuse toute URL qui n'est pas en `https` vers une adresse publique. Le garde-fou se vérifie contre le vrai serveur local, avec le résolveur réel : `https://localhost/...` doit partir en `blocked_url` par résolution DNS et le serveur rester à zéro requête reçue. Le téléchargement, lui, ne peut plus le viser et passe par un `MockTransport` sous une URL `https` d'apparence publique, avec un `resolve=` injecté qui rend une adresse publique : client, streaming, cache et disque restent réels, seules la résolution et la couche TCP sont détournées.

### Flux qui valent le coup

- Cache disque : entrée relue puis vieillie au-delà du TTL et purgée à la réouverture ; plafond bas et quatre écritures, celle qu'on vient de relire survit et la moins récemment lue part ; dossier supprimé en plein usage, la lecture rend un miss et l'écriture suivante le recrée ; réponse relue quel que soit l'ordre des paramètres et lisible en JSON sur le disque
- Pochettes : téléchargement unique puis service depuis le cache, deux appels concurrents sur la même URL ne faisant qu'une requête, extension tirée du `Content-Type` quelle que soit sa casse, octets identiques à ceux du CDN, redirection vers un hôte public suivie, `404` et contenu non-image levant `ArtworkUnavailableError` sans rien publier et sans l'URL dans les `params`, douzaine d'URL distinctes en `TaskGroup` pour voir le pool tenir
- Garde-fou d'URL : `http` en clair, boucle locale, réseau privé et schéma hors http refusés en `blocked_url`, le serveur local restant à zéro requête reçue

## Pilotage de l'écriture des tags

`write_tags` s'exerce hors protocole par `scripts/write_tags_probe.py` (par le protocole : § Pilotage de la phase d'écriture). Les morceaux de `just demo` ne portent pas de vrai flux MPEG (mutagen lève `HeaderNotFoundError` sur leurs MP3) : le script bâtit ses fichiers par `audio_samples`, comme les tests, et c'est la combinaison de tags sales qui fait sa valeur.

### Flux qui valent le coup

- Quatre formats : `written_fields` à 14 et `artwork` vrai, ID3 relu en `2.3.0` avec `TYER` seul à l'année du candidat (aucune année d'origine, ADR-011 du 2026-10-11) alors que le fichier portait `TDRC` « 2019-06-16 » en v2.4, ni `TDRC`, ni `TDAT`, ni `COMM` ; FLAC sans `COMMENT` ni `DESCRIPTION`. Une seule image partout, recto `image/jpeg`
- Hors table : `PRIV:Serato` et `TXXX:SERATO_PLAYCOUNT` (ID3), `SERATO_PLAYCOUNT` (FLAC) intacts

Parcours relevé le 2026-10-07, tous verts. Le parcours change au 2026-10-11 : plus de `TORY` (ADR-011), `written_fields` à 14. Rejoué le 2026-10-11 à la clôture de l'epic : quatre formats verts. Rejoué le 2026-10-11 sur la branche des finitions (`read_disk` déplacé dans `_probe.py`) : quatre formats verts, 14 champs, ID3 en `2.3.0` avec `TYER` seul, une image recto `image/jpeg`, frames Serato intactes, `comment_left` faux.

### Échec de transfert à l'extraction

Les motifs d'échec de fichier sont partagés par l'extraction et l'écriture (`tagger/file_failures.py`). `just demo --root <scratch> --size-mb 20`, puis `demo.py --lock 25` en arrière-plan et `extract_playlist` de `test playlist` : 24 extraits, 2 déjà présents, 3 introuvables, 3 doublons et un échec `file_locked` sur « Ilán Thorne - As We Stayed.wav », dans `extraction_finished.failures` comme dans les rapports `.json` et `.md`. Relevé le 2026-10-07.

## Pilotage du dump des tags d'origine

`read_original_tags`, `restore_tags` et le dump d'un run (`tagger/tag_dump.py`) s'exercent hors protocole par `scripts/restore_probe.py`, qui couvre cinq formats là où la fixture du protocole n'a que des MP3 (rollback par le protocole : § Pilotage du rollback). `LOCALAPPDATA` vers le scratchpad est obligatoire : sans lui, le dump s'écrit sous le vrai profil.

La purge se pilote par le vrai sidecar : poser dans `<LOCALAPPDATA>/fr.empiricmind.techno-tagger/dumps/` des fichiers `{}` nommés `<YYYYMMDDTHHMMSSZ>-<run_id>.json` de part et d'autre des 30 jours, un `notes.json`, puis lancer `python -m tagger` avec un `get_version` sur `stdin`. Un dump verrouillé s'obtient par `held_open` d'`audio_samples` autour du lancement (`subprocess.run` dans un `PYTHONPATH=tests/helpers uv run --directory sidecar python -c`, la variable étant héritée par le sous-process).

### Flux qui valent le coup

- Aller-retour : les cinq cas `identical`, version relue identique à l'origine (`2.4.0` repart en `2.4.0` après une écriture en `2.3.0`, les v2.3 gardent `TYER` et `TDAT`), `TXXX:SERATO_PLAYCOUNT` intact. Deux artistes : deux valeurs en v2.4 et en FLAC, une chaîne `lior vance/mara quill` en v2.3. Dump relu en `schema_version` 1, `folder` gardé, `renamed_path` renseigné, entrées dans l'ordre d'écriture
- Journal des renommages : avant la réécriture, `.renames.ndjson` voisin présent et le fichier du dump sans aucun `renamed_path` (0 sur 5), `load_dump` les fusionne (5 sur 5) ; après `rewrite_dump`, journal supprimé et les 5 `renamed_path` dans le fichier du dump
- Purge au démarrage : dumps et `.tmp` d'écriture coupée de plus de 30 jours supprimés, y compris ceux qui suivent un dump verrouillé, celui-ci gardé avec un `WARNING tag dump not purged run=<run_id> reason=unlink_failed` ; dump et `.tmp` récents, `notes.json` intacts ; `version` répondue, sortie 0

Parcours relevé le 2026-10-07, tous verts. Rejoué le 2026-10-11 à la clôture de l'epic : cinq cas `identical`. Rejoué le 2026-10-11 sur la branche des finitions (dump avec `folder`, journal fusionné puis réécrit) : cinq cas `identical`, `folder_kept` vrai, journal 0 / 5 / 5 comme ci-dessus. La purge des journaux (`.ndjson` rangé avec les dumps passés la rétention) n'a pas été rejouée par le vrai sidecar.

## Pilotage du renommage

`plan_rename` puis `RenamePlan.apply()` (qui ont remplacé `rename_track` et son rappel `before_rename`) s'exercent hors protocole par `scripts/rename_probe.py`, sur de vrais fichiers de quelques octets (le renommage ne lit pas leur contenu) : le script relit le disque sous le nouveau nom, par `rename_now` des helpers de test.

### Flux qui valent le coup

- Plan : `plan_rename` rend la cible (`RenamePlan.target`, sans préfixe `\\?\`) alors que le fichier n'a pas bougé ; `None` quand le fichier garde son nom (sans artiste, ou déjà au nom voulu)
- Noms : `lior vance - dim orbit.MP3` devient `Lior Vance - Dim Orbit (Extended Mix).mp3` ; `QX/RT` et `Mind: Body (Who? Remix)` donnent `QX-RT - Down In Amber.flac` et `Someone - Mind - Body (Who Remix).wav` ; sans artiste, `rip_0042.wav` garde son nom
- Collision : le fichier existant reste intact (octets relus), les suivants prennent ` (2)` puis ` (3)`. Casse seule : renommé sans suffixe
- Longueur : dans un dossier qui laisse 40 caractères au nom, le titre est coupé à 40 et le chemin rendu tient en 259. Un titre d'emojis se compte en unités UTF-16, comme NTFS et `MAX_PATH` : relevé à 258 unités pour 255 caractères Python. Un fichier dont l'ancien chemin fait 305 caractères est renommé et relu par le préfixe `\\?\`, le chemin rendu n'en porte pas
- Verrou : `held_open` d'`audio_samples` autour de l'appel, `RenameError` au motif `file_locked` levée par `apply()` (le plan, lui, est calculé) et le fichier garde son nom

Parcours relevé le 2026-10-08, neuf cas verts, rejoués verts le 2026-10-11 à la clôture de l'epic et le même jour sur la branche des finitions (`plan_rename` puis `apply()`, plan relevé avant le déplacement, 258 unités pour 255 caractères, 305 caractères renommés). **Le cas du chemin de 305 caractères ne prouve pas la nécessité du préfixe sur une machine dont `LongPathsEnabled` vaut 1** (celle de développement) : Python, manifesté, y renomme aussi sans préfixe, contre-épreuve faite en remplaçant `extended_path` par l'identité dans `rename_track` (devenu `plan_rename`). Le préfixe passé à l'appel est gardé par `test_renames_through_the_extended_path`. Pour le voir échouer, rejouer le script sur une machine où la clé vaut 0, ce qui est le défaut chez l'utilisateur.

## Pilotage de la phase d'écriture

`RunWriter` (`tagger/writing.py`) s'exerce hors protocole par `scripts/write_phase_probe.py`, qui pose à la main des états qu'un run du faux serveur ne donne pas tous (MP3 et FLAC résolus côte à côte, un morceau verrouillé parmi d'autres). Le run part d'`open_run` sur le dossier, comme en production : seuls les états des morceaux sont posés à la main. `LOCALAPPDATA` vers le scratchpad est obligatoire, le dump s'écrivant sous `dump_dir()`. Le script configure `logging` vers `stderr` : les lignes `write phase` s'y relisent.

### Flux qui valent le coup

- Écriture sous verrou : bilan `summary` à `written` 2 et `failed` 1 (`WriteSummary` a disparu : `write()` ne rend rien, la sonde compte les états des `TrackResolved` de la phase), MP3 et FLAC en `written` renommés `Lior Vance - Dim Orbit (Extended Mix)`, 14 champs, pochette posée, nom non tronqué, `restorable` vrai ; le fichier tenu par `held_open` en `write_error` / `file_locked`, nom d'origine gardé, `restorable` vrai (son origine est au dump) ; non résolu et en attente identiques à l'octet près, `restorable` faux, et jamais passés par `write_tags`
- Dump : au premier fichier écrit, il porte déjà l'origine des trois morceaux visés (titre `dim orbit`), jamais celle du non résolu ni de l'attente, sans journal encore (la note d'un fichier suit son `write_tags`). Juste avant le premier renommage (espion sur `RenamePlan.apply`), le journal `.renames.ndjson` porte déjà la cible de ce fichier alors que la source existe encore et la cible pas : noté avant que le fichier ne bouge. En fin de phase le journal est supprimé et le dump porte le chemin renommé de chacun, `folder` du run gardé
- Événements : `TrackResolved` puis `WriteProgress` par morceau tranché
- Relance, verrou levé : bilan `written` 1 et `failed` 0, seul le fichier verrouillé repasse par `write_tags`, renommé avec ` (2)` (le premier MP3 tient déjà le nom), origine du dump inchangée, journal de nouveau supprimé en fin de phase
- `stderr` : `write phase started` et `finished` en INFO avec `run`, `write failed run=<id> track=3 reason=file_locked` en ERROR, ni chemin ni titre

Parcours relevé le 2026-10-09, tous verts. Le parcours change au 2026-10-11 : plus de `TORY` (ADR-011), les morceaux écrits portent 14 champs. Rejoué le 2026-10-11 à la clôture de l'epic : tous verts. Rejoué le 2026-10-11 sur la branche des finitions : tous verts, `restorable` et journal relevés comme ci-dessus, `stderr` à `write phase started` / `finished` et `write failed run=<id> track=3 reason=file_locked`.

### Par le protocole

`commit_run` et `retry_write` se pilotent par `drive.py` sur la fixture par défaut de `build_fixture.py` : ses deux morceaux connus partent en arbitrage, que `resolve_arbitration` à l'index 0 tranche en `resolved`, le troisième finit `unresolved`. Les `track_id` sont les noms de fichiers, le `run_id` vient de `"$run_id"`. `LOCALAPPDATA` vers le scratchpad, le dump s'écrivant sous `dump_dir()`.

- Refus `write_not_open` : `retry_write` avant tout run, puis sur le run courant jamais confirmé ; `commit_run` sur un autre `run_id` ; second `commit_run` après l'écriture. Chacun porte sa `command`, la boucle continue
- Écriture : un seul morceau tranché, `commit_run` rend `track_resolved` en `written` / `arbitration` avec `restorable` vrai (il vaut faux sur le `resolved` d'avant l'écriture, le non résolu et tous les autres états), `progress` en `write` à `1/1`, `run_finished` en `write` à `written` 1, `write_error` 0, `awaiting_arbitration` 1. Sur le disque, `Lior Vance - Dim Orbit (Extended Mix).mp3` ; le morceau en attente et le non résolu identiques à l'octet près (`md5sum` avant et après) ; dump `<horodatage>-<run_id>.json` en `schema_version` 1 avec le `folder` du run, la seule entrée écrite et son `renamed_path`, aucun `.renames.ndjson` à côté (supprimé en fin de phase). Les `track_id` de la fixture sont `01 lior vance - dim orbit.mp3`, `02 orla quenby - kelvor.mp3` et `03 nobody - nothing here at all.mp3` ; deux morceaux tranchés sortent en `Lior Vance - Dim Orbit (Extended Mix).mp3` et `Orla Quenby - Kelvor (Extended Mix).mp3`
- `commit_run` puis, dans le même bloc, un second `commit_run` et un `start_tagging` : tous deux en `phase_busy` avec `params.phase` à `write` (les anciens `write_in_progress`, `rollback_in_progress`, `tagging_in_progress` et `extraction_in_progress` n'existent plus : `phase` nomme la phase qui tourne, la commande refusée reste dans `command`), l'écriture va à son terme. Course gagnée à chaque passe sur trois morceaux, le second arrivant pendant la lecture du dump ; un écart rendrait `write_not_open`, à relancer avant de conclure
- Run figé : `resolve_arbitration` et `switch_arbitration_source` sur le morceau en attente, `resolve_by_url` sur le non résolu, tous en `run_committed` avec `params.track_id`
- `retry_write` sans échec : accepté, `run_finished` en `write` aux mêmes compteurs
- Relance : deux morceaux tranchés, `{"lock": ...}` sur le premier 0,5 s avant `commit_run`, `write_error` / `file_locked` pour lui et `written` pour l'autre (`written` 1, `write_error` 1) ; verrou levé, `retry_write` le passe en `written` (`progress` à `1/1`, `written` 2, `write_error` 0)
- `stderr` : chaque refus laisse un `command failed reason=<code>` avec sa trace, `write failed run=<id> track=1 reason=file_locked` en ERROR, ni chemin ni titre dans les lignes `tagger.writing`

`shutdown` et l'EOF pendant l'écriture ne se provoquent pas par la vraie boucle : trois morceaux s'écrivent avant que la commande suivante soit lue. La preuve vit dans `test_neither_cancel_nor_the_end_of_the_session_cuts_a_write`, qui retient `write_tags` dans son thread.

Parcours relevé le 2026-10-09, tous verts. Le parcours change au 2026-10-11 : plus de `TORY` (ADR-011), l'ID3 relu ne porte que `TYER`. Rejoué le 2026-10-11 à la clôture de l'epic : tous verts, les deux courses gagnées du premier coup. Rejoué le 2026-10-11 sur la branche des finitions : tous verts, la course gagnée du premier coup (`phase_busy` / `write` pour les deux refus).

### Par le binaire figé, contre la vraie API

`just build-sidecar`, `build_fixture.py --formats`, puis `drive.py` sous `BINARY=src-tauri/binaries/tagger-x86_64-pc-windows-msvc.exe` et `LOCALAPPDATA` vers le scratchpad : `start_tagging`, `{"wait": 45}` (cache froid), un `resolve_arbitration` à l'index 0 sur chaque `track_id` (les morceaux déjà tranchés répondent `arbitration_not_pending`), puis `commit_run`. Les fichiers sont synthétiques : seules les bizarreries d'une vraie bibliothèque restent hors de portée.

- Quatre `written`, `run_finished` en `write` à `written` 4, quatre noms `Artiste - Titre (Mix).ext` venus de la vraie API, dump à quatre entrées toutes `renamed_path`
- Disque relu par `_probe.read_disk` (l'ancien `write_tags_probe.read_disk`) : ID3 en `2.3.0` sur MP3, WAV et AIFF avec `TYER` seul (plus de `TORY`, ADR-011), sans `TDRC` ni `COMM` ; FLAC sans `COMMENT` ni `DESCRIPTION` ; une seule image, recto `image/jpeg` téléchargée ; `PRIV:Serato` et `SERATO_PLAYCOUNT` intacts
- Choix aveugle à l'index 0 : « Silas Orman - Quiet Meridian » est tombé le 2026-10-09 sur le DJ mix « Quiet Meridian DJ Mix ». C'est une preuve d'écriture et non de matching, à ne pas lire comme une régression

Parcours relevé le 2026-10-09 sur le binaire 0.5.0, tous verts. Le parcours change au 2026-10-11 : plus de `TORY` (ADR-011), l'ID3 attendu ne porte que `TYER`. Il n'a pas été rejoué sur le binaire figé depuis : l'attente ci-dessus est celle du code, pas un relevé.

## Pilotage du rollback

`get_rollback_target` et `rollback` se pilotent par `drive.py` sur la fixture par défaut, après une écriture faite comme au § Par le protocole (deux morceaux tranchés puis `commit_run`). Une **seconde** invocation de `drive.py`, sous le même `LOCALAPPDATA`, est une session neuve : c'est elle qui prouve le rollback d'un run écrit dans une session précédente. Le `run_id` de la première se lit dans sa sortie (`run_finished` en `write`) ou dans le nom du dump. Relire les tags avant et après par `read_original_tags` dans un `uv run --directory sidecar python`, et comparer.

### Flux qui valent le coup

- Session neuve : `rollback_target` nomme le run, 2 morceaux et le dossier **du dump** (`folder` de la commande `start_tagging`, normalisé en `\`) et non plus l'ancêtre commun des fichiers : avec des fichiers tous sous `sub/`, il reste le dossier lancé et non `…\sub` ; `rollback` rend `rollback_finished` avec les deux restaurés **dans l'ordre inverse de l'écriture** et aucun échec ; noms d'origine revenus, tags relus identiques à l'origine, dossier `dumps/` vide, `get_rollback_target` à `run: null` ; un second `rollback` du même run en `rollback_unavailable` avec `params.run_id` et `track_id` nul
- Run affiché, dans le même bloc que `commit_run` : un `rollback` arrivé pendant l'écriture rend `phase_busy` avec `params.phase` à `write`. Puis `rollback` d'un seul `track_id` suivi sans attente de `rollback`, `commit_run` et `start_tagging` : les trois en `phase_busy` avec `params.phase` à `rollback` (course gagnée sur deux morceaux), puis `track_resolved` en `rolled_back` sans source, `after`, scores ni pochette, `resolution` gardée, `restorable` faux, et `rollback_finished` qui ne nomme que lui
- Ensuite : `get_rollback_target` vise le même run à 1 morceau ; `retry_write` ne réécrit pas le morceau restauré (`run_finished` en `write` à `written` 1) ; `rollback` d'un `run_id` sans dump en `rollback_unavailable`
- `stderr` : `rollback started` et `finished` en INFO avec le seul `run`, refus en `command failed reason=phase_busy` ou `background phase failed reason=rollback_unavailable`, aucun nom de fichier ni titre dans les lignes `tagger.rollback`

Un rollback pendant une extraction et `shutdown` pendant un rollback ne se provoquent pas par la vraie boucle sur la fixture : leur preuve vit dans `test_ndjson_phases.py`, qui retient l'appel dans son thread. Un nom d'origine pris se provoque en posant un fichier au nom d'origine avant `rollback` : `rollback_finished.failed` porte `name_taken` avec le nom écrit en `file_name`, aucun `track_resolved`, le dump garde l'entrée et `get_rollback_target` vise encore le run ; l'intrus retiré, un second `rollback` restaure. `stderr` : `rollback failed run=<id> reason=name_taken` en ERROR, sans nom de fichier (gardé aussi par `test_ndjson_rollback.py`).

Parcours relevé le 2026-10-09, tous verts. Rejoué le 2026-10-11 à la clôture de l'epic : tous verts, nom d'origine pris compris. Rejoué le 2026-10-11 sur la branche des finitions : tous verts en deux sessions, nom d'origine pris compris (`name_taken` avec le nom écrit en `file_name`, `restored` du seul autre morceau, dump et cible gardés, puis restauration une fois l'intrus retiré), tags relus identiques à l'origine, courses gagnées du premier coup. Deux pièges de pilotage : un `rollback` envoyé dans le même bloc qu'un `retry_write` rend `phase_busy` / `write` (glisser un `{"wait": 1.5}` entre les deux), et `"$run_id"` ne vaut que dans la session qui a lancé le run : la session neuve reçoit le `run_id` en clair, lu dans la sortie de la première.

### Côté webview

La couche se prouve sous `ng serve` sur l'instance de `SidecarService` et celle de `CloseGuard` (§ Gotchas : `svc._available.set(true)`, `svc.send` relevé, événements par `svc.handleLine`). Les boutons de confirmation et de rollback des écrans se pilotent aux § Pilotage de la confirmation d'écriture et § Pilotage du rollback depuis l'interface. Un `MutationObserver` posé avant le premier geste compte les `.p-toast-message`, leur vie n'étant que de 4s.

- Parcours relevé le 2026-10-09 : run résolu, `commitRun()` envoyé deux fois ne part qu'une fois, `committed` et `writing` vrais, `blocked` vrai avec `[{kind: "write"}]` ; `progress` en `write`, ligne `written`, `run_finished` en `write` : `writing` retombe, `blocked` faux, `get_rollback_target` repart, un `commitRun()` de plus ne part pas ; `rollback(runId, trackId)` : `rollingBack` posé, `blocked` vrai, `startTagging` ignoré ; `track_resolved` en `rolled_back` puis `rollback_finished` avec un échec : ligne `rolled_back`, `blocked` faux, `get_rollback_target` repart
- Toasts, un par fin : « Écriture terminée » en `success`, « Restauration terminée » puis « Fichiers non restaurés : 1 » à la ligne en `warn` (les textes composés portent des `\n`)
- Clés `app.close.write`, `app.close.rollback`, `tagging.writeFinished*` et `tagging.rollbackFinished*` présentes en FR et en EN, espace insécable avant chaque `:` français
- Console : l'unique erreur `[sidecar] lancement impossible` est celle attendue sous `ng serve` (§ Flux interface)
- Côté protocole, `get_rollback_target` sans dump rend `rollback_target` à `run: null` (`drive.py` sur `get_version` puis `get_rollback_target`, `LOCALAPPDATA` vers le scratchpad)

## Pilotage du run de re-tagging

`start_tagging` part vers techno-scraper, dont l'URL est une constante du module
(`scraper_client.API_BASE_URL`) : aucune variable d'environnement ne la détourne. Le run
se pilote donc par `scripts/drive.py`, qui réaffecte cette constante vers `fake_api.py`
avant d'importer `run_loop` et arme `setup_logging(log_dir())` comme `main()`. Tout le
reste est celui de production : boucle, client httpx2 sur une vraie socket, caches
disque, trousseau, lecture des tags, sortie NDJSON.

Le faux serveur ne lit jamais l'en-tête `X-API-Key` : une vraie clé est enregistrée sur
la machine de développement, le sidecar l'envoie telle quelle et la journaliser la
ferait fuir. Un `REJECT_ALL` dans l'environnement lui fait rendre 403 à tout, ce qui
rejoue la garde des trois refus.

Placer un candidat en zone grise demande de viser l'intervalle des seuils, pas de
l'approcher au jugé : artiste exact donne 100, donc le titre doit scorer entre 70 et 80
pour que la moyenne reste sous 90. `fuzz.ratio("Kelvor", "Kelvorians",
processor=utils.default_process)` rend 75, d'où un arbitrage ; « Kelvor Reprise » rend
60 et tombe sous le plancher.

**Purger `appdata` entre deux runs** : le cache de réponses est réel et une réponse
changée côté faux serveur reste invisible tant que l'entrée précédente est valide. Un
run qui ne bouge pas après modification du serveur est presque toujours ça.

**Contre une vraie gateway locale** : lancer techno-scraper depuis son dépôt
(`API_KEYS__VERIFY=verify-local-key just dev` dans `../techno-scraper`, prêt quand
`/health` rend 200), puis `GATEWAY_URL=http://localhost:8000 GATEWAY_KEY=verify-local-key` devant
`drive.py`. La clé de test remplace celle du trousseau, qui ne part jamais vers un serveur
de dev. C'est le seul moyen d'exercer le matching sur les réponses réelles d'une version
de la gateway pas encore déployée ; `just stop` dans `../techno-scraper` ensuite.

**Non-régression du matching** : premier run du code courant sur
`demo-data/Bibliotheque` (fraîchement bâtie par `just demo`) contre la gateway locale, puis
copie de son `appdata` et second run du code de référence
(`git archive HEAD sidecar/src | tar -x -C <scratch>/base`, puis
`PYTHONPATH=<scratch>/base/sidecar/src` devant `drive.py`) sur cette copie. Le second run
lit tout dans le cache (zéro requête dans son log) : mêmes réponses, seul le code diffère.
Comparer par `track_id` les `track_resolved` et `arbitration_required`, scores compris,
`artwork_path` ramené à son nom de fichier : le dossier du cache diffère d'un run à l'autre.

### Flux qui valent le coup

- Séquence complète : `run_started` listant tous les morceaux, puis par morceau son
  `track_resolved` ou son `arbitration_required` suivi d'un `progress` en phase
  `tagging`, enfin `run_finished` en phase `network` avec les trois compteurs
- Contenu d'un résolu : `state`/`resolution`/`failure_reason` en trois champs, `after`
  portant le titre suivi du nom de mix, scores entiers, chemin de pochette, `restorable`
  toujours présent et faux avant l'écriture (l'interface le lit au lieu de le déduire de `state`)
- Titre composé depuis les champs séparés : le faux serveur rend `title` sans sa version et
  `mix_name` à part, comme la gateway (ADR-012 de techno-scraper). Les deux morceaux connus de
  la fixture partent en arbitrage à 100/100 par la garde de version (le fichier ne nomme pas la
  version, le candidat dit « Extended Mix ») ; `resolve_arbitration` à l'index 0 rend leur
  `track_resolved` avec `after.title` à « Dim Orbit (Extended Mix) » et « Kelvor (Extended
  Mix) ». Relevé le 2026-10-02, identique sur le code d'avant la simplification de `full_title`
  (rejeu par `PYTHONPATH=<scratch>/base/sidecar/src` sur un `git archive HEAD sidecar/src`)
- Candidat comparé tel que la gateway le rend (titre, `mix_name` et crédits non
  redécoupés) : non-régression du matching sur la démo, relevée le 2026-10-02 contre la
  gateway locale 4.0.0, 30 morceaux, zéro écart avec le code d'avant (8 auto, 19 non
  résolus, 3 arbitrages, scores identiques) ; mêmes chiffres en production 4.0.0 par le
  binaire figé
- Invité au nom de version écrit dans le tag : « Teodor Hale » / « Cairn feat. Dubmoor »
  (copie d'un `.mp3` de la démo retaguée par mutagen) contre la gateway 4.0.0, auto à 100 ;
  le code d'avant le laissait en `below_threshold` (relevé le 2026-10-02)
- Commande servie pendant un run : `get_version` envoyé après `start_tagging` répond
  avant `run_finished`, ce qui prouve que la boucle n'est pas bloquée
- Second `start_tagging` pendant un run : `error` de code `phase_busy`, `params.phase` à
  `tagging`, et le premier run poursuit jusqu'à son `run_finished`. Pendant la même phase,
  `rollback` et `extract_playlist` rendent aussi `phase_busy` / `tagging`, alors que
  `commit_run` et `retry_write` rendent `write_not_open` (relevé le 2026-10-11 sur un
  `--unique 3` sous `FAKE_DELAY=1`)
- Seuils hors bornes : `malformed_command` dont les `params` ne portent que `loc` et
  `type`, jamais les valeurs envoyées et la boucle continue
- Clé refusée (`REJECT_ALL`) : `error` de code `api_key_rejected` en dernier événement,
  aucun `run_finished`
- `shutdown` pendant un run : tâche annulée, aucun `run_finished`, sortie 0 et la
  commande suivante ignorée
- `cancel_run` pendant un run : tâche annulée, aucun `run_finished` et la boucle
  répond à la commande suivante, contrairement à `shutdown` qui en sort. Sans run en
  cours, la commande ne rend rien et ne lève rien
- Dossier vide : `run_started` à liste vide, aucun `progress`, `run_finished` à zéro
- Racine des données : `cache/responses/` et `logs/tagger.log` sous
  `<LOCALAPPDATA>/fr.empiricmind.techno-tagger/`, jamais dans le profil réel
- Erreur d'une **autre** commande pendant un run : son `command` la désigne, le run
  poursuit jusqu'à son `run_finished` et l'interface garde ses lignes. Deux régressions
  relevées ici le 2026-09-24, à ne jamais laisser revenir : un refus de phase occupée
  (`phase_busy`) arrêtait le run affiché alors que
  ce code dit justement que le premier continue, et
  `SidecarService.startTagging()` vidait la liste d'un run en cours avant que le sidecar
  ne refuse la seconde commande

### Gotchas du run

- **httpx2 journalise l'URL complète en INFO**, donc `q=Lior+Vance+Dim+Orbit` : le log
  local porte les artistes et les titres du run. C'est admis (les logs restent locaux),
  et rien ne part vers Sentry tant qu'`observability.init_sentry` garde son
  `LoggingIntegration(level=None, event_level=None, sentry_logs_level=None)`. Contrôler
  ce réglage avant de conclure sur une fuite, plutôt que la présence des titres
- Un `artwork_url` nul dans les réponses du faux serveur rend `artwork_path` nul sans
  rien casser : c'est le cas de bord « Pochette absente ». Pour exercer le chemin
  complet, il faut un `MockTransport` et un `resolve=` injectés par `tagging_transports`,
  `ArtworkFetcher` refusant toute URL qui n'est pas en `https` vers une adresse publique
- L'ordre des `track_resolved` ne suit pas celui des morceaux : les tâches du run sont
  concurrentes, seul l'ordre « événement du morceau puis son `progress` » est garanti
- **Une course ne se pilote pas sur un cache chaud** : un run de trois morceaux déjà en
  cache se termine avant que la commande concurrente ne parte et le scénario passe en
  rendant un faux vert. Bâtir un dossier de titres inédits (« Verify Probe N ») pour que
  chaque morceau paie son aller-retour et que le run dure assez
- **Une annulation envoyée dans le même bloc que `start_tagging` tombe pendant le parcours
  du dossier**, avant `run_started` et n'exerce rien : un fichier de commandes arrive d'un
  coup. Glisser un `{"wait": 1.5}` avant `cancel_run` dans le fichier de `drive.py`, qui
  alimente `stdin` par un vrai pipe, avec `FAKE_DELAY` sur le faux serveur pour tenir les
  requêtes en vol
- **Un `{"wait": N}` en dernière ligne ne retient rien** : le fichier finit, l'EOF tombe et
  annule un geste encore en vol, `resolve_arbitration` compris. Le faire suivre d'une
  commande, `get_version` par exemple
- **La course d'une relance juste après `cancel_run` ne se reproduit pas contre le faux
  serveur** : il rend `artwork_url` nul, aucune pochette n'est donc en téléchargement, et
  c'est leur attente sous `shield` dans `__aexit__` du cache qui fait mourir le run
  lentement. Relevé le 2026-09-25 : contre-épreuve sans l'attente de `cancel_run`, zéro
  erreur aussi. La preuve vit dans `test_a_run_started_right_after_a_cancellation_is_not_refused`,
  dont la fixture meurt lentement ; ici, vérifier seulement l'absence de régression
- **Un run annulé avant son premier pas ne se provoque pas par la vraie boucle** : la
  lecture de `stdin` par `to_thread` rend la main et la tâche démarre avant que la
  commande suivante soit lue. `_Session._phase` reçoit une factory pour que ce cas ne
  laisse aucune coroutine jamais attendue ; relevé le 2026-09-25, la contre-épreuve
  sur le code d'avant ne l'a montré ni par `drive.py` ni en quatre passes de pytest

## Pilotage du plan de run, de la reprise et du rapport

Trois sessions de `drive.py` sous le même `LOCALAPPDATA`, sur la fixture par défaut (deux arbitrages, un non résolu). Le plan vit sous `<LOCALAPPDATA>/fr.empiricmind.techno-tagger/plans/<horodatage>-<run_id>.json`, le registre à côté (`reports.json`), le rapport dans le dossier du run (`tagging-report-<horodatage>.json` et `.md`). **`drive.py` appelle `run_loop` sans passer par `main()` : la purge des plans au démarrage ne s'y voit pas**, elle se prouve par le vrai sidecar (`just dev-sidecar` alimenté par un pipe), comme la purge des dumps.

### Flux qui valent le coup

- Session 1, `start_tagging` puis EOF avec deux arbitrages en attente : un plan unique, `committed` faux, chaque morceau avec son état ou son arbitrage, aucun chemin de pochette (seul `artwork_url` du candidat) ; `get_interrupted_run` pendant le run répond `run: null` (le run ouvert n'est pas interrompu)
- Session 2, nouveau process : `interrupted_run` en `interrupted` avec `processed` / `total` (un arbitrage en attente compte comme traité) ; `resume_run` rejoue `run_started`, les `arbitration_required` et le non résolu sans aucune recherche, puis `run_finished` en `network` ; les arbitrages se tranchent (`track_resolved` avec `source_url`) ; `commit_run` rend `run_finished` en `write` avec `report_path` ; `list_runs` liste le run ; `load_run` rend `run_loaded` avec `file_after` et `tags_before.system`, sans `restorable` ; `load_run` et `discard_run` d'un `run_id` inconnu en `run_not_found`. Le plan est alors `committed`
- Rapport Markdown : en anglais, compteurs en tête, sections Written (colonnes Route, Cover, Truncated, Page) et Unresolved (Query, Reason), sections vides omises
- Purge par le vrai sidecar, fichiers posés dans `plans/` : plan confirmé, plan de plus de 30 jours et `.tmp` supprimés, `notes.json` et plan illisible récent gardés ; ce dernier annoncé en `unreadable` avec `found` à la version lue s'il s'agit d'une autre version, nul s'il est corrompu (JSON invalide, ou bonne version et contenu invalide) ; `discard_run` sur lui le supprime et la réponse annonce `run: null`
- Binaire figé (`just build-sidecar`) : `get_version`, `get_interrupted_run` et `list_runs` répondent avec les mêmes formes

Parcours relevé le 2026-10-12 sur la branche du plan de run, tous verts. Il a révélé qu'un plan à la bonne version mais au contenu invalide était annoncé avec `found` égal à `expected`, ce que l'invite de reprise aurait lu comme une autre version : corrigé dans `run_files.read_versioned` le même jour.

### Invite de reprise dans la fenêtre

La fenêtre Tauri, lancée sous le `LOCALAPPDATA` de la recette (`LOCALAPPDATA=<scratch>/appdata WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" just dev`), lit les plans que `drive.py` a laissés sous le même dossier : la session de `drive.py` qui crée le plan tourne contre le faux serveur, et la fenêtre ne repart pas sur le réseau tant que tous les morceaux du plan sont traités. Un plan posé pendant que la fenêtre est ouverte se repropose par `page/resume-prompt.js restart`, sans rouvrir l'application. `src-tauri/binaries/` doit porter le sidecar du dernier commit de `sidecar/src` (§ Gotchas).

- Plan : `start_tagging` sur la fixture par défaut, `resolve_arbitration` à l'index 0 sur `01 lior vance - dim orbit.mp3`, puis `get_version` et fin de `stdin` : un résolu, un arbitrage en attente, un non résolu. Un dossier au chemin long montre la troncature
- Au lancement : invite « Reprendre le run interrompu ? » en `text-lg` 600, sans croix, 480px, rayon 12px, masque `rgba(0, 0, 0, 0.6)` ; « Run du <date localisée>, N / M traités, sur : » puis le dossier seul sur sa ligne, `rtl`, coupé par la gauche en `text-color`, puis la garantie ; `text-sm` `text-muted-color` en `pre-line` ; aucun bouton focalisé, Entrée au vrai clavier (`cdp.mjs --key Enter`) ne ferme rien et le plan reste ; « Repartir de zéro » `text` `secondary` puis « Reprendre » `primary`, `small`, aucun `danger`
- « Reprendre » : invite fermée, onglet Tagging, champ dossier sur celui du run, bouton d'action en `commit` (« Confirmer l'écriture »), lignes rejouées (`resolved`, attente, `unresolved`), modale d'arbitrage rouverte, badges « 1 à arbitrer » et « 1 à rattraper »
- « Repartir de zéro » après `restart` : invite fermée, plan supprimé du disque, `lastError` nul
- Dossier introuvable (le dossier du plan renommé) : « Plus tard » et « Repartir de zéro », tous deux `text` `secondary`, sans « Reprendre », texte du disque à rebrancher ; « Plus tard » ferme sans rien supprimer et `restart` repropose le même plan
- Plan d'une autre version (`{"schema_version": 2, ...}` posé à la main) : « … (version 2, attendue 1). » puis « repartez de zéro », « Repartir de zéro » seul. Plan corrompu (JSON coupé) : « Le fichier de ce run est endommagé. », aucune version citée, « Repartir de zéro » seul. Chacun supprimé par son geste

La recherche des morceaux jamais atteints après une reprise part sur la vraie API sous Tauri : elle se prouve par `drive.py` (§ Flux qui valent le coup ci-dessus), pas dans la fenêtre.

Parcours relevé le 2026-10-12 sur le sub-project reprise-ui, sidecar reconstruit, tous verts. Un seul `tagger.exe` après chaque `restart`.

## Pilotage de l'arbitrage

`build_fixture.py --arbitration` pose « Orla Quenby - Kelvorians », en zone grise sur les deux sources du faux serveur (titre à 75, moyenne 88). Son `track_id` est le nom du fichier, `01 orla quenby - kelvorians.mp3`, connu d'avance : les gestes s'écrivent dans le fichier de commandes de `drive.py` sans relire `run_started`. `FAKE_DELAY` tient aussi l'appel Bandcamp d'un refus, ce qui met un geste en vol.

Le faux serveur rend le même objet complet sur `/beatport/search` et `/bandcamp/search` : `label` et `year` sortent donc renseignés sur la liste Bandcamp, alors que la vraie recherche Bandcamp ne les rend jamais. Un `null` attendu côté Bandcamp se vérifie par les tests, pas ici. Il ne rend jamais non plus de liste Bandcamp vide après un refus : « passer » sur une liste vide et son motif se vérifient par les tests.

Les options de `build_fixture.py` s'excluent et chacune vide son dossier : un run qui mêle arbitrage et phase réseau longue se compose en copiant les `.mp3` d'un `--unique 2` dans le dossier d'un `--arbitration` (noms distincts). Sous `FAKE_DELAY=d`, le morceau en zone grise attend dès `d` et les titres inédits finissent à `2d` (Beatport puis Bandcamp) : entre les deux, le run est en phase réseau avec un arbitrage en attente. Deux arbitrages s'obtiennent en copiant le `.mp3` d'`--arbitration` sous `02 orla quenby - kelvorians.mp3`.

### Flux qui valent le coup

- `arbitration_required` : candidats avec `label` et `year`, `empty_reason` et `other_source` à `null`, puis `run_finished` à `awaiting_arbitration: 1`
- Après `run_finished` : refus de Beatport (`candidate: null`) puis `arbitration_updated` en `bandcamp` avec `other_source` à `beatport` ; `switch_arbitration_source` vers Beatport, `arbitration_updated` inverse ; un second `switch` vers la liste déjà affichée rend `arbitration_candidate_unknown` qui nomme `switch_arbitration_source` ; choix de l'index 0, `track_resolved` en `resolved` / `arbitration` ; un geste répété ensuite rend `arbitration_not_pending`
- Gestes malformés (`candidate` à -1, à `true` ou absent, source `soundcloud`) : `malformed_command` dont les `params` ne portent que `loc` et `type`
- Boucle réactive : sous `FAKE_DELAY=1`, un `get_version` envoyé 0,2s après le refus répond avant l'`arbitration_updated`
- `shutdown` pendant un refus en vol, sous `FAKE_DELAY=3` : sortie immédiate (relevé le 2026-09-27, `elapsed` 5,01s pour un refus parti à 4,5s), aucun `arbitration_updated`, la commande suivante ignorée
- Nouveau `start_tagging` (dossier vide) pendant un refus en vol : aucun `arbitration_updated` de l'ancien run, puis un geste sur l'ancien morceau rend `arbitration_not_pending`
- Sur `stderr`, chaque geste refusé laisse un `logger.exception` avec son seul `reason` : ni titre ni chemin, et ni `never awaited` ni client non fermé
- Dossier mixte sous `FAKE_DELAY=1.5` : un second `start_tagging` à 2,3s rend `phase_busy` (`params.phase` à `tagging`), puis un choix sur le morceau en attente rend `track_resolved` en `arbitration` et le run finit seul ; `cancel_run` à 2,3s puis un choix, `track_resolved` sans `run_finished`
- Refus, retour à Beatport, second refus : un seul `bandcamp/search` dans `tagger.log`
- EOF pendant un refus en vol, sous `FAKE_DELAY=3` : sortie immédiate comme `shutdown`, aucun `arbitration_updated`
- Un `cancel_run` qui coupe des requêtes en vol laisse des `ConnectionAbortedError` dans `stderr` : c'est `http.server` du faux serveur qui écrit dans une socket fermée, pas le sidecar

### Côté webview

La fenêtre Tauri parle à la vraie API, où aucun morceau n'est en zone grise à coup sûr : la file de `SidecarService` se prouve en rejouant dans la fenêtre le flux que `drive.py` a obtenu du faux serveur, par `page/arbitration-replay.js`. Les gestes y sont intercalés avant chacune de leurs réponses et `send` est relevé : les commandes relevées doivent être **identiques** à celles du fichier de `drive.py`, ce qui ferme la boucle entre les deux côtés.

- Parcours relevé le 2026-09-27 (fichier de `drive.py` : refus Beatport, `switch` vers Beatport, choix 0, choix 0 répété ; gestes `[[refuse, refuse], [showArbitrationSource], [chooseCandidate], [chooseCandidate]]`) : file à `1/1` dès `arbitration_required`, `busy` vrai du geste à sa réponse, le refus doublé part zéro fois, `arbitration_updated` remplace en place (`bandcamp` puis `beatport`, `other_source` croisé), `track_resolved` vide la file (`0/0`, ligne du run en `resolved` / `arbitration`), le geste répété rend `arbitration_not_pending` lisible par `errorFor("resolve_arbitration")`
- Navigation pendant l'attente, sur deux arbitrages (flux de `drive.py` sans geste, un groupe en surplus : refus sur le premier puis clics) : « précédent » `disabled` à `1/2`, « suivant » actif mène à `2/2`. Sélecteurs indépendants de la langue : `app-arbitration-dialog .p-dialog-footer button:has(+ p-badge)` et `p-badge + button`. Le premier clic d'un groupe peut tomber avant le rendu de la modale (`target` nul) : commencer le groupe par `["click", "body"]`
- Aucune ligne `[sidecar]` en console pendant le rejeu : ni « evenement non traite » ni « ligne illisible »
- Le rejeu laisse un faux run dans la liste de l'onglet Tagging : fermer la fenêtre ensuite plutôt que d'y enchaîner un autre parcours
- Sur un vrai run de la démo (`page/demo-run.js run <demo-data>\Extraction`, deux arbitrages, relevé le 2026-09-29), souris réelle par `cdp.mjs --click` / `--move` : un clic sélectionne le candidat et le survol des autres ne change pas la sélection ; après la croix, un clic sur une ligne « À arbitrer » rouvre la modale sur ce morceau ; flèches, compteur et boutons du pied à 27px ; message de liste vide centré dans les 268px de la liste ; vignettes à 32px dans des cellules de 60px
- **Ne jamais mesurer pendant que l'utilisateur se sert de la fenêtre** : ses clics s'intercalent entre ceux du pilote et rendent un relevé incohérent (le 2026-09-29, trois clics au même endroit ont rendu une sélection nulle, nulle, puis 0)

### Modale d'arbitrage sous `ng serve`

La modale se pilote sur l'instance du service (§ Gotchas : `svc._available.set(true)`, `svc.send` relevé, `svc.startTagging` puis `run_started`, `arbitration_required` et `arbitration_updated` par `svc.handleLine`), au plancher 1024 × 700. Chaque état se contrôle par des mesures (`getBoundingClientRect`, `getComputedStyle`) et une capture comparée à la maquette `ArbitrationDialog`.

- Ouverture seule au premier `arbitration_required`, quel que soit l'onglet, « 1/1 » au pied et « 1 à arbitrer » dans la barre d'onglets ; croix sans aucun `send`, fermée à l'arrivée d'un autre arbitrage, rouverte par le badge sur l'arbitrage affiché
- Clavier au **vrai clavier** (`browser_press_key`), jamais par `dispatchEvent` : ← et → changent d'arbitrage, ↓ sélectionne, Entrée envoie `resolve_arbitration` avec l'index. Relevé le 2026-09-27 : Entrée désélectionnait le candidat (bascule de sélection de `p-listbox` hors `metaKeySelection`) alors que le test unitaire, qui posait la sélection à la main, passait
- Attente : `refuse` et `validate` `disabled`, `validate` en `p-button-loading`, le focus revient à la liste après la réponse comme après une `error` `arbitration_*` du morceau affiché ; sur une liste vide, le focus va à « Passer »
- Rien ne bouge : conteneur de liste à 268px quel que soit le nombre de candidats, ligne d'aide et boutons du pied à la même ordonnée sur Beatport, Bandcamp, liste vide, Beatport injoignable, avec ou sans tags. Relevé à 191px pour la liste, 472px pour l'aide
- Bandeau de bascule : lien « Revenir à Beatport » à la taille du texte du bandeau (12px), aucune animation d'entrée (`animationName` à `none`)
- Une panne réseau pendant un refus ne sort jamais en `error` : c'est une liste Bandcamp vide au motif `source_unavailable`. Simuler une `error` `source_unavailable` sur un geste affiche un `{{source}}` brut qui ne vient pas de l'interface

## Pilotage du rattrapage par URL

`resolve_by_url` se pilote par `drive.py` sur un `--unique 1` : son morceau finit `unresolved` et son `track_id` se lit sur le nom de fichier rendu par `build_fixture.py`. URL servies par le faux serveur :

| URL collée | Réponse |
|---|---|
| `https://www.beatport.com/track/dim-orbit/99000101` | morceau Beatport |
| `https://orlaquenby.bandcamp.com/track/kelvor` (et ses variantes `http://`, majuscules, query, fragment, `/` final) | morceau Bandcamp |
| `https://soundcloud.com/kestrel/zelka-larkspur-mothlight-2` (et `m.`, `www.`, query) | morceau SoundCloud |
| `https://on.soundcloud.com/verifyprofile` | profil, que le sidecar refuse en `unsupported_url` |
| `https://www.beatport.com/track/x/403403` / `.../503503` | 403 / 503 de la gateway |
| toute autre URL Bandcamp ou SoundCloud de forme valide, tout autre id Beatport | 404, `track_not_found` |

Chaque requête partie se relit dans `logs/tagger.log` (httpx2 journalise l'URL complète) : c'est là que se vérifie la normalisation.

### Flux qui valent le coup

- Avant tout run : `url_recovery_not_open`, `command` à `resolve_by_url`, `params.track_id` au morceau
- Commande malformée (`url` vide, champ en trop) : `malformed_command`, la boucle continue
- Fin de run : `run_finished` en `network` suivi d'un seul `progress` en `url_recovery` à `0/1`
- URL YouTube : `unsupported_url` portant `params.track_id`, puis URL Beatport : `track_resolved` en `resolved` / `url`, `scores` nul, suivi de `progress` à `1/1`. Un second collage sur le même morceau le rattrape de nouveau (un morceau rattrapé reste éligible)
- `cancel_run` après la fin du run : aucun événement
- `cancel_run` sous `FAKE_DELAY=1` à 1,5s sur un `--unique 3` : `progress` en `url_recovery` sans `run_finished`, à `0/0` (les morceaux jamais cherchés ne sont pas à rattraper), puis la boucle répond
- Sur `stderr`, chaque geste refusé laisse un `logger.exception` avec son seul `reason`
- Formes d'URL : la variante Bandcamp `http://Orlaquenby.bandcamp.com/track/kelvor/?from=search#lyrics` part en `url=https://orlaquenby.bandcamp.com/track/kelvor`, la SoundCloud `m.` sans query ni `tracks_cursor` ; lien court résolu en profil → `unsupported_url` ; 404 → `track_not_found` avec `params.source` ; 503 → `source_unavailable` avec `status` et `reason` ; `soundcloud.com/<user>/sets` passe le contrôle local et revient en 404 du faux serveur
- Non éligible, sans aucune requête émise par le geste : morceau en attente d'arbitrage, morceau arbitré (fixture par défaut, choix de l'index 0), `track_id` inconnu, morceau jamais atteint d'un run interrompu
- Second geste sous `FAKE_DELAY=1`, 0,2s après le premier sur le même morceau : `url_recovery_busy`, puis le premier aboutit
- Garde des 403 : trois gestes sur `403403` et trois morceaux d'un `--unique 3`, trois `api_key_rejected` dont le dernier au message `run stopped after repeated api key rejections`, la boucle répond ensuite
- Interruption avec des non résolus : `--unique 5` sous `FAKE_DELAY=1`, `cancel_run` à 2,4s, `progress` à `0/2` sans `run_finished`, puis un rattrapage aboutit à `1/2`
- Refus d'arbitrage tardif : `.mp3` d'un `--unique 1` copié dans le dossier d'un `--arbitration`, refus Beatport puis refus Bandcamp (`candidate: null`, source `bandcamp`) après la fin du run, le total passe de 1 à 2
- Geste en vol sous `FAKE_DELAY=1` : un nouveau `start_tagging` l'abandonne sans `track_resolved` et l'ancien morceau devient non éligible ; `shutdown` ou EOF sortent aussitôt, sans `track_resolved` ni coroutine orpheline sur `stderr`. Un `ConnectionAbortedError` sur `stderr` vient du faux serveur, pas du sidecar

**Contre la vraie gateway** (§ Pilotage du run de re-tagging) : URL réelles relevées dans les tests de techno-scraper, `https://www.beatport.com/track/tamarin/23382450`, `https://deestricted.bandcamp.com/track/good-question`, `https://soundcloud.com/kestrel/zelka-larkspur-mothlight-2`. Les trois aboutissent en `resolved` / `url`, pochette téléchargée dans `cache/artworks/` ; `soundcloud.com/kestrel/sets`, que la gateway résout en playlist ou profil, revient en `unsupported_url`. Relevé le 2026-10-05 contre la gateway locale 4.0.1. La gateway charge ses clés SoundCloud depuis son propre fichier d'environnement : sans elles, `/soundcloud/resolve` échoue.

Parcours relevé le 2026-10-05, tous verts.

### Côté webview

Le bloc sous la liste a cédé la place à la modale du lien (variations du 2026-10-06, DESIGN.md § Arbitrages). `page/url-recovery-modal.js` rejoue tout le parcours sous `ng serve` et rend un contrôle par règle :

- Badge « N à rattraper » à 8px de « N à arbitrer » (`gap-2`), masqué pendant la recherche et à 0 ; depuis Playlist, il bascule sur Tagging et ouvre la modale sur le premier non résolu, champ focalisé, 720px de large, « 1/N »
- Indice « Coller un lien → » à 14px et 600 dans la colonne Après ; un clic sur la ligne, ou Entrée sur la ligne focalisée (anneau visible), ouvre la modale sur ce morceau
- Entrée envoie `resolve_by_url` une fois, spinner et « Lancer le run » bloqué pendant le geste ; une `error` `unsupported_url` s'affiche sous le champ à 16px du champ et du pied, lien gardé, hauteur de la modale et ordonnée du pied inchangées
- Étape lien de l'arbitrage : refus Beatport puis Bandcamp et `track_resolved` en `unresolved` / `user_refused`, la modale garde son cadre, sans compteur, champ focalisé ; un lien accepté ou « Passer » mène à l'arbitrage suivant, puis ferme au dernier ; pendant la recherche, champ désactivé, aide « Disponible à la fin de la recherche », focus sur « Passer »
- Un lien collé n'est pas repris au run suivant, même `track_id` ; sur `progress` à `0/0`, la ligne « Aucun morceau non résolu » remplace la barre
- Aucun défilement de page à 1280 × 800 ni à 1024 × 700

Parcours relevé le 2026-10-06, 27 contrôles verts. Un vrai run sous Tauri le même jour a montré qu'un « Passer » sur une liste Bandcamp vide rend le motif de la liste (`below_threshold`) et non `user_refused` : l'étape lien ne filtre pas sur le motif. L'animation d'entrée de `p-message` est ralentie par Playwright hors focus (§ Gotchas) : mesurer l'erreur après 2s ou `page.bringToFront()`.

## Pilotage du détail déplié

`page/track-detail.js` rejoue un run simulé sous `ng serve` (événements par `svc.handleLine`, `tags_before` et `tags_after` aux 15 clés ID3 de `TAG_FIELDS`) et rend un contrôle par règle. `artwork_path` reste nul : `convertFileSrc` n'existe pas hors Tauri, l'image en 160px se prouve par le test du composant. Le détail d'un morceau se lit sur la ligne qui suit la sienne (`tr[data-detail-carrier]`), les lignes vides qu'il recouvre portent `aria-hidden="true"`.

- Bouton en tête de ligne : 34px dans la colonne de 48px (`w-12`), sa cellule sans marge droite (`pr-0`), ni FR ni EN ne le rognent, « Afficher le détail » / « Show details », `aria-expanded` et surlignage `bg-highlight` sur la ligne ouverte ; aucune commande envoyée. Les écarts bouton / pochette et pochette / texte sont relevés, pas imposés égaux
- Détail : juste sous la ligne, pleine largeur, pochette de 160px à gauche de la grille, 14 champs (sans l'identifiant à la source) plus Commentaire dans l'ordre du sidecar (artiste, titre, remixeur, genre, BPM, key, label, numéro de catalogue, ISRC, album, numéro de piste, année, source, URL), clé à côté du libellé sans le préfixe `TXXX:` (`CATALOGNUMBER`), aucun libellé coupé, au moins 160px par valeur, sans `z-index`
- Cadre : 7 lignes de 56px (392px), 4 pour des tags illisibles, 8 avec « Restaurer ce morceau » (§ Pilotage du rollback depuis l'interface) ; rien ne défile dedans, 17px sous la dernière ligne de champs (le padding), la ligne suivante collée au cadre
- Un second bouton déplie un second détail sans replier le premier, le même bouton replie le sien ; un morceau en attente résolu détail ouvert le met à jour ; un nouveau run sans lui le replie
- Arbitrage : le bouton déplie sans modale, un clic sur la ligne ouvre la modale au-dessus du détail ; Entrée et Espace au **vrai clavier** sur le bouton focalisé déplient ou replient sans modale, le focus reste sur le bouton
- En-tête collant : défilé de 120px, l'en-tête reste au-dessus du détail
- Run de 2 000 morceaux : 27 lignes montées, aucune ligne vide découverte en balayant par pas de 28px dans les deux sens, détail ouvert

Relevé le 2026-10-11 : 36 contrôles verts (colonne de 48px, ordre des champs, clés sans `TXXX:`). 2 000 morceaux sous `ng serve` (build de développement), rendu forcé : premier rendu en 53ms, 0,7ms médians et 1,6ms au 95e centile par événement, aucune tâche longue. La ligne dépliée de `p-table` sans scroll virtuel prenait 11,5s et 118ms (relevé le 2026-10-10 sur prototype). Rejoué le 2026-10-11 à la clôture de l'epic : 36 verts.

## Pilotage de la confirmation d'écriture

`page/write-confirmation.js` rejoue un run simulé sous `ng serve` jusqu'à l'écriture et rend un contrôle par règle. La fermeture s'y ouvre par `_request` de `CloseGuard` (pas de fenêtre Tauri sous `ng serve`) : le passage par `onCloseRequested` se prouve au § Pilotage de la garde de fermeture.

- Bouton d'action unique (`size="small"`, `data-action` valant `start`, `cancel`, `commit` ou `retry`), calé à droite de la ligne du dossier : « Lancer le run », « Interrompre » (`secondary` outlined, `stop`), « Confirmer l'écriture » (`primary`, `check`), le même en chargement (`spinner`, grisé) pendant l'écriture, puis « Relancer l'écriture » (`primary` plein, `refresh`, `data-action="retry"`) tant qu'il reste des lignes `write_error` sur le même dossier, en chargement pendant la relance (toujours `retry`, jamais `commit`), enfin « Lancer le run ». Le même dossier rechoisi le laisse confirmable, un autre l'abandonne ; un run interrompu avec un morceau résolu reste confirmable ; un run sans morceau résolu, ou perdu avec le moteur (`svc.endRun()` puis `_available` à vrai simule la mort et la relance), laisse « Lancer le run » sur son dossier, ses lignes figées, et la fermeture ne le compte plus
- Modale : 480px, message en `text-sm` `text-muted-color` et `whitespace-pre-line`, en trois blocs (« Dossier : … », puis les comptes un par ligne : fichiers à écrire et non nuls, non résolus et à arbitrer, enfin la garantie de sauvegarde `tagging.commit.backup`), « Annuler » `secondary` outlined avec le focus, « Écrire les tags » `primary` (aucun `danger`), les deux `small`, aucune icône ; « Annuler » n'envoie rien, accepter envoie un seul `commit_run`
- Run figé : lignes sans `tabindex`, clic sans modale ni commande, attente d'arbitrage en « Non traité » sans squelette, badges de file et de rattrapage masqués ; un `commit_run` refusé (`tag_dump_write_failed`) rend tout, erreur affichée
- Écriture : barre « Écriture des tags et des pochettes, puis renommage » au compteur, gardée à « 3 sur 3 » une fois finie ; ligne écrite au libellé de sa voie en vert, échec en `danger` `exclamation-triangle` « Échec d'écriture » avec le motif au survol, ouvert sous l'état, sans retour à la ligne en FR comme en EN
- Message d'échec au-dessus de la liste, `times-circle`, texte seul sur deux lignes (aucun bouton dedans : la relance est le bouton d'action du run, `retry`) ; sa confirmation (`small`, comptes sur une ligne) avant tout envoi, message masqué et bouton d'action en chargement pendant la relance ; une relance refusée ne laisse aucune barre indéterminée et remet « Relancer l'écriture » ; une relance réussie remet « Lancer le run »
- Fermeture : un run cherché non confirmé ne retient plus rien (`pendingWork()` vide, plan de run, 2026-10-12), écriture en cours « Impossible de quitter maintenant » et « Rester » seul ; aucun défilement à 1024 × 700

Le dossier comparé par le bouton est celui de `run_started`, que le sidecar normalise (`/` en `\`, séparateur final retiré, relevé par `drive.py` le 2026-10-10) : le dialogue natif et la dernière destination rendent déjà cette forme.

Parcours relevé le 2026-10-11 après la revue d'écran (bouton `retry`, message d'échec sans bouton, textes une phrase par ligne, boutons `small`) : 52 contrôles verts, run sans morceau résolu et moteur perdu compris. `page/url-recovery-modal.js` rejoué le même jour : 29 verts. Rejoués le 2026-10-11 à la clôture de l'epic (chevron relevé, `filesBusy` et `pendingArbitrationCount` partagés par le service, fixtures communes) : 52 et 29 verts ; `page/playlist-run-guard.js` : 6 verts.

## Pilotage du rollback depuis l'interface

`page/rollback-ui.js` rejoue sous `ng serve` un run simulé de cinq morceaux (deux écrits, deux en échec d'écriture, un non résolu) jusqu'au rollback, puis un second run et les Réglages, et rend un contrôle par règle. Le service est simulé comme au § Pilotage de la confirmation d'écriture ; `svc.writePhase.retrying()` et `retryFailed()` posent et lèvent `writing` depuis les Réglages, `svc.rollback(runId, null)` pose `rollingBack` sans passer par la modale. `tags_before` et `tags_after` portent les 16 clés ID3, sans quoi le détail d'une ligne écrite ou restaurée affiche « illisible » au lieu de ses champs.

- État « Restauré » : `p-tag-secondary`, icône `undo`, une ligne, plus étroit que « Échec d'écriture » en FR comme en EN et contenu dans la colonne État ; Après, Source et Score en cadratins, pochette en cadre neutre ; le détail montre l'Avant seul
- Bouton du détail déplié : absent sur un run non confirmé, un non résolu, un résolu pas encore écrit et un restauré ; présent sur un écrit et un échec d'écriture, `primary` outlined, `refresh` à 16px ; `spinner` grisé pour le morceau en vol, grisé sans spinner pour les autres, avec la raison au survol ; cadre de 8 lignes avec le bouton, rien n'y défile
- Bouton « Restaurer le run » : absent avant la confirmation, pendant l'écriture et quand tout est restauré ; présent après une restauration partielle ; `small`, au bout de la rangée de la barre, bas aligné sur la barre ; sans barre (aucun palier `write` reçu), toujours là, sous le bouton d'action et au-dessus de la liste, jamais à côté du bouton d'action ; aucun défilement à 1024 × 700
- Modale partagée : 480px, message `text-sm` `text-muted-color` en `pre-line` au nombre exact (« Fichiers à restaurer : N » seul sur sa ligne : 1 par morceau, les lignes écrites ou en échec par run, 87 pour la cible des Réglages) et à la phrase des pochettes et commentaires (« ne sont pas récupérés »), « Annuler » `secondary` outlined avec le focus (Entrée ne valide pas), « Restaurer » seul `danger`, les deux `small`, aucune icône ; « Annuler » n'envoie rien, accepter envoie une seule commande `rollback` avec `track_id` de la ligne, ou nul pour un run
- Liste des fichiers non restaurés : `app-message` d'erreur, `times-circle` à 20px, « Fichiers non restaurés » à l'espace insécable avant les deux-points, fichier et phrase du motif de restauration (cause `reason.*` puis geste `reason.fix.*` avec `reason.retry.rollback`, et `rollback.reason.name_taken` : `name_taken` et `file_locked` finissent par « puis relancez la restauration » / « then restore again », jamais par un renvoi à l'écriture), FR et EN ; la ligne en échec garde son état et le bouton du run reste ; le bilan d'un autre `run_id` ne s'affiche pas dans Tagging ; hôte vide en `display: contents`, tous les écarts de la colonne à 24px
- Lancement : le bouton d'action (« Lancer le run », « Confirmer l'écriture » ou « Relancer l'écriture » selon l'état) est grisé pendant un rollback, tooltip `tagging.blocked.restoring` ouvert sous lui ; une erreur `rollback` rend la main
- Message d'échec compté sur les lignes : 2 lignes `write_error` donnent 2, une restaurée donne 1, les deux restaurées le font disparaître ; le message n'a aucun bouton, la relance est le bouton d'action, en `retry` `primary` plein tant qu'il reste une ligne en échec, puis « Lancer le run »
- Réglages : rangées en `app-settings-row` (grille de 16rem, `py-3`, filet du bas, libellé à gauche, contrôle au bout de la ligne, retours dessous). Clé API : une clé enregistrée = placeholder de 24 points `•`, champ vide, aucun `p-tag` d'état, œil seulement pendant une saisie, « Enregistrer » `small`, aide `text-xs` muted en `pre-line` sous la ligne ; sans clé, le placeholder habituel. Section Administration sous l'API, rangée « Restauration » : l'aide sur la ligne du bouton « Restaurer le dernier run » (`primary` outlined `small` `refresh`, calé à droite), puis, seulement avec un run, la cible dessous (`[data-rollback-target]` « Run du … sur … » tronquée avec tooltip, puis « Morceaux à restaurer : N » sur sa ligne). Cible `undefined` ou `null` : `[data-rollback-target]` absent, zone sous la ligne masquée, bouton grisé, la raison au seul tooltip du bouton (« Recherche du dernier run écrit… » puis `settings.admin.rollback.none`), aucun texte « Aucun run à restaurer » dans la page. Avec un run : date `Intl` localisée (« 6 oct. 2026, 16:30 » puis « Oct 6, 2026, 4:30 PM », fuseau de la machine), dossier, nombre. Priorité des raisons : run en cours, puis écriture ou rollback, spinner seulement pendant `rollingBack`. Modale de la cible ; erreurs `rollback` et `get_rollback_target` traduites sous la rangée, à 12px de ce qui les précède (cible ou bouton) comme du filet du bas, bilan avec échecs sous la rangée ; date `written_at` illisible gardée telle quelle dans la ligne, sans faire tomber la page (section API toujours rendue, aucune erreur en console)
- Ouverture à froid des Réglages : le shell n'affiche l'écran bloquant que sur `available() === false`. Pendant que le lancement n'a pas répondu (`null`), les onglets et la page sont montés. La page demande la cible par un `effect` sur `available()` : rien pendant `null`, exactement un `get_rollback_target` au passage à `true` (aucun de plus à `version`), la cible s'affiche ensuite et le bouton s'active ; un redémarrage par `null` puis `true` en renvoie un seul, la mort du process par `false` (écran bloquant, page démontée) puis `true` aussi. Avant ce `effect` (relevé le 2026-10-10), la requête ne partait qu'à la construction de la page et le bouton restait grisé sur « Recherche du dernier run écrit… ». Simulé par `svc._available.set(null)` puis `true`, puis `null`, `true`, `false`, `true`, après un `page.goto` sur `/settings`

Les tooltips d'un bouton `disabled` s'affichent : Chromium délivre `mouseenter` et `mouseover` à un `<button disabled>` et le tooltip PrimeNG s'ouvre au survol réel (relevé le 2026-10-10 sur les boutons du détail, du run, d'action et des Réglages). WebView2 est le même moteur.

Parcours relevé le 2026-10-10 : 140 contrôles, tous verts, ouverture à froid des Réglages comprise ; rejoué le même jour sur le détail déplié, 141 verts avec le cadre de 8 lignes (un premier passage du jour, 130 verts sur 131, avait révélé la requête jamais renvoyée). Rejoué le 2026-10-11 après la revue d'écran (libellés « Restaurer le run » et « Restauration », rangées `app-settings-row`, aide sur la ligne du bouton et cible dessous seulement avec un run, placeholder de la clé, relance en bouton d'action, tooltips sous l'élément) : 153 verts. Rejoué le même jour avec l'écart de l'erreur Restauration (12px au-dessus et en dessous, avec ou sans cible, après le `mt-1` d'un retour en tête de zone dans `app-settings-row`) : 155 verts. Le contrôle des écarts de la colonne (étape 5) voit un message à hauteur nulle tant que la fenêtre de Playwright n'a pas le focus : son animation d'entrée attend une image (§ Gotchas). Rejoué le 2026-10-11 à la clôture de l'epic : 155 verts ; l'aide de la clé API reste sur une ligne (exception à la rule ngx-translate, décidée le 2026-10-11, DESIGN.md § Arbitrages) ; le tooltip de la cible longue (étape 9) a manqué une fois sur trois, fenêtre sans focus, vert aux deux autres passes.

Rejoué le 2026-10-11 sur la branche des finitions par `run_page.mjs` : détail déplié 36, confirmation 52, rollback 155 (événements simulés avec `restorable`, porté par le sidecar depuis le 2026-10-11), lien 29, garde Playlist 6, tous verts.

Rejoué le 2026-10-12 sur l'invite de reprise par `run_page.mjs` (`playwright-core` du cache npx dont le Chromium headless est téléchargé, révision 1246) : détail déplié 36, confirmation 52 (contrôle 3 réaligné : un run non confirmé ne retient plus la fenêtre), rollback 155, lien 29, garde Playlist 6, tous verts. Les sondes figeaient la version `0.5.0`, périmée par la release 0.6.0 : l'interface restait sur l'écran bloquant. Elles lisent depuis la version de l'interface sur la page (§ Gotchas).

Rejoué le 2026-10-12 sur l'écran récapitulatif par `run_page.mjs` : détail déplié 36, confirmation 52, rollback 155, lien 29, garde Playlist 6, récapitulatif 37, tous verts. `page/rollback-ui.js` réaligné : « Restaurer le run » vit dans un groupe avec « Récapitulatif », la rangée de la barre se lit par `closest(".items-end")` et non plus par le parent du bouton.

Rejoué le 2026-10-13 sur les runs passés par `run_page.mjs`, après le passage de la ligne de contexte dans sa propre rangée à hauteur réservée : détail déplié 36, confirmation 52, rollback 155, récapitulatif 37, runs passés 66, tous verts (lien 29 et garde Playlist 6 non rejoués après ce changement). `page/past-runs.js` réaligné et complété (58 puis 66 contrôles) ; `page/recap.js` (en-tête lu par `closest(".flex-wrap")`, toujours le parent direct du titre) et `page/rollback-ui.js` (contrôle 9, le placeholder « Aucun run passé » n'est pas la raison du bouton) tels que réalignés le même jour sur les Réglages et l'en-tête du sub-project 07.

## Pilotage du récapitulatif

`page/recap.js` rejoue sous `ng serve` un run de six morceaux jusqu'à l'écriture (deux `written` en `auto`, un `written` arbitré, un `write_error` arbitré, un non résolu, un restauré après l'écriture), puis parcourt l'écran `/tagging/recap` et rend un contrôle par règle. Le service est simulé comme au § Pilotage de la confirmation d'écriture. `openUrl` passe par l'IPC de Tauri, absent sous `ng serve` : la sonde pose après le démarrage un `__TAURI_INTERNALS__` qui ne relève que `plugin:opener|open_url` et refuse le reste, l'ouverture réelle du navigateur n'étant pas un geste à faire sur le poste de l'utilisateur. La route s'ouvre par le routeur du shell (`ng.getComponent(app-root).router`), jamais par `page.goto`, qui recrée le service.

- Sans run : état encadré « Aucun run à récapituler », sans liste, sous l'en-tête réduit à « Retour à la liste » et au titre
- Entrée : « Récapitulatif » absent avant le bilan de l'écriture, puis `outlined` `secondary` `small` à côté de « Restaurer le run » ; il ouvre `/tagging/recap`, onglet Tagging sélectionné, titre « Récapitulatif du run » en 24px 600
- Filtres : compteurs 6 / 2 / 1 / 2, lignes conformes à la règle, l'échec d'écriture arbitré sous « Échecs » seul, le restauré sous « Tout » seul ; `aria-label` de chaque option au libellé et au compteur, jamais `[object Object]` ; libellés et compteurs suivent la langue
- Recherche : `"  DIM orbit "` trouve « Dim Orbit », le nom de fichier aussi ; rien sous « Validés » pour un titre absent : « Aucun morceau ne correspond » et « Changez de filtre ou videz la recherche. » dans la table
- Détail : un seul lien, sur la ligne URL, bouton `link` en 12px avec l'icône `external-link`, nommé par l'URL qu'il affiche (aucun `aria-label`), URL longue tronquée dans sa cellule ; toutes les lignes de champs à 20px (la bordure du bouton `link` en ajoutait 2, retirée par `border-0`, relevé le 2026-10-12), rien ne défile dans le cadre ; un clic relève `open_url` avec l'URL du candidat ; un filtre qui retire le morceau referme son détail, qui ne revient pas avec lui
- Page : message d'échec d'écriture compté sur les morceaux affichés, sections à 24px, « Restaurer le run » `outlined` `primary` `small` `refresh`, « Nouveau run » `text` `secondary` `small` `plus` calé à droite, « Retour à la liste » `text` `secondary` `small` `chevron-left` avant le titre, aucun « Envoyer ce rapport » (Feature 9), aucun défilement à 1280 × 800
- En-tête au plancher 1024 × 700 : rien ne déborde, titre et retour sur une ligne chacun en FR comme en EN ; en FR, filtres et recherche passent sous le titre (`flex-wrap`, comme la maquette)
- Clic sur l'onglet Tagging déjà actif depuis le récapitulatif : l'URL ne change pas (`p-tabs` n'émet rien sur sa valeur courante), d'où « Retour à la liste »
- « Restaurer le run » `disabled` pendant une restauration ; « Retour à la liste » rend `/tagging` avec le run gardé ; « Nouveau run » rend `/tagging` sans morceau, sans dossier demandé, `tagging()` faux, puis `startTagging` repart

Parcours relevé le 2026-10-12 sur le sub-project écran récapitulatif : 37 contrôles verts, après correction de l'en-tête (titre et retour coupés sur deux lignes en FR à 1024px) et de la hauteur de la ligne URL.

## Pilotage des runs passés

`page/past-runs.js` rejoue sous `ng serve` la rangée « Runs passés » des Réglages, l'ouverture d'un run passé, ses refus et son retour au run affiché, et rend un contrôle par règle. Le sidecar est simulé par `svc.transport.send` (relevé dans `window.__sent`) et non par `svc.send` : le vrai `send` efface `lastError` à chaque commande, ce que le refus de `load_run` doit survivre (`loadRefusal`). Le moteur passe par `svc._available.set(null)`, la navigation vers `/settings` (routeur du shell, jamais `page.goto`), puis `true`, pour prouver l'envoi de `list_runs` à la disponibilité. Les libellés attendus sont calculés dans la page par `Intl` (fuseau de la machine, runs posés à midi UTC pour garder le jour).

- Réglages, `list_runs` : aucun envoi tant que le moteur est inconnu (`null`), exactement un au passage à `true` (aucun de plus à `version`), un après `run_finished` en phase `write` et aucun après la phase `network`
- Réglages, liste : options « Run du … sur … » dans l'ordre reçu (5 août puis 2 août), le plus récent par défaut ; choix de l'autre run gardé par une nouvelle liste qui le contient et par FR / EN, retombé sur le plus récent quand il disparaît ; registre vide ou liste pas encore arrivée : select et bouton désactivés, placeholder « Aucun run passé » / « No past run »
- Réglages, rangée : sous « Restauration », libellé `text-sm` seul à gauche, select sans largeur figée (725px à 1280) puis bouton `secondary` outlined `small` sur la même ligne, aide `text-xs` sous le contrôle, nom accessible du select (`aria-labelledby` vers le libellé), aucun défilement à 1280 × 800 et 1024 × 700 en FR et en EN ; dossier très long coupé avec son libellé entier en tooltip, ni la rangée ni la page n'élargissent
- Ouverture : `/tagging/recap/<runId>`, onglet Tagging actif, un seul `load_run` avec ce `run_id`, `app-skeleton-rows` et jamais l'état vide « Aucun run à récapituler » tant que `run_loaded` n'est pas arrivé, « Retour à la liste » avant le titre, puis la ligne de contexte au même texte que l'option des Réglages, dans sa propre rangée `flex min-h-5 text-sm text-muted-color` (20px, 14px, 4px sous l'en-tête) enfant du conteneur `flex-col` qui porte l'en-tête, le titre étant enfant direct de l'en-tête `flex-wrap`. La rangée existe dès l'ouverture, squelettes affichés, vide jusqu'à `run_loaded` : sa hauteur et le haut de la table ne changent pas à l'arrivée du run (écart nul à 1280 × 800 en FR et en EN ; à 1024 × 700 le haut de la table ne bouge que de ce que fait l'en-tête, les filtres qui arrivent avec les morceaux et passent sous le titre en FR)
- Données : compteurs 6 / 3 / 1 / 2 (un échec d'écriture arbitré sous « Échecs » seul), recherche, détail avant / après et lien source (`open_url` relevé), comme `page/recap.js`
- Lecture seule : aucun `[data-action*="restore"]`, ni « Nouveau run », ni `[data-write-failures]`, ni `app-rollback-failures`, aussi par-dessus un run vivant écrit qui porte des morceaux restaurables, des échecs d'écriture et un bilan de restauration (la sonde prouve d'abord qu'elle les voit sur le run vivant) ; sur `/tagging/recap` sans `runId` le run vivant revient, sans ligne de contexte, avec ses boutons, ses compteurs (6 / 2 / 1 / 2) et sans squelette
- Refus : `run_not_found` et `phase_busy` (sans `run_id`, attribué au run en chargement) : message traduit sous l'en-tête et état vide encadré « Impossible d'afficher ce run », bouton Retour gardé, ni table ni filtres, FR et EN ; un `loadRollbackTarget()` ou `listRuns()` envoyé ensuite n'efface ni le message ni ne ramène le squelette ; le refus d'un autre `run_id` et un `run_loaded` d'un run que personne n'attend laissent les squelettes, la réponse attendue s'affiche ensuite ; moteur `null` : squelettes sans commande, un seul `load_run` à la disponibilité ; rouvrir le même run après un refus renvoie la commande
- En-tête au plancher 1024 × 700, FR et EN : rien ne déborde, « Retour à la liste » à gauche du titre sur la même ligne (centres à 2px près), titre et retour sur une ligne chacun, ligne de contexte courte comme dossier de 100 caractères (coupée dans sa rangée, tooltip au texte entier en FR et en EN, ni la rangée ni la page n'élargissent)
- En-tête d'un run passé aussi haut que celui du run vivant (court comme dossier de 100 caractères, FR et EN) : la ligne de contexte n'y change rien et ajoute sous lui sa seule rangée, 20px plus 4px d'écart (blocs de 24px de plus)
- Refus : aucune rangée de contexte une fois refusé (`run_not_found`, `phase_busy`), alors que la rangée est réservée pendant le chargement ; run vivant : aucune rangée non plus, pas même réservée

Parcours relevé le 2026-10-13 sur le sub-project runs passés, rangée de contexte à hauteur réservée : 66 contrôles verts (58 avant le changement, dont ceux de l'en-tête réalignés, 8 ajoutés). Relevés à garder en tête, non imposés :
- Avant ce changement la ligne de contexte vivait dans la colonne du titre et n'arrivait qu'avec `run_loaded` : la table descendait de 20px (138 puis 158px à 1280 × 800) et, à 1024 × 700, un dossier de 100 caractères passait « Retour à la liste » au-dessus du titre (en-tête de 144px). Relevé après : table à 162px avant et après `run_loaded` à 1280 × 800, en-tête de 32px, retour et titre sur la même ligne avec le dossier de 100 caractères, rangée de contexte de 896px coupée
- À 1024 × 700 le haut de la table descend de 48px à l'arrivée des morceaux en FR seulement (en-tête de 32px puis 80px : les filtres passent sous le titre), de 0 en EN ; c'est l'en-tête et non la ligne de contexte, identique à celui du run vivant (80px en FR, 32px en EN). La ligne de contexte s'aligne alors sous les filtres, à gauche du cadre de la table
- `phase_busy` : le refus n'a pas de `run_id`, le store l'attribue au `runId` en chargement ; la page affiche la phrase de la phase qui tourne (`errors.phase_busy.<phase>`) à la place de la table, et rouvrir le run renvoie `load_run`

Gotchas : un `select` PrimeNG ouvert garde son overlay tant qu'on n'appuie pas sur Échap (la sonde le ferme après chaque lecture) ; l'en-tête du récapitulatif est le `.flex-wrap` parent direct de `h1`, la rangée de contexte son frère `:scope > .min-h-5` dans le conteneur `flex-col` (`page/past-runs.js`, helper `block()`, réaligné le 2026-10-13) ; le placeholder « Aucun run passé » des Réglages contient « Aucun run » (`page/rollback-ui.js` contrôle 9 réaligné le 2026-10-13 : `/Aucun run(?! passé)/`).

## Pilotage de la garde de fermeture

La fermeture part de l'extérieur de la page, par `taskkill //IM techno-tagger.exe` **sans** `/F` : c'est le message de fermeture de Windows, le même que la croix ou Alt+F4, qui déclenche `onCloseRequested`. Un `close()` depuis la page ne passerait pas par l'OS. Une fenêtre retenue laisse `techno-tagger.exe` en vie après le `taskkill`, qui annonce pourtant son signal envoyé : compter le process, pas lire le message.

Le travail en cours se pose sur le service vivant par `page/close-guard.js` (l'extraction de fixture dure une fraction de seconde, le run tape la vraie API) : la garde ne lit que les signals du service, la fenêtre, la modale et la capability restent réelles.

### Flux qui valent le coup

- Rien en cours : la fenêtre se ferme au premier `taskkill`, `tagger.exe` part avec elle
- Extraction en cours : fenêtre retenue, confirmation au titre `h3` « Quitter l'application ? », un bloc par travail dont les phrases sont une par ligne (`whitespace-pre-line`, sonde réalignée le 2026-10-11, à rejouer), focus sur « Rester », pied calé à droite (« Quitter quand même » `p-button-outlined p-button-secondary`, puis « Rester » primary), aucun `p-button-danger`, largeur 512px en FR comme en EN, rayon 12px, masque `rgba(0, 0, 0, 0.6)`. Échap au vrai clavier (`cdp.mjs --key Escape`), la croix et « Rester » la referment sans fermer la fenêtre, l'extraction toujours en cours
- « Quitter quand même » pendant une extraction ferme la fenêtre et le sidecar, preuve que `core:window:allow-destroy` est accordée
- Run et deux arbitrages en attente (`pending run-arbitrations`), extraction retirée par `clear` : la fenêtre se ferme au premier `taskkill`, sans confirmation, et `tagger.exe` part avec elle. Le plan de run rend run et arbitrages à la reprise (2026-10-12) : seules l'extraction, l'écriture et la restauration retiennent la fenêtre
- Instantané : un travail ajouté pendant la confirmation ne change pas la liste affichée, un second `taskkill` la remplace par l'état du moment
- Écran bloquant : extraction en cours, `taskkill //F //IM tagger.exe` fait tomber le sidecar et l'état, puis la fenêtre se ferme au premier `taskkill` sans confirmation

Parcours relevé le 2026-09-27 sur les cinq scénarios du spec `05-confirmation-sortie`, tous verts. Rejoué le 2026-10-12 sur l'invite de reprise : extraction retenue (une seule ligne, « Rester » la referme), run avec deux arbitrages fermé au premier `taskkill`, aucun `tagger.exe` restant.

## Pilotage du trousseau

`set_api_key` écrit dans le **vrai** Credential Manager de Windows (cible `techno-tagger`, utilisateur `x-api-key`) : aucun trousseau en mémoire hors pytest et `LOCALAPPDATA` n'isole rien ici.

- Lire d'abord `api_key_configured` par `get_version`. S'il vaut `true`, une clé réelle est enregistrée : ne rien écrire, se limiter à la lecture, aux rejets hors format et à la recherche de fuite
- S'il vaut `false` : clé factice reconnaissable, puis suppression en fin de parcours (`uv run --directory sidecar python -c "import keyring; from tagger import APP_NAME; keyring.delete_password(APP_NAME, 'x-api-key')"`), prouvée par un dernier `get_version` à `false` et par `cmdkey //list`
- Rejouer le même parcours sur le binaire figé (`just build-sidecar`, puis `src-tauri/binaries/tagger-x86_64-pc-windows-msvc.exe` alimenté par un pipe) : c'est le seul endroit où un backend keyring introuvable se voit
- Fuite : `grep -rl <clé factice>` sur `stdout`, `stderr` et le dossier des logs, code de retour 1 attendu

### Flux qui valent le coup

- Clé API : hors format (espace, non ASCII, vide, champ en trop) rendu en `malformed_command` sans la valeur dans `params`, enregistrement répondu par `version` à `api_key_configured: true`, état retrouvé par un nouveau process

## Pilotage de l'interface

```bash
just dev-ui                                                                    # en arrière-plan, prêt quand le log affiche localhost:4200
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" just dev  # en arrière-plan, port 4200 libéré avant
```

- Lire l'état dans la page : `document.documentElement.lang`, le texte des `p-tab` et du `h1`, `performance.getEntriesByType("resource")` pour les `/i18n/*.json`
- Forcer une langue de navigateur : redéfinir `Navigator.prototype.language` par `addInitScript` (Playwright) ou `Page.addScriptToEvaluateOnNewDocument` (CDP), puis recharger
- Simuler un fichier de langue absent : `page.route("**/i18n/fr.json", (r) => r.fulfill({ status: 404 }))`
- Fournir un chemin sans ouvrir le sélecteur natif : poser les signals du composant (`sourceFolder`, `destinationFolder`, `playlistPath` sur l'onglet Playlist, `folder` sur l'onglet Tagging) par `ng.getComponent(document.querySelector("app-<ecran>-page"))`, puis cliquer les vrais boutons (`button[pbutton]`, repérés par leur texte traduit). Le reste du parcours suit les handlers réels. Remplacer `openPath` sur l'instance ne marche plus : le wrapper est devenu l'util partagé `pickPath` de `shared/utils/dialog.ts` (2026-09-23), importé par les deux écrans et donc hors de portée depuis la page
- Lire ou écrire le `store` depuis la page : `__TAURI_INTERNALS__.invoke("plugin:store|load", { path: "preferences.json" })` rend un `rid`, puis `plugin:store|get` avec `{ rid, key }` rend `[valeur, existe]`
- Lire un service `providedIn: "root"` depuis la page (build de dev) : parcourir `ng.ɵgetInjectorResolutionPath(ng.getInjector(document.querySelector("app-root")))`, chercher dans `ng.ɵgetInjectorProviders(inj)` la classe dont le nom finit par `SidecarService` (`Object.values(record)`), puis `inj.get(classe)` et lire ses signals. Sous Tauri, `__sidecarService()` de `scripts/page/preamble.js` le fait, préalable que `cdp.mjs` injecte devant chaque script de page

## Flux interface qui valent le coup

- Nominal : `/playlist`, `/tagging`, `/settings` dans la langue de la machine, `lang` du `<html>` aligné
- Chaîne de langue sous `ng serve` : `navigator.language` décide (`de-DE` → anglais, `fr-BE` → français, vide → anglais)
- Sous Tauri : la locale système (`invoke("plugin:os|locale")`) l'emporte sur un `navigator.language` forcé
- Développement : un `fr.json` en 404 laisse l'écran blanc, la cause en console (`failOnError`)
- Sidecar sous Tauri : `available` vrai, `version` égale à la version nue de `package.json` et `versionMismatch` nul, un seul `tagger.exe` ; `listPlaylists(<dump de fixture>)` alimente `playlistFormat` et `playlists` ; un chemin absent alimente `lastError` sans couper le flux
- Sidecar sous `ng serve` : `available` faux, `[sidecar] lancement impossible` tracé en console, pages navigables par URL, une commande émise pose `lastError.code = "sidecar_unavailable"` sans lever
- Extraction réelle par le service (`listPlaylists` puis `extractPlaylist` sur un dump et une bibliothèque de fixture) : `extracting` vrai et `ready` faux pendant le run, puis retour au repos, rapport dans `extraction()`, fichiers et rapports `.json` + `.md` en destination, bibliothèque intacte
- Release sans rechargement : `pnpm exec tauri build --no-bundle`, lancer `src-tauri/target/release/techno-tagger.exe` avec `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, poser par CDP un marqueur `window.__marker` et un écouteur `keydown`, envoyer `^r` puis `{F5}` par `SendKeys` PowerShell (`AppActivate` sur le pid) : les touches arrivent, le marqueur survit, un seul `tagger.exe`
- Onglet Playlist sous Tauri, fixture du § Fixture isolée plus un M3U8 à deux entrées, un M3U8 réduit à `#EXTM3U`, un faux JPEG et un morceau du dump absent de la bibliothèque :
  - chemins affichés tronqués par la gauche, largeur des boutons de sélection identique avant et après sélection
  - « Extraire » désactivé : au survol, tooltip qui nomme les choix manquants (« Choisissez le dossier source, le dossier destination et un fichier de playlist. »), réduit à ce qui reste à mesure des choix
  - faux JPEG : bannière d'erreur (`app-error-message`, `p-message-error`, icône `times-circle`), « Extraire » désactivé et son tooltip redemande un fichier de playlist ; M3U8 : icône `file`, aucun sélecteur ; dump : squelette, logo VLC, options « nom (N) », « Extraire » actif seulement une playlist choisie
  - libellés des sélecteurs de chemin : `label pLabel` à 14px et 400, `htmlFor` pointant sur le bouton
  - sélecteur de playlist, relevé le 2026-09-25 : un nom long se coupe à la largeur des boutons avec tooltip, la colonne des contrôles et « Extraire la playlist » gardent leur largeur ; la liste déroulante montre le nom entier
  - extraction : dès le clic, formulaire replié en résumé (source › destination › playlist · mode, logo VLC ou icône `file` suivie du nom du M3U8) et « Modifier » `disabled` ; barre indéterminée sans compteur sous le résumé, puis déterminée avec « N sur 30 », sans texte dans la barre ; à la fin, barre retirée et « Extraction terminée (30 sur 30) » sous la table, à droite ; « Modifier » rouvre le formulaire au-dessus du rapport et la relance replie de nouveau, vide le rapport et repart en indéterminée sans compteur
  - onglet quitté puis rouvert par les `p-tab` : résumé identique, « Modifier » rouvre sur les dossiers et la playlist du run ; un autre fichier listé entre-temps sans relancer rouvre sur ce fichier, sans playlist, tooltip « Choisissez une playlist. » et la commande suivante porte ce fichier
  - rapport : deux colonnes, Fichier fluide et État à 197px, constante sur tout le défilement, en-tête collé en haut, une ligne par morceau plus une par doublon, ordre échecs puis introuvables, doublons, déjà présents et extraits, hauteur réelle du `<tr>` égale à `rowHeight`, libellé de tag sur une ligne ; icône `info-circle` sur les seuls doublons et échecs, dont le badge ouvre le détail en tooltip `wide` ; relancée dans la même destination, les morceaux passent en « Déjà présent »
  - M3U8 vide vers une destination neuve : table pleine hauteur, bloc « Playlist vide » centré (écarts égaux sous l'en-tête et au pied), cellule sans bordure basse, aucune ligne « Extraction terminée » (le sidecar n'émet aucun `progress` sur une playlist vide) ; rapports `.json` + `.md` écrits, compteurs à zéro
  - bascule « Déplacer » : `extraction_mode` vaut `move` dans le `store` et le choix survit à `Page.reload` ; remettre ensuite la valeur d'origine
  - sous `ng serve` seul : écran bloquant en `p-card` centrée, sans barre d'onglets, action « Réessayer »
  - pendant un run : aucun formulaire monté (la grille `.grid` absente), seul « Modifier » est proposé, `disabled`
- Conformité à DESIGN.md sur l'onglet Playlist :
  - container du shell sur les trois onglets, en cliquant les `p-tab` : padding `32px 64px`, `h1` à 64px du bord gauche et 32px du haut de `main`, l'URL suit l'onglet
  - aucun défilement de page (`document.scrollingElement` et `main`), la table remplit la hauteur restante, à 1280 × 800 puis au plancher 1024 × 700 par `Emulation.setDeviceMetricsOverride`. Relever les lignes visibles du rapport : le 2026-09-17, résumé replié, 12 lignes à 1280 × 800 et 10 au plancher ; le conteneur de la table descend jusqu'à la ligne « Extraction terminée », ou jusqu'au pied de la page quand un run vide ne l'affiche pas
  - grille du formulaire : boutons de sélection, `p-select` et `p-selectbutton` à la même largeur, chemins alignés sur le bord droit de la grille, « Extraire la playlist » sur la ligne du mode, calé sur le bord droit de la grille, à la largeur des libellés et des contrôles réunis, `p-skeleton` à la hauteur du `p-select` qui le remplace, bloc vide (icône 24px `text-muted-color`, titre `text-base`, phrase `text-sm`)
  - tags : familles de § Couleurs Sémantiques, lues sur la classe `p-tag-*` et l'icône `data-p-icon`
  - tooltip : suivre `.p-tooltip` toutes les 100ms après un `Input.dispatchMouseEvent` : visible à 400ms sur un texte coupé, jamais sur un texte entier, retiré dès la sortie, classe `tt-tooltip-wide`, `pointer-events: none`
- Parcours métier complet sous Tauri, sur `just demo` fraîchement bâtie : extraction de `test playlist` du dump vers `demo-data/Extraction`, « Passer au tagging », run sur les 27 fichiers de la destination. Les titres de la démo sont en partie inventés, la vraie API rend donc d'elle-même les trois issues. Relevé le 2026-09-25 : 9 auto (tagués et repli sur le nom de fichier), 17 non résolus en `below_threshold`, 1 arbitrage (« Silas Orman - Quiet Meridian », tag `p-tag-info` « À arbitrer », squelette à la place de la pochette). Relevé le 2026-10-02 contre la production 4.0.0 : 8 auto, 17 non résolus, 2 arbitrages, candidats affichés « Titre (Mix Name) » ; choix au clic puis Entrée passe la ligne en « Arbitré », refus de « Quiet Meridian » rend une liste Bandcamp vide puis « Passer ». Ces chiffres suivent le catalogue de la source, un écart se lit dans les réponses du cache avant de conclure à une régression :
  - « Passer au tagging » absent avant toute extraction, pendant l'extraction et après une playlist vide (aucun `progress` émis, comportement voulu), présent à la fin d'une extraction non vide
  - pendant le run, retour sur Playlist, « Modifier » : « Extraire » désactivé, tooltip `playlist.blocked.tagging` au survol, réactivé à la fin de la recherche. Une seule phase longue à la fois depuis le 2026-10-09 (§ Concurrence d'ARCHITECTURE.md) : le sidecar refuse aussi l'extraction en `phase_busy` (`params.phase` à `tagging`), ce que `test_refuses_an_extraction_while_a_run_searches` garde
  - pendant une extraction, « Lancer le run » désactivé, `blockedReason()` à `tagging.blocked.extracting`, réactivé à la fin. L'extraction de la démo dure une fraction de seconde : lancer `svc.extractPlaylist(svc.extractionRequest())` depuis l'onglet Tagging et échantillonner toutes les 5ms
  - un toast par phase terminée, **y compris quand l'utilisateur est sur l'autre onglet** (spec 10, scénarios 4 et 6) : lancer l'extraction depuis Tagging par le service, puis le run depuis Playlist. Régression du 2026-09-25 à ne jamais laisser revenir : branché dans le constructeur de chaque page, le signal mourait avec elle. Il vit dans le constructeur de `CompletionSignalService`, construit au démarrage par un `provideAppInitializer`
- Onglet Tagging sous Tauri, après une extraction vers `demo-data/Extraction` puis « Passer au tagging » :
  - dossier prérempli avec la destination de la dernière extraction, bouton de lancement actif si une clé est enregistrée
  - sans dossier : bouton désactivé, tooltip « Choisissez d'abord le dossier à re-tagger. » à 400ms, bloc vide « Aucun run lancé » centré
  - ligne du dossier, relevée le 2026-09-25 : titre seul au-dessus ; bouton « Choisir un dossier » sans libellé, chemin collé à lui et absent avant le choix, « Lancer le run » (et « Interrompre » pendant un run) calé à droite
  - liste du run : largeurs des colonnes identiques avant et après la résolution d'un morceau (`table-layout: fixed`), titre et nom de fichier trop longs coupés avec tooltip `wide`, aucun tooltip sur un texte entier
  - run lancé : les lignes apparaissent d'un coup, barre « Recherche en cours » affichée, bouton désactivé le temps du run, puis barre retirée et bouton réactivé
  - fin de phase réseau : **un seul** toast, libellé de la clé `tagging.finished`. Le compter par un `MutationObserver` sur `.p-toast-message` posé avant le run, sa durée de vie n'étant que de 4s
  - régression du 2026-09-23 à ne jamais laisser revenir : enchaîner une dizaine de changements d'onglet après un run **et** une extraction terminés, le compteur de toasts doit rester à un par phase. Le signal n'étant plus branché dans les pages, un changement d'onglet ne peut plus le rejouer : vérifié le 2026-09-25, zéro toast sur dix bascules
  - dossier introuvable : `lastError` de code `tagging_folder_unreadable`, bannière traduite sous l'en-tête, bouton de lancement réactivé. L'écran filtre par `lastErrorCommand() === "start_tagging"`, pas par une liste de codes
  - états vides, relevés le 2026-09-25 : sans run, bloc encadré « Aucun run lancé » dont la phrase suit `folder` (vide : « Choisissez… », posé : « Lancez le run… ») ; pendant le parcours du dossier, avant `run_started` (`taggingRunId()` nul), la liste montée avec des lignes squelette sur toute la hauteur, jamais « Aucun run lancé » ; run fini sur un dossier sans audio, « Aucun fichier audio dans ce dossier » dans la table. Un gros dossier sans audio (`node_modules` du dépôt, vérifié sans fichier audio) donne plusieurs secondes de parcours sans rien envoyer à l'API
  - run coupé après `run_started` (rejouer `run_started`, un `track_resolved` puis un `error` `api_key_rejected` par `svc.handleLine`, après `svc.send` neutralisé et `svc.startTagging`) : les morceaux jamais atteints passent en « Non traité », tag `secondary` et icône `minus-circle`, cadre de pochette et non squelette
  - interruption à la demande : pendant un run, « Interrompre » `secondary` outlined à icône `stop` prend la place du lancement (bouton d'action unique) ; absent avant et après le run. Au clic, la commande `cancel_run` part, la barre disparaît, les morceaux déjà résolus gardent source, scores et pochette, les suivants passent en « Non traité » et le bouton passe à « Confirmer l'écriture », le run interrompu gardant son écriture. Aucune modale : rien n'est irréversible avant l'écriture. Le relancer ensuite doit repartir d'une liste vide, sans `phase_busy`
  - motif d'un non résolu : icône `info-circle` après le tag, texte `tagging.reason.<failure_reason>` au survol (un motif de résolution ; une panne de fichier prend `reason.<motif>` puis `reason.fix.<motif>`) (`mouseenter` sur le `span.inline-flex` de la cellule, puis `.p-tooltip`)
  - en anglais : colonnes « Before / After / Source / Score / State », bouton « Start the run », aucune clé brute
  - à 1280 × 800 puis au plancher 1024 × 700 : aucun défilement de page ni de `main`, en-tête sans débordement
- Onglet Réglages sous `ng serve`, sidecar simulé (`svc.send` remplacé, réponse par `svc.handleLine`) : aucun tag d'état de la clé, jamais (une clé enregistrée se lit à son placeholder de 24 points `•` et le champ reste vide ; sans clé, le placeholder « Saisir la clé reçue ») ; l'œil n'apparaît que pendant une saisie ; « Enregistrer » désactivé champ vide ; envoi, champ vidé, placeholder de points et commande `set_api_key` relevée dans `send` ; erreur `api_key_not_stored` rendue sous la rangée, sous l'aide ; en FR et en EN au plancher 1024 × 700, sans défilement, texte d'aide à remesurer dans `app-settings-row`
- Clé mal formée, sous Tauri et sans risque pour la clé réelle (la validation refuse avant le trousseau) : saisir `abc def`, « Enregistrer » → message `errors.api_key_malformed` sous la rangée, `api_key_configured` inchangé. Régression du 2026-09-25 : ce refus sortait en `malformed_command` sans `command` et aucun écran ne l'affichait
- Onglet Playlist, états vides : avant toute extraction, bloc encadré « Aucune extraction lancée » ; pendant l'extraction, lignes squelette dans la table du rapport (l'extraction de la démo dure une fraction de seconde : les compter par un `MutationObserver`) ; « Passer au tagging » en `primary` outlined (`p-button-outlined` sans `p-button-secondary`)
- Fin de session : fermer la fenêtre par `taskkill //IM techno-tagger.exe` sans `/F` (message de fermeture), puis constater que `tagger.exe` a disparu. Seule une extraction, une écriture ou une restauration en cours fait retenir la fenêtre par la garde de fermeture : cliquer « Quitter quand même » par `page/close-guard.js click leave` (une écriture ou une restauration ne propose que « Rester »)

Compter un élément éphémère, toast ou ligne squelette, se fait par un `MutationObserver` posé avant le geste, qui cherche la classe dans les **descendants** du nœud ajouté : PrimeNG insère le toast dans un conteneur et tester le seul nœud ajouté compte zéro.

## Gotchas

- `just` écrit la ligne de recette (`uv run python -m tagger`) sur `stderr` : ne pas la prendre pour une fuite du protocole
- Un faux CDN bâti sur `BaseHTTPRequestHandler` doit comparer `self.path` amputé de sa query : les URL de pochettes distinctes se forgent par `?v=<n>` et un `self.path == "/cover.jpg"` nu les renvoie toutes en 404
- Console Windows en cp1252 : un `print` non ASCII dans un script de fixture lève `UnicodeEncodeError`, poser `PYTHONIOENCODING=utf-8`
- Un octet non UTF-8 sur `stdin` fait tomber le process et avec lui les commandes valides du même bloc lu : comportement documenté de `run_loop`, pas une régression
- Le logger du point d'entrée s'appelle `__main__` et non `tagger.__main__` sous `python -m`
- Mode `move` : ne le piloter que sur une copie de la bibliothèque de fixture
- `just dev` lance lui-même `pnpm start` (`beforeDevCommand`) : arrêter `just dev-ui` avant, sinon le port 4200 est pris
- Après arrêt, contrôler qu'aucun `techno-tagger.exe` ni port 4200 / 9222 ne reste (`tasklist`, `netstat -ano`), `just stop` sinon
- Le MCP Playwright n'écrit ses captures que sous la racine du dépôt (`.playwright-mcp/` est git-ignoré, un nom de fichier nu atterrit à la racine) : les déplacer vers le scratchpad
- Dans WebView2, `navigator.language` vaut `fr` et non `fr-FR`
- Un faux JPEG en texte ASCII se lit comme un M3U8 valide et vide : écrire de vrais octets (`\xff\xd8\xff\xe0…`) pour obtenir `unsupported_playlist_format`
- Un survol calculé sur la position théorique d'une ligne peut tomber hors de la zone visible de la table, sur `main`. Viser un tag dont `document.elementFromPoint` rend bien le badge
- Sous `ng serve`, simuler le sidecar sur l'instance du service plutôt que le transport : `svc._available.set(true)`, `svc.handleLine(JSON.stringify(event))` pour chaque événement et `svc.send` remplacé pour répondre aux commandes. La clé d'un provider se lit par `record["tok" + "en"]`, le hook bloquant le mot écrit en entier
- Changer d'onglet par les `p-tab`, jamais par `page.goto` : un rechargement recrée le service et perd l'état simulé. Le composant de page, lui, est recréé : relire `ng.getComponent` après chaque retour sur l'onglet avant d'en poser les signals
- Le nom accessible d'un bouton de `PathPickerComponent` est son libellé (`label for`), pas son texte : `getByRole` par le texte échoue, viser `locator("app-path-picker button", { hasText })`
- Playwright ralentit `requestAnimationFrame` sur une page qui n'a pas le focus : `page.bringToFront()` et échantillonner une animation par `setInterval`. Même cause pour un élément en `animate.leave` sans animation, qu'Angular retire à la `requestAnimationFrame` suivante : il reste une seconde au lieu d'une image, et `:focus-within` ne s'applique qu'une fois la page active
- Une mesure de performance cadencée par `requestAnimationFrame` part en secondes dès que la fenêtre de Playwright passe à l'arrière-plan, sans aucune tâche longue : `page.bringToFront()` ne suffit pas quand l'utilisateur se sert de son poste. Mesurer le coût d'un événement en forçant le rendu de façon synchrone (`ng.applyChanges` sur le composant racine puis une lecture de mise en page), et ne garder `requestAnimationFrame` que pour les contrôles qui ne chronomètrent rien
- Une mesure prise juste après un événement simulé peut tomber pendant le rendu : relever les positions par un `MutationObserver` posé avant, qui voit chaque état intermédiaire, plutôt que par un `setTimeout` fixe
- Plusieurs `ng serve` lancés depuis des worktrees partagent le cache `.angular/cache` et répondent en 504 « Outdated Optimize Dep » : les lancer avec `CI=1`
- Fermer la fenêtre par `taskkill` sans `/F` emporte aussi les sidecars accumulés par les rechargements (des dizaines ramenées à zéro) : repartir de là avant de compter les `tagger.exe`
- Le sidecar meurt avec la fenêtre sans que `shutdown` soit envoyé : mesuré le 2026-09-18 avec et sans câblage d'`onCloseRequested`, `tagger.exe` à zéro en moins de 2s dans les deux cas, malgré tauri-apps/tauri#11686. Ce câblage n'apporte rien : pendant un run, la boucle est dans `to_thread` et ne lirait pas la commande. Des `tagger.exe` orphelins viennent d'un `just dev` tué brutalement, pas d'une fermeture. `close()` après un `preventDefault()` passe d'ailleurs par `destroy` : sans `core:window:allow-destroy`, la fenêtre reste ouverte
- `src-tauri/binaries/` garde le sidecar du dernier `just build-sidecar` : après toute modification de `sidecar/src`, reconstruire avant `just dev`, sinon la fenêtre parle à un binaire périmé (comparer la date du `.exe` au dernier commit de `sidecar/src`)
- Chaque rechargement de la page sous `just dev` (live reload, `Page.reload` CDP) lance un sidecar de plus sans tuer le précédent : compter les `tagger.exe` sur une fenêtre fraîchement ouverte. En release, `F5`, `Ctrl+R` et le menu contextuel sont coupés par `tauri-plugin-prevent-default`, le debug les garde
- Le premier `SendKeys` après `AppActivate` peut partir avant le focus : envoyer d'abord une touche sans enjeu et ne conclure que sur une touche vue par l'écouteur `keydown`
- Ne pas lancer `just test` pendant `just build-sidecar` : le build pose un `_build_info.py` de production le temps de la compilation et `test_build_info` échoue
- Les hooks bloquent `curl` (exécution distante) et tout heredoc contenant le mot `token` (fichier sensible supposé) : `cdp.mjs` interroge `http://127.0.0.1:9222/json` par `fetch`. Le même hook attrape l'expression qui parcourt les providers d'un injecteur, `record["tok" + "en"]` n'y suffisant pas quand elle passe en argument de commande : c'est pourquoi elle vit dans `page/preamble.js` (lu par `cdp.mjs`) et jamais dans une commande. Un nouveau script de page s'écrit par l'outil Write, dans `scripts/page/`
- Un dossier passé à `start_tagging` sous sa forme Git Bash (`/c/Users/...`, celle de `$PWD`) rend `tagging_folder_unreadable` : Python sous Windows ne le lit pas, écrire `C:/Users/...`
- Un chemin Windows passé en argument shell à `Runtime.evaluate` perd ses backslashes et le sidecar répond `tagging_folder_unreadable` sur un chemin amputé : le passer en argument de `cdp.mjs`, qui le transmet par `__args` sans jamais l'écrire dans l'expression
- Le run de re-tagging sous Tauri tape la **vraie** API techno-scraper avec la clé enregistrée sur la machine, `API_BASE_URL` étant une constante du module qu'aucune variable d'environnement ne détourne. Les trente morceaux de la démo tiennent sans peine sous le seul plafond connu (Bandcamp, environ 185 appels par 3 minutes, cf. `docs/knowledges/techno-scraper.md`). La phase réseau n'écrit aucun tag, l'écriture appartenant à la Feature 5
- Relever les issues que la vraie API rend avant de piloter l'interface : `start_tagging` sur `demo-data/Bibliotheque` envoyé au binaire figé par un pipe, sous un `LOCALAPPDATA` du scratchpad. Le cache réel reste froid pour le run sous Tauri et les réponses brutes se relisent dans `cache/responses/*.json` pour trancher entre un catalogue qui n'a pas le titre et un matching fautif
- `ng.ɵgetInjectorProviders` lève sur certains injecteurs du chemin de résolution (« only supports NodeInjector and EnvironmentInjector ») : l'entourer d'un `try` et passer au suivant
- Le toast de fin (4s, en bas à droite) recouvre le pied de page, ligne « Extraction terminée » et bouton « Passer au tagging » compris : viser le bouton une fois le toast parti
- Une extraction de fixture écrit sa destination dans `last_destination` du `store` (`%APPDATA%/fr.empiricmind.techno-tagger/preferences.json`) : relever la valeur avant la passe et la remettre après, par l'outil Write, le hook bloquant une commande qui nomme ce fichier
- `__TAURI_INTERNALS__.invoke` n'est ni réinscriptible ni reconfigurable : l'affecter échoue en silence et le clic ouvre le vrai sélecteur natif sur l'écran de l'utilisateur. Poser les signals de chemin du composant sans cliquer « Choisir » (cf. § Pilotage de l'interface) et fermer l'app par `taskkill` si un sélecteur natif est resté ouvert
- Échantillonner l'état d'un tooltip par des `Runtime.evaluate` espacés d'un `sleep` fixe fausse la mesure (latence de CDP, survol intermédiaire) : suivre une chronologie serrée depuis un seul point de survol
- Cliquer « Extraire » juste après avoir choisi un fichier part avant la réponse du listage : `canExtract` le refuse à raison, le bouton n'étant pas encore repeint. Attendre que le bouton repasse actif avant de cliquer
- Modifier un template pendant `just dev` recharge la page (sidecar en plus, état perdu) : arrêter l'app avant de corriger, puis relancer à froid
- `ng.getInjectorResolutionPath` et `ng.getInjectorProviders` n'existent pas sans le préfixe `ɵ` et la classe s'appelle `_SidecarService` en build de dev
- Les services passés de `@Injectable({ providedIn: "root" })` à `@Service()` restent visibles par `ɵgetInjectorProviders` : `__sidecarService()` les résout sans changement (relevé le 2026-10-09, Angular 22.2.1)
- `pButton` passe `outline-color` par une transition de 200ms : un focus relevé juste après Tab rend un anneau `rgba(0, 0, 0, 0)`. Attendre avant de conclure à un anneau invisible
- `browser_run_code_unsafe` avec `filename` répète le code du script dans sa réponse : au-delà d'environ 70 000 caractères, la sortie part dans un fichier de `tool-results` et le JSON du script en occupe la ligne 2 (`JSON.parse` de cette ligne seule)
- Un texte lu par `textContent.replace(/\s+/g, " ")` perd ses espaces insécables (`\s` les inclut) : pour vérifier celui d'avant un `:` français, ne remplacer que `[ \t\r\n]+`
- Les enfants d'un hôte en `display: contents` ne comptent pas parmi ceux de la colonne : pour mesurer les écarts d'une colonne flex, les aplatir, sinon la liste qu'il contient fait passer pour 110px un écart de 24px
- Une mesure de modale prise pendant son animation d'entrée (`animationName` à `p-animate-dialog-enter`) rend une largeur et un masque intermédiaires (509px, `rgba(0, 0, 0, 0.32)` pour la confirmation de sortie) : relire après `animationName` à `none`
- Une sonde `ng serve` qui fige la version de l'interface périme à chaque release : `versionMismatch` passe à non nul et l'écran bloquant tient la place des onglets, la sonde échouant sur un `waitForSelector` sans autre indice (relevé le 2026-10-12, `0.5.0` après la 0.6.0). La lire sur la page : une `version` quelconque, puis `svc.versionMismatch().ui`
- Les textes traduits portent des `\n` (une phrase par ligne, conteneurs en `whitespace-pre-line`) : `textContent` les garde, `innerText` les rend. Une regex sur un message tolère le `\n` (`réécrire\s*:\s*1`, ou `\n` explicite pour borner un compte) et ne finit plus sur un point ; `replace(/[ \t\r\n]+/g, " ")` les aplatit quand la mise en forme importe peu
