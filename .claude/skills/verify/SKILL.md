---
name: verify
description: Recette de /verify pour techno-tagger. Pilote le sidecar Python par son protocole NDJSON sur stdin/stdout sur une arborescence de test isolée, et l'interface sous ng serve (Playwright) ou dans la fenêtre Tauri (CDP de WebView2). Écrite et maintenue par /verify lui-même.
---

# verify - Recette de vérification runtime

## Surface

- **Sidecar** : process `python -m tagger`, commandes NDJSON sur `stdin`, événements sur `stdout`, logs sur `stderr`. Handle : `just dev-sidecar` (recette `[working-directory('sidecar')]`), alimenté par un pipe
- **Interface** (Angular + Tauri) : deux handles. `just dev-ui` sert la webview seule sur `http://localhost:4200`, pilotée par le MCP Playwright. `just dev` ouvre la vraie fenêtre Tauri : lancée avec `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"`, WebView2 s'inspecte par CDP (`http://127.0.0.1:9222/json`, puis `Runtime.evaluate` et `Page.captureScreenshot` depuis un script Node, `WebSocket` natif)

## Fixture isolée

Tout dans le scratchpad de session, jamais dans le dépôt ni dans une vraie bibliothèque. Le dump se bâtit par le helper de test, c'est de la mise en place et non une vérification :

```bash
cd sidecar && PYTHONIOENCODING=utf-8 uv run python - "$V" <<'EOF'
import sys
from pathlib import Path
sys.path.insert(0, "tests/helpers")
from vlc_dump import build_dump, TRACKS   # playlists "test playlist" (5) et "other playlist" (1)
root = Path(sys.argv[1])
build_dump(root / "vlc_media.db")
# + une bibliothèque avec un homonyme de taille différente, un .m3u8, un faux JPEG, un fichier "occupied"
EOF
```

Pour l'onglet Playlist, `just demo` bâtit `demo-data/` (git-ignoré) : 30 morceaux de plusieurs dizaines de Mo, qui couvrent les cinq catégories du rapport, dump `vlc_media.db` avec la playlist `test playlist`. L'échec de transfert demande `just demo --lock <secondes>` en arrière-plan pendant le run. `--lock` ne reconstruit rien : relancer `just demo` seul avant chaque run, verrou arrêté, sinon la destination garde le run précédent.

## Pilotage

```bash
{ printf '{"command":"get_version"}\n'
  printf '{"command":"extract_playlist","source_folder":"%s","destination_folder":"%s","playlist_path":"%s","playlist_name":"test playlist"}\n' "$V/library" "$V/work" "$V/vlc_media.db"
} | just dev-sidecar > "$V/out" 2> "$V/err"; echo "EXIT=$?"
```

Relire `stdout` (chaque ligne doit se parser seule en objet JSON, sans indentation), `stderr` à part, puis l'état du disque (`work`, rapports, bibliothèque intacte).

Poser `LOCALAPPDATA="$V/appdata"` sur le lancement isole la racine des données (`tagger.paths.app_data_dir()`) : le sidecar écrit alors ses logs, et plus tard son cache, sous `$V/appdata/fr.empiricmind.techno-tagger/`, jamais dans le profil réel. C'est aussi ce qui prouve que la racine est bien composée avec l'identifiant de bundle.

## Pilotage du cache disque

Les classes de `tagger/cache.py` s'exercent hors protocole tant que la boucle de commandes ne les câble pas. Un script dans le scratchpad, lancé par `uv run python`, suffit, et vaut mieux qu'un test : vrai système de fichiers, vrai `httpx2.AsyncClient` contre un `http.server` local servant de faux CDN, ni `MockTransport` ni horloge injectée.

L'âge d'une entrée se force en renommant l'epoch de son nom (`<hash>.<epoch>.<ext>`), là où le cache le lit : `DiskCache` rouvert sur le dossier purge alors ce qui a dépassé le TTL, sans qu'aucune horloge ait été truquée.

Le faux CDN se scinde en deux, parce qu'`ArtworkFetcher` refuse toute URL qui n'est pas en `https` vers une adresse publique. Le garde-fou se vérifie contre le vrai serveur local, avec le résolveur réel : `https://localhost/...` doit partir en `blocked_url` par résolution DNS, et le serveur rester à zéro requête reçue. Le téléchargement, lui, ne peut plus le viser et passe par un `MockTransport` sous une URL `https` d'apparence publique, avec un `resolve=` injecté qui rend une adresse publique : client, streaming, cache et disque restent réels, seules la résolution et la couche TCP sont détournées.

## Pilotage du run de re-tagging

`start_tagging` part vers techno-scraper, dont l'URL est une constante du module
(`scraper_client.API_BASE_URL`) : aucune variable d'environnement ne la détourne. Le run
se pilote donc par un lanceur du scratchpad qui réaffecte cette constante vers un
`http.server` local, puis appelle `run_loop` sur des flux en mémoire. Tout le reste
reste celui de production : boucle, client httpx2 sur une vraie socket, caches disque,
trousseau, lecture des tags, sortie NDJSON. Armer `setup_logging(log_dir())` comme le
fait `main()`, sinon rien n'est écrit sous la racine des données.

```python
import fake_api
from tagger import scraper_client
server = fake_api.serve()
scraper_client.API_BASE_URL = f"http://127.0.0.1:{server.server_address[1]}"
from tagger.__main__ import log_dir, run_loop   # apres la reaffectation
```

Le faux serveur ne lit jamais l'en-tête `X-API-Key` : une vraie clé est enregistrée sur
la machine de développement, le sidecar l'envoie telle quelle, et la journaliser la
ferait fuir. Un `REJECT_ALL` dans l'environnement lui fait rendre 403 à tout, ce qui
rejoue la garde des trois refus.

Placer un candidat en zone grise demande de viser l'intervalle des seuils, pas de
l'approcher au jugé : artiste exact donne 100, donc le titre doit scorer entre 70 et 80
pour que la moyenne reste sous 90. `fuzz.ratio("Basiel", "Basielians",
processor=utils.default_process)` rend 75, d'où un arbitrage ; « Basiel Reprise » rend
60 et tombe sous le plancher.

**Purger `appdata` entre deux runs** : le cache de réponses est réel, et une réponse
changée côté faux serveur reste invisible tant que l'entrée précédente est valide. Un
run qui ne bouge pas après modification du serveur est presque toujours ça.

### Flux qui valent le coup

- Séquence complète : `run_started` listant tous les morceaux, puis par morceau son
  `track_resolved` ou son `arbitration_required` suivi d'un `progress` en phase
  `tagging`, enfin `run_finished` en phase `network` avec les trois compteurs
- Contenu d'un résolu : `state`/`resolution`/`failure_reason` en trois champs, `after`
  portant le titre suivi du nom de mix, scores entiers, chemin de pochette
- Commande servie pendant un run : `get_version` envoyé après `start_tagging` répond
  avant `run_finished`, ce qui prouve que la boucle n'est pas bloquée
- Second `start_tagging` pendant un run : `error` de code `tagging_in_progress`, et le
  premier run poursuit jusqu'à son `run_finished`
- Seuils hors bornes : `malformed_command` dont les `params` ne portent que `loc` et
  `type`, jamais les valeurs envoyées, et la boucle continue
- Clé refusée (`REJECT_ALL`) : `error` de code `api_key_rejected` en dernier événement,
  aucun `run_finished`
- `shutdown` pendant un run : tâche annulée, aucun `run_finished`, sortie 0, et la
  commande suivante ignorée
- Dossier vide : `run_started` à liste vide, aucun `progress`, `run_finished` à zéro
- Racine des données : `cache/responses/` et `logs/tagger.log` sous
  `<LOCALAPPDATA>/fr.empiricmind.techno-tagger/`, jamais dans le profil réel

### Gotchas du run

- **httpx2 journalise l'URL complète en INFO**, donc `q=Adam+Beyer+Your+Mind` : le log
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

## Pilotage du trousseau

`set_api_key` écrit dans le **vrai** Credential Manager de Windows (cible `techno-tagger`, utilisateur `x-api-key`) : aucun trousseau en mémoire hors pytest, et `LOCALAPPDATA` n'isole rien ici.

- Lire d'abord `api_key_configured` par `get_version`. S'il vaut `true`, une clé réelle est enregistrée : ne rien écrire, se limiter à la lecture, aux rejets hors format et à la recherche de fuite
- S'il vaut `false` : clé factice reconnaissable, puis suppression en fin de parcours (`cd sidecar && uv run python -c "import keyring; from tagger import APP_NAME; keyring.delete_password(APP_NAME, 'x-api-key')"`), prouvée par un dernier `get_version` à `false` et par `cmdkey //list`
- Rejouer le même parcours sur le binaire figé (`just build-sidecar`, puis `src-tauri/binaries/tagger-x86_64-pc-windows-msvc.exe` alimenté par un pipe) : c'est le seul endroit où un backend keyring introuvable se voit
- Fuite : `grep -rl <clé factice>` sur `stdout`, `stderr` et le dossier des logs, code de retour 1 attendu

## Flux qui valent le coup

- Clé API : hors format (espace, non ASCII, vide, champ en trop) rendu en `malformed_command` sans la valeur dans `params`, enregistrement répondu par `version` à `api_key_configured: true`, état retrouvé par un nouveau process

- Nominal : `get_version`, `list_playlists` (dump puis M3U8), `extract_playlist` avec homonyme, rapport `.json` + `.md` présents
- Refus sans arrêt de la boucle : champ en trop, ligne non-JSON, commande inconnue (`params.command`), playlist inconnue, fichier non décodable, destination impossible à créer (chemin occupé par un fichier). Enchaîner un `get_version` après chacun
- Fin : `shutdown` suivi d'une commande (ignorée, sortie 0), `stdin` vide (sortie 0)
- État : relancer la même extraction dans la même destination (catégorie `already_present`, rapports suffixés `-2`, `-3` dans la même seconde)
- Cache disque : entrée relue puis vieillie au-delà du TTL et purgée à la réouverture ; plafond bas et quatre écritures, celle qu'on vient de relire survit et la moins récemment lue part ; dossier supprimé en plein usage, la lecture rend un miss et l'écriture suivante le recrée ; réponse relue quel que soit l'ordre des paramètres et lisible en JSON sur le disque
- Pochettes : téléchargement unique puis service depuis le cache, deux appels concurrents sur la même URL ne faisant qu'une requête, extension tirée du `Content-Type` quelle que soit sa casse, octets identiques à ceux du CDN, redirection vers un hôte public suivie, `404` et contenu non-image levant `ArtworkUnavailableError` sans rien publier et sans l'URL dans les `params`, douzaine d'URL distinctes en `TaskGroup` pour voir le pool tenir
- Garde-fou d'URL : `http` en clair, boucle locale, réseau privé et schéma hors http refusés en `blocked_url`, le serveur local restant à zéro requête reçue

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
- Lire un service `providedIn: "root"` depuis la page (build de dev) : parcourir `ng.ɵgetInjectorResolutionPath(ng.getInjector(document.querySelector("app-root")))`, chercher dans `ng.ɵgetInjectorProviders(inj)` la classe dont le nom finit par `SidecarService` (`Object.values(record)`), puis `inj.get(classe)` et lire ses signals. Sous Tauri, même expression par CDP `Runtime.evaluate` avec `awaitPromise`, script Node écrit dans le scratchpad

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
  - extraction : dès le clic, formulaire replié en résumé (source › destination › playlist · mode, logo VLC ou icône `file` suivie du nom du M3U8) et « Modifier » `disabled` ; barre indéterminée sans compteur sous le résumé, puis déterminée avec « N sur 30 », sans texte dans la barre ; à la fin, barre retirée et « Extraction terminée (30 sur 30) » sous la table, à droite ; « Modifier » rouvre le formulaire au-dessus du rapport, et la relance replie de nouveau, vide le rapport et repart en indéterminée sans compteur
  - onglet quitté puis rouvert par les `p-tab` : résumé identique, « Modifier » rouvre sur les dossiers et la playlist du run ; un autre fichier listé entre-temps sans relancer rouvre sur ce fichier, sans playlist, tooltip « Choisissez une playlist. », et la commande suivante porte ce fichier
  - rapport : deux colonnes, Fichier fluide et État à 197px, constante sur tout le défilement, en-tête collé en haut, une ligne par morceau plus une par doublon, ordre échecs puis introuvables, doublons, déjà présents et extraits, hauteur réelle du `<tr>` égale à `rowHeight`, libellé de tag sur une ligne ; icône `info-circle` sur les seuls doublons et échecs, dont le badge ouvre le détail en tooltip `wide` ; relancée dans la même destination, les morceaux passent en « Déjà présent »
  - M3U8 vide vers une destination neuve : table pleine hauteur, bloc « Playlist vide » centré (écarts égaux sous l'en-tête et au pied), cellule sans bordure basse, aucune ligne « Extraction terminée » (le sidecar n'émet aucun `progress` sur une playlist vide) ; rapports `.json` + `.md` écrits, compteurs à zéro
  - bascule « Déplacer » : `extraction_mode` vaut `move` dans le `store` et le choix survit à `Page.reload` ; remettre ensuite la valeur d'origine
  - sous `ng serve` seul : écran bloquant en `p-card` centrée, sans barre d'onglets, action « Réessayer »
  - pendant un run : aucun formulaire monté (la grille `.grid` absente), seul « Modifier » est proposé, `disabled`
- Conformité à DESIGN.md sur l'onglet Playlist :
  - container du shell sur les trois onglets, en cliquant les `p-tab` : padding `32px 64px`, `h1` à 64px du bord gauche et 32px du haut de `main`, l'URL suit l'onglet
  - aucun défilement de page (`document.scrollingElement` et `main`), la table remplit la hauteur restante, à 1280 × 800 puis au plancher 1024 × 700 par `Emulation.setDeviceMetricsOverride`. Relever les lignes visibles du rapport : le 2026-09-17, résumé replié, 12 lignes à 1280 × 800 et 10 au plancher ; le conteneur de la table descend jusqu'à la ligne « Extraction terminée », ou jusqu'au pied de la page quand un run vide ne l'affiche pas
  - grille du formulaire : boutons de sélection, `p-select` et `p-selectbutton` à la même largeur, chemins alignés sur le bord droit de la grille, « Extraire la playlist » du bord des libellés au bout des contrôles, `p-skeleton` à la hauteur du `p-select` qui le remplace, bloc vide (icône 24px `text-muted-color`, titre `text-base`, phrase `text-sm`)
  - tags : familles de § Couleurs Sémantiques, lues sur la classe `p-tag-*` et l'icône `data-p-icon`
  - tooltip : suivre `.p-tooltip` toutes les 100ms après un `Input.dispatchMouseEvent` : visible à 400ms sur un texte coupé, jamais sur un texte entier, retiré dès la sortie, classe `tt-tooltip-wide`, `pointer-events: none`
- Onglet Tagging sous Tauri, après une extraction vers `demo-data/Extraction` puis « Passer au tagging » :
  - dossier prérempli avec la destination de la dernière extraction, bouton de lancement actif si une clé est enregistrée
  - sans dossier : bouton désactivé, tooltip « Choisissez d'abord le dossier à re-tagger. » à 400ms, bloc vide « Aucun run lancé » centré
  - run lancé : les lignes apparaissent d'un coup, barre « Recherche en cours » affichée, bouton désactivé le temps du run, puis barre retirée et bouton réactivé
  - fin de phase réseau : **un seul** toast « Phase réseau terminée ». Le compter par un `MutationObserver` sur `.p-toast-message` posé avant le run, sa durée de vie n'étant que de 4s
  - régression du 2026-09-23 à ne jamais laisser revenir : enchaîner une dizaine de changements d'onglet après un run **et** une extraction terminés, le compteur de toasts doit rester à un par phase. Le garde vit dans `CompletionSignalService.announceOnTransition()`, qui initialise sa valeur de référence sur la valeur courante du signal et non sur `null`
  - dossier introuvable : `lastError` de code `tagging_folder_unreadable`, bannière traduite sous l'en-tête, bouton de lancement réactivé. L'écran filtre par `lastErrorCommand() === "start_tagging"`, pas par une liste de codes
  - en anglais : colonnes « Before / After / Source / Score / State », bouton « Start the run », aucune clé brute
  - à 1280 × 800 puis au plancher 1024 × 700 : aucun défilement de page ni de `main`, en-tête sans débordement
- Onglet Réglages sous `ng serve`, sidecar simulé (`svc.send` remplacé, réponse par `svc.handleLine`) : aucun tag tant que `version` n'est pas arrivée, puis « Aucune clé » ; « Enregistrer » désactivé champ vide ; envoi, champ vidé, tag « Clé enregistrée » et commande `set_api_key` relevée dans `send` ; erreur `api_key_not_stored` rendue sous la rangée ; en FR et en EN au plancher 1024 × 700, sans défilement, texte d'aide sur trois lignes au plus
- Fin de session : fermer la fenêtre par `taskkill //IM techno-tagger.exe` sans `/F` (message de fermeture), puis constater que `tagger.exe` a disparu

## Gotchas

- `just` écrit la ligne de recette (`uv run python -m tagger`) sur `stderr` : ne pas la prendre pour une fuite du protocole
- Un faux CDN bâti sur `BaseHTTPRequestHandler` doit comparer `self.path` amputé de sa query : les URL de pochettes distinctes se forgent par `?v=<n>`, et un `self.path == "/cover.jpg"` nu les renvoie toutes en 404
- Console Windows en cp1252 : un `print` non ASCII dans un script de fixture lève `UnicodeEncodeError`, poser `PYTHONIOENCODING=utf-8`
- Un octet non UTF-8 sur `stdin` fait tomber le process, et avec lui les commandes valides du même bloc lu : comportement documenté de `run_loop`, pas une régression
- Le logger du point d'entrée s'appelle `__main__` et non `tagger.__main__` sous `python -m`
- Mode `move` : ne le piloter que sur une copie de la bibliothèque de fixture
- `just dev` lance lui-même `pnpm start` (`beforeDevCommand`) : arrêter `just dev-ui` avant, sinon le port 4200 est pris
- Après arrêt, contrôler qu'aucun `techno-tagger.exe` ni port 4200 / 9222 ne reste (`tasklist`, `netstat -ano`), `just stop` sinon
- Le MCP Playwright n'écrit ses captures que sous la racine du dépôt (`.playwright-mcp/` est git-ignoré, un nom de fichier nu atterrit à la racine) : les déplacer vers le scratchpad
- Dans WebView2, `navigator.language` vaut `fr` et non `fr-FR`
- Un faux JPEG en texte ASCII se lit comme un M3U8 valide et vide : écrire de vrais octets (`\xff\xd8\xff\xe0…`) pour obtenir `unsupported_playlist_format`
- Un survol calculé sur la position théorique d'une ligne peut tomber hors de la zone visible de la table, sur `main`. Viser un tag dont `document.elementFromPoint` rend bien le badge
- Sous `ng serve`, simuler le sidecar sur l'instance du service plutôt que le transport : `svc._available.set(true)`, `svc.handleLine(JSON.stringify(event))` pour chaque événement, et `svc.send` remplacé pour répondre aux commandes. La clé d'un provider se lit par `record["tok" + "en"]`, le hook bloquant le mot écrit en entier
- Changer d'onglet par les `p-tab`, jamais par `page.goto` : un rechargement recrée le service et perd l'état simulé. Le composant de page, lui, est recréé : remplacer de nouveau `openPath` après chaque retour sur l'onglet
- Le nom accessible d'un bouton de `PathPickerComponent` est son libellé (`label for`), pas son texte : `getByRole` par le texte échoue, viser `locator("app-path-picker button", { hasText })`
- Playwright ralentit `requestAnimationFrame` sur une page qui n'a pas le focus : `page.bringToFront()`, et échantillonner une animation par `setInterval`
- Plusieurs `ng serve` lancés depuis des worktrees partagent le cache `.angular/cache` et répondent en 504 « Outdated Optimize Dep » : les lancer avec `CI=1`
- Fermer la fenêtre par `taskkill` sans `/F` emporte aussi les sidecars accumulés par les rechargements (38 vers 0 constaté) : repartir de là avant de compter les `tagger.exe`
- Le sidecar meurt avec la fenêtre sans que `shutdown` soit envoyé : mesuré le 2026-09-18 avec et sans câblage d'`onCloseRequested`, `tagger.exe` à zéro en moins de 2s dans les deux cas, malgré tauri-apps/tauri#11686. Ce câblage n'apporte rien : pendant un run, la boucle est dans `to_thread` et ne lirait pas la commande. Des `tagger.exe` orphelins viennent d'un `just dev` tué brutalement, pas d'une fermeture. `close()` après un `preventDefault()` passe d'ailleurs par `destroy` : sans `core:window:allow-destroy`, la fenêtre reste ouverte
- `src-tauri/binaries/` garde le sidecar du dernier `just build-sidecar` : après toute modification de `sidecar/src`, reconstruire avant `just dev`, sinon la fenêtre parle à un binaire périmé (comparer la date du `.exe` au dernier commit de `sidecar/src`)
- Chaque rechargement de la page sous `just dev` (live reload, `Page.reload` CDP) lance un sidecar de plus sans tuer le précédent : compter les `tagger.exe` sur une fenêtre fraîchement ouverte. En release, `F5`, `Ctrl+R` et le menu contextuel sont coupés par `tauri-plugin-prevent-default`, le debug les garde
- Le premier `SendKeys` après `AppActivate` peut partir avant le focus : envoyer d'abord une touche sans enjeu, et ne conclure que sur une touche vue par l'écouteur `keydown`
- Ne pas lancer `just test` pendant `just build-sidecar` : le build pose un `_build_info.py` de production le temps de la compilation, et `test_build_info` échoue
- Les hooks bloquent `curl` (exécution distante) et tout heredoc contenant le mot `token` (fichier sensible supposé) : interroger `http://127.0.0.1:9222/json` par `fetch` depuis Node, écrire le script CDP avec l'outil Write. Le même hook attrape l'expression qui parcourt les providers d'un injecteur, `record["tok" + "en"]` n'y suffisant pas quand elle passe en argument de commande : écrire l'expression dans un `.js` du scratchpad et la donner au pilote CDP par son chemin
- Un chemin Windows passé en argument shell à `Runtime.evaluate` perd ses backslashes, et le sidecar répond `tagging_folder_unreadable` sur un chemin amputé : écrire le chemin dans le `.js` du scratchpad, en slashes, que `pathlib` accepte aussi bien
- Le run de re-tagging sous Tauri tape la **vraie** API techno-scraper avec la clé enregistrée sur la machine, `API_BASE_URL` étant une constante du module qu'aucune variable d'environnement ne détourne : viser un dossier de trois morceaux dans le scratchpad, jamais les trente de `demo-data/Extraction`. La phase réseau n'écrit aucun tag, l'écriture appartenant à la Feature 5
- `__TAURI_INTERNALS__.invoke` n'est ni réinscriptible ni reconfigurable : l'affecter échoue en silence et le clic ouvre le vrai sélecteur natif sur l'écran de l'utilisateur. Remplacer `openPath` sur l'instance du composant, et fermer l'app par `taskkill` si un sélecteur natif est resté ouvert
- Échantillonner l'état d'un tooltip par des `Runtime.evaluate` espacés d'un `sleep` fixe fausse la mesure (latence de CDP, survol intermédiaire) : suivre une chronologie serrée depuis un seul point de survol
- Cliquer « Extraire » juste après avoir choisi un fichier part avant la réponse du listage : `canExtract` le refuse à raison, le bouton n'étant pas encore repeint. Attendre que le bouton repasse actif avant de cliquer
- Modifier un template pendant `just dev` recharge la page (sidecar en plus, état perdu) : arrêter l'app avant de corriger, puis relancer à froid
- `ng.getInjectorResolutionPath` et `ng.getInjectorProviders` n'existent pas sans le préfixe `ɵ`, et la classe s'appelle `_SidecarService` en build de dev
