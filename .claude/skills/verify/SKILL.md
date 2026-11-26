---
name: verify
description: Recette de /verify pour techno-tagger. Pilote la fenêtre Tauri par CDP de WebView2, la démo web dans un navigateur et le sidecar Python par son protocole NDJSON. À lancer avant chaque commit qui touche du code exécutable.
argument-hint: [complet]
allowed-tools: Bash(just dev-demo), Bash(just verify extraction), Bash(just verify engine), Bash(just verify window), Bash(just verify window-single-instance), Bash(just verify window-controls), Bash(just verify window-cache), Bash(just verify window-past-runs), Bash(just verify window-rollback), Bash(just verify window-resume), Bash(just verify demo), Bash(just verify demo-choices), Bash(just verify demo-order), Bash(just verify demo-restart), Bash(just verify demo-language), Bash(just verify demo-settings), Bash(just verify-all), mcp__plugin_playwright_playwright__*
---

# verify - Recette de techno-tagger

## Principes

Repris du `/verify` intégré de Claude Code 2.1.318, relevé le 2026-11-24.

- Vérifier, c'est observer l'app lancée : la lancer, l'amener là où le code modifié s'exécute, capturer ce qu'elle rend. Ni tests, ni typecheck, ni import d'un module interne suivi d'un appel
- Périmètre : le diff complet, commits de la branche et working tree (`git diff @{u}..`, `git diff origin/HEAD...`, `git diff HEAD`), ou ce que l'appelant nomme. Dire le nombre de commits. Sans diff ni périmètre nommé, le dire et s'arrêter
- Le diff fait foi, toute description est une affirmation à son sujet : un écart entre les deux est un constat
- La surface est l'endroit où l'utilisateur, humain ou programme, rencontre le changement. Une fonction interne n'en est pas une : suivre son appelant jusqu'à la fenêtre, l'écran ou la commande du protocole qui l'atteint
- Sans surface exécutable (doc, types, configuration sans effet, tests seuls) : SKIP en une ligne. Diff mixte : vérifier le code, ignorer les tests. Lire un test pour savoir quoi contrôler reste permis
- Jouer le plus petit chemin qui exécute le code modifié, de bout en bout par l'interface réelle : si l'utilisateur clique, cliquer, pas appeler l'action sous l'écran
- Relire son plan avant de lancer : s'il ne contient que build, typecheck et tests, il ne vérifie rien. Trouver une étape qui atteint la surface ou rendre BLOCKED
- Le changement confirmé, sonder autour à la même surface : champ vide, valeur trop longue, ligne hors protocole, action faite deux fois, état périmé, erreurs voisines de celle du diff
- Capturer ce que l'app renvoie, la mémoire n'est pas une preuve. Un comportement inattendu se capture puis s'attribue au changement ou à l'environnement, il ne se contourne pas. Une casse sans rapport est un constat
- Isoler l'état partagé avec le poste : ports, fichiers temporaires, sessions
- Chemin qui supprime, publie, envoie ou écrit hors du dépôt, sans dry-run ni cible sûre : ne pas le jouer, vérifier autour, dire ce qui n'a pas été joué

## Modes

| Mode | Quand | Ce qui se joue |
|------|-------|----------------|
| Diff (défaut) | avant chaque commit de code | les flux dont la zone croise le diff, pilotés en direct, puis des sondes autour du changement |
| Complet (argument `complet`) | fin de feature, avant une mise en production | `just verify-all`, puis en direct les flux de la feature qu'aucun scénario ne couvre |

Les scénarios de `verify-all` pilotent l'app lancée de l'extérieur. Ce ne sont pas les tests du dépôt, que cette recette ne lance jamais.

## Lancer

```bash
just dev-demo                                                                          # démo web sur le port 4200, en background
LOCALAPPDATA="$(mktemp -d)" WEBVIEW2_USER_DATA_FOLDER="$(mktemp -d)" WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" SENTRY_DSN_UI= TECHNO_TAGGER_SENTRY_SELFTEST= just dev   # fenêtre Tauri, en background
LOCALAPPDATA="$(mktemp -d)" TECHNO_TAGGER_SENTRY_SELFTEST= just dev-sidecar            # sidecar, alimenté par un pipe (cf. Piloter), demande une autorisation
```

- **Prérequis** : `just check` sort vide. Le binaire de `src-tauri/binaries/` doit dater de la version courante : `SENTRY_DSN_SIDECAR= just build-sidecar` après un changement de `sidecar/src` ou de version, DSN vide pour qu'aucun crash ne parte vers la production
- **Prêt quand** : démo, `http://localhost:4200/demo/scenario.json` répond 200. Fenêtre, une page `type: page` listée sur `http://127.0.0.1:9222/json`, trois `p-tab` à l'écran, puis la première ligne du journal du sidecar. Sidecar, la réponse à `get_version`
- **Arrêt** : `taskkill //PID <pid> //T //F` sur le PID lancé (pas la croix de la fenêtre : cf. `preferences.json`), puis vérifier qu'aucun `techno-tagger.exe`, `tagger.exe` ni `ng serve` ne reste. Jamais `just stop` ni `just stop-app`, qui tuent par nom d'image, instance personnelle comprise, ni `just stop-ui`, qui tue ce qui écoute sur 4200 quel qu'en soit le propriétaire
- **Isolation** : `LOCALAPPDATA` jetable pour le sidecar (logs, plans, dumps, cache), `WEBVIEW2_USER_DATA_FOLDER` jetable pour le profil de la webview, navigateur vierge, arborescence de test dans un dossier temporaire. Les scénarios lancent eux-mêmes ce dont ils ont besoin, sur des ports libres : `extraction` et `engine` leur process sidecar, les `window*` leur fenêtre par `tauri dev`, les `demo*` leur serveur de dev (`DEMO_URL` vise un serveur déjà lancé, une image ou l'URL publique)
- **Lancer en background** `just verify-all` et les `window*` : la compilation de Tauri peut durer 25 minutes, plus que le délai d'un appel. Un Ctrl+C ou un SIGTERM fait nettoyer ce que le scénario a lancé ; un arrêt forcé du process (délai dépassé, `taskkill /F`) ne le peut pas, cf. Pièges

## Piloter

Trois surfaces, dans la même application. La fenêtre est le produit livré. La démo web rejoue ses réponses enregistrées dans un navigateur, sans Tauri ni sidecar. Le sidecar est le moteur, que la fenêtre lance et que le protocole NDJSON pilote.

### Fenêtre

Pilotée par CDP de WebView2 : `scripts/cdp.mjs` évalue un script de page, capture, clique, tape une touche, glisse. `CDP_PORT` change le port de débogage.

```bash
node .claude/skills/verify/scripts/cdp.mjs .claude/skills/verify/scripts/page/app-health.js state
node .claude/skills/verify/scripts/cdp.mjs --click 640 400
node .claude/skills/verify/scripts/cdp.mjs --screenshot "$TMP/fenetre.png"
```

- La mécanique de lancement, de branchement et d'arrêt par PID vit dans `scripts/_common.mjs` (`launchWindow`, `openAppWindow`, `stopWindow`), le verdict et le nettoyage d'un scénario dans `scripts/report.mjs`
- Réglages > Administration (menu, rang 3) : cache, « Annuler le dernier run », runs passés et version se jouent sans effet sur un dossier de données jetable (cf. Effets et limites)
- **Évidence** : capture de la fenêtre et état lu dans la page, ligne de `$LOCALAPPDATA/fr.empiricmind.techno-tagger/logs/tagger.log` du sidecar
- Ne cliquer ni « Choisir » (sélecteur natif du poste), ni « Installer » (installe sur le poste), ni « Envoyer ce rapport », ni « Enregistrer » de la clé API (écrit dans le vrai trousseau), ni le lien d'un morceau (`open-source`, ouvre le navigateur du poste), ni « Ouvrir les logs » (`reveal-logs`, ouvre l'Explorateur), ni la croix de la fenêtre

### Webview seule ou démo web

Navigateur piloté par le MCP Playwright, sur `just dev-demo` (démo) ou `just dev-ui` (webview sans Tauri : dialogues, store et sidecar échouent, `[sidecar] lancement impossible` en console est attendu).

1. Ouvrir `http://localhost:4200/?lang=fr` (ou `en`), attendre les onglets
2. Cliquer les trois « Choisir » : la démo pose les chemins de son scénario, sans sélecteur natif
3. Agir sur l'écran que le diff touche, capturer, relever les erreurs de console

- **Écrans** : 1280 × 800, plancher 1024 × 700, français et anglais, états de l'écran touché (vide, en cours, refus, grisé avec sa raison)
- **Diff visuel** : mesurer (`getComputedStyle`, `getBoundingClientRect`) et comparer à `docs/DESIGN.md`. Tout écart est un constat, jamais corrigé en silence

### Sidecar en ligne de commande

```bash
export LOCALAPPDATA="$(mktemp -d)" TECHNO_TAGGER_SENTRY_SELFTEST=
printf '%s\n' '{"command":"get_version"}' '{"command":"get_cache_size"}' | just dev-sidecar
```

Une commande JSON par ligne sur stdin, un événement JSON par ligne sur stdout, logs sur stderr. Le détail des commandes est dans `sidecar/src/tagger/protocol.py`.

- Le dump VLC, les fichiers de musique et le M3U8 d'essai se bâtissent par `buildLibrary` de `scripts/_common.mjs`, jamais depuis une vraie bibliothèque
- Toute commande sort sous la forme d'un `error` portant `code` et `command` quand elle est refusée, la boucle continue
- **Évidence** : stdout relu ligne à ligne, stderr à part, code de sortie, état du disque (destination, rapports, source)

## Effets et limites

- **Le run de re-tagging réel ne se joue pas** : `start_tagging`, le rattrapage par URL et les pochettes appellent le techno-scraper de production, dont l'URL est une constante du sidecar qu'aucune variable ne détourne, avec la clé du Credential Manager réel et le quota Bandcamp (cf. `docs/knowledges/techno-scraper.md`). `resume_run` (la reprise rappelle l'API) et `commit_run` (il suppose un run) ne se jouent pas non plus. Cible sûre : la démo web rejoue tout l'écran, le sidecar et la fenêtre se pilotent par leurs commandes hors réseau
- **Aucun fichier audio réel** : `rollback` et l'extraction en mode `move` réécrivent, renomment ou déplacent des fichiers. Seule une arborescence jetable, bâtie dans un dossier temporaire et supprimée en fin de scénario, les reçoit
- **État de départ fabriqué** : un run passé, un run interrompu et un run annulable n'ont pas de vrai run derrière eux (il appellerait l'API de production). `window-past-runs`, `window-resume` et `window-rollback` écrivent le rapport, le plan et le dump au format du sidecar (`plantPastRun`, `plantInterruptedRun`, `plantWrittenRun` de `_common.mjs`), dans le dossier de données jetable. Un format qui change fait échouer le scénario en clair (`extra="forbid"`) : réaligner la primitive, pas le sidecar
- **Trousseau** : `get_version` lit le vrai Credential Manager (lecture seule), `set_api_key` y écrit et ne se joue pas. `just dev-sidecar` lancé à la main n'est pas dans `allowed-tools` : le canal accepte aussi `start_tagging` (API de production, vraie clé) et `set_api_key`
- **Données du sidecar** : sous `LOCALAPPDATA`, que le sidecar purge à chaque démarrage (dumps et plans de plus de 30 jours). Un vrai profil y perdrait ses dumps de rollback : toujours un dossier jetable
- **`preferences.json`** (`%APPDATA%/fr.empiricmind.techno-tagger/`) n'est pas isolable : Tauri le résout par l'API Windows, pas par une variable. Langue, signal sonore, seuils, mode d'extraction et dernière destination l'écrivent : aucun de ces gestes dans la fenêtre. La démo web écrit son `localStorage` seulement. Le plugin store le réécrit aussi à la sortie propre de l'app (date modifiée, relevé le 2026-11-25 sur un seul passage) : chaque `window*` arrête l'app par PID et vérifie que le fichier reste identique. Au lancement, l'app le réécrit aussi (`update_attempt` remis à `null`, `src/app/core/platform/update.service.ts`) quand une tentative de mise à jour y est en attente : la garde par empreinte ne le constate qu'après coup, fichier déjà réécrit
- **Profil WebView2** : Tauri le place sous le vrai `LOCALAPPDATA` par l'API Windows, que la variable ne détourne pas. `WEBVIEW2_USER_DATA_FOLDER`, qui prime sur lui, le déplace dans le dossier jetable (les `window*` la posent). Ne pas lancer la fenêtre pendant que l'instance personnelle tourne : elle est en instance unique, un second lancement lui donne le focus
- **Sentry** : le binaire du sidecar embarque le DSN de production si `SENTRY_DSN_SIDECAR` était rempli au build, `just dev` charge `SENTRY_DSN_UI` du `.env`. Reconstruire avec le DSN vide, lancer avec `SENTRY_DSN_UI=` vide, ne provoquer aucune erreur volontaire. L'envoi du self-test ne se joue pas : `TECHNO_TAGGER_SENTRY_SELFTEST=1` hérité du shell ferait envoyer un événement par le sidecar et la webview, d'où `TECHNO_TAGGER_SENTRY_SELFTEST=` vide à chaque lancement à la main (les scénarios le posent)
- **Mise à jour** : chaque ouverture de fenêtre interroge `latest.json` sur GitHub (lecture seule). L'invite propose une vraie installation : la fermer, jamais « Installer »
- **« Envoyer ce rapport »** ouvre le navigateur et l'Explorateur du poste : ne se clique pas
- **Sélecteurs natifs** : « Choisir » ouvre le vrai sélecteur sur l'écran de l'utilisateur, `__TAURI_INTERNALS__.invoke` n'est pas réinscriptible. Extraction et tagging dans la fenêtre ne se jouent donc pas par le vrai geste ; la garde de fermeture avec un travail en cours non plus
- **Gestes sans scénario** : « Restaurer ce morceau » (`restore-track`) n'existe que sur un run vivant, qui appelle l'API de production, et la démo le grise (`DISABLED_TIP`) : elle n'enregistre que la restauration du run entier. Dans la démo aussi, seuils et clé API sont verrouillés, et le mode « déplacer » n'a pas de réponse enregistrée (`commande hors scenario`). Langue et signal sonore s'y jouent (`demo-settings`)
- **Ports** : `just dev` fixe `devUrl` sur 4200, souvent tenu par un autre projet Angular : la fenêtre afficherait alors ce projet. Les scénarios prennent un port libre
- `just build-sidecar` écrit `sidecar/src/tagger/_build_info.py` (DSN) le temps du build puis le retire : `just check` le signale s'il reste
- `just verify-all` prend plusieurs dizaines de minutes (compilation Rust des `window*` sur un dépôt neuf, un `ng serve` par scénario), jamais deux passages à la fois : les `window*` tiennent l'instance unique

## Flux par zone

| Zone du diff | Flux à piloter | Scénario `verify-all` |
|--------------|----------------|-----------------------|
| `src/app/features/playlist/`, `sidecar/src/tagger/playlists/`, `sidecar/src/tagger/reports/extraction.py`, `reports/common.py` | Sidecar : lister un dump VLC et un M3U8, extraire en copie puis en déplacement : morceaux en destination, rapports `.json` et `.md`, homonyme départagé, source intacte en copie. Démo : choisir les chemins, extraire : rapport affiché | `extraction`, `demo` |
| `src/app/features/tagging/` (hors `recap`), `sidecar/src/tagger/resolution/`, `run/` (hors `plan`, `resume`, `rollback`), `sidecar/src/tagger/translation.py`, `src/app/core/stores/` (hors `past-runs`, `resume`) | Démo : lancer le run, arbitrer, rattraper par URL, confirmer, écrire, relancer l'écriture, ouvrir le récapitulatif, restaurer. Le run réel ne se joue pas | `demo`, `demo-choices`, `demo-order`, `demo-restart` |
| `sidecar/src/tagger/run/plan.py`, `run/resume.py`, `src/app/shared/components/dialogs/resume-dialog*`, `src/app/core/stores/resume.store.ts` | Fenêtre : un run interrompu fait ouvrir l'invite de reprise au lancement, « Repartir de zéro » la ferme et supprime le plan. « Reprendre » ne se joue pas | `window-resume` |
| `sidecar/src/tagger/run/rollback.py`, `tags/` | Fenêtre : Réglages > Administration propose le dernier run annulable, « Annuler le dernier run » rend aux fichiers leur nom et leurs tags d'origine | `window-rollback` |
| `sidecar/src/tagger/reports/tagging.py`, `reports/index.py`, `reports/common.py`, `reports/feedback.py`, `src/app/features/tagging/recap/`, `src/app/core/stores/past-runs.store.ts` | Fenêtre : Réglages > Administration propose les runs passés, « Ouvrir » affiche le récapitulatif du run, sans rien écrire. « Envoyer ce rapport » ne se joue pas | `window-past-runs` |
| `src/app/features/settings/`, `sidecar/src/tagger/core/`, `__main__.py`, `handlers.py`, `protocol.py` | Fenêtre : Réglages > Administration mesure le cache puis le vide, les plans restent. Sidecar : version, seuils par défaut et fichier de logs annoncés, refus sans arrêt de la boucle, sortie en 0 (une commande modifiée : rejouer aussi le flux qui l'émet). Démo : Réglages ouverts pendant un run, langue et signal sonore changés puis retrouvés au rechargement | `window-cache`, `engine`, `demo`, `demo-settings` |
| `src/app/core/` (`sidecar`, `platform`, `i18n`, `observability`), `src/app/shared/`, `src/app/app.component.*`, `src/app/app.config.ts`, `src/app/app.routes.ts`, `src/main.ts`, `src/index.html`, `src/styles.css`, `src-tauri/src/`, `src-tauri/capabilities/` | Fenêtre : ouverture sur Playlist, trois onglets, logs du moteur annoncés dans les Réglages, une seconde exécution passe la main à la première, barre de titre. Démo : démarrage sur Playlist | `window`, `window-single-instance`, `window-controls`, `demo` |
| `src/app/core/platform/update*` | Fenêtre : s'ouvrir sans invite ni erreur. Si une invite s'ouvre, la fermer par « Plus tard » | `window` |
| `src/app/demo/`, `src/demo/`, `demo/` | Démo : rejeu de bout en bout, bandeau et lien de contact, « Recommencer la démo » en français et en anglais, accueil dans la langue du visiteur, console vide, aucune requête hors origine | `demo`, `demo-restart`, `demo-language` |
| `package.json`, `pnpm-lock.yaml`, `angular.json`, `sidecar/pyproject.toml`, `sidecar/uv.lock`, `sidecar/build.py`, `sidecar/tagger.spec`, `src-tauri/Cargo.*`, `src-tauri/tauri.conf.json`, `Justfile` | Démarrer la fenêtre, puis un flux par surface. Binaire figé : le reconstruire et lui envoyer `get_version` par un pipe | `window`, `engine`, `demo` |

## Pièges

- Les trois onglets s'affichent dès l'ouverture, avant que le sidecar réponde (une vingtaine de secondes) : attendre la première ligne de son journal (`sidecar started techno-tagger@<version>`) avant d'ouvrir un écran qui l'interroge. Un écran bloquant sans onglets dit un sidecar absent ou d'une autre version que l'interface : `SENTRY_DSN_SIDECAR= just build-sidecar`
- La fenêtre affiche un autre projet, ou `just dev` sort en `exit 21` : le port 4200 est tenu (`netstat -ano`, `tasklist //FI "PID eq <pid>"`). Ne pas tuer un serveur qui n'est pas le sien, lancer le scénario `window`, qui prend un port libre
- `ng serve` survit à la fermeture de la fenêtre et garde son port : le relever avant l'arrêt (`netstat -ano`), l'arrêter par son PID
- Un scénario tué de force (délai dépassé, `taskkill /F`) laisse sa fenêtre, son sidecar, son `ng serve` et son dossier `techno-tagger-verify-*` du dossier temporaire : relever les PID lancés (`tasklist`, `netstat -ano`) et les arrêter un par un, jamais par nom d'image
- Un rechargement sous `just dev` (live reload, `Page.reload`) ajoute un sidecar sans arrêter le précédent : compter les `tagger.exe` sur une fenêtre fraîche, ne rien éditer pendant que l'app tourne
- Plusieurs `ng serve` lancés depuis des worktrees répondent en 504 `Outdated Optimize Dep` : les lancer avec `CI=1` (`startDemo` et `launchWindow` le posent)
- `just` écrit la ligne de recette sur stderr : ce n'est pas une fuite du protocole
- Un dossier ou un chemin de la forme Git Bash (`/c/...`) rend `tagging_folder_unreadable` : écrire `C:/...`. Un chemin Windows passé en argument shell à une évaluation perd ses backslashes : le passer en argument de `cdp.mjs`, qui le transmet par `__args`
- Une requête vers une autre origine que l'app ne demande pas apparaît dans la page : un outil du poste injecte un script dans toute page HTTP. les `demo*` mesurent ces origines sur une page vide et les ignorent, en pilotage direct comparer à une page vide avant de conclure
- Un clic Playwright sur un bouton grisé attend sa réactivation : viser ses coordonnées par `page.mouse.click` pour prouver qu'aucune commande ne part
- La croix de la modale d'arbitrage ferme la modale, pas Échap : le focus reste sur la liste des candidats, qui garde la touche
- Un morceau hors de la fenêtre de la table virtuelle n'a pas de ligne : l'ouvrir par le badge et la flèche de la modale
- Cliquer « Extraire » juste après le choix d'un fichier part avant la réponse du listage : attendre que le bouton repasse actif

## Rapport

```
## Vérification : <ce qui a changé, en une ligne>

**Verdict :** PASS | FAIL | BLOCKED | SKIP

**Attendu :** <ce que le changement doit faire d'après le diff et ce qui est annoncé, leur écart s'il y en a un>

**Méthode :** <mode, ce qui a été lancé>

### Étapes

1. ✅/❌/⚠️/🔍 <action sur l'app lancée> → <ce qu'elle a rendu>
   <evidence : capture, ligne du protocole, ligne de log, état du disque>

**Capture :** <l'image ou l'extrait qui montre le changement>

### Constats

<ce qui a fait hésiter pendant le pilotage>
```

- Une étape est une action sur l'app lancée : build, installation, tests et typecheck n'en sont pas
- 🔍 marque une sonde hors du chemin nominal. Au moins une : un rapport sans sonde ne rejoue que le cas nominal, encore PASS mais à moitié fait
- Constats : frictions, surprises, casse sans rapport avec le changement, notes d'environnement, une ligne par sonde même quand elle tient. ⚠️ en tête pour ce qui mérite d'interrompre le lecteur. Rien de ce qui se lit déjà sur la PR

- **PASS** : l'app a tourné et le changement fait ce qu'il doit à sa surface. Tests verts, build propre ou code qui semble juste ne suffisent pas
- **FAIL** : il ne le fait pas, il casse autre chose, ou l'annonce et le diff divergent sur le fond. Dans le doute, FAIL avec la capture brute
- **BLOCKED** : impossible d'atteindre un état où le changement s'observe (build cassé, binaire du sidecar absent, fenêtre qui ne s'ouvre pas). Dire où ça s'arrête, sans jugement sur le changement
- **SKIP** : aucune surface exécutable, en une ligne
- Pas de succès partiel : 3 sur 4 est un FAIL tant que le quatrième n'est pas passé ou expliqué
- L'evidence voyage dans le rapport : lignes du protocole et de log en ligne, chemin d'une capture seulement si le lecteur partage le disque

## Tenir la recette

- Modifier ce fichier seulement s'il a induit en erreur : commande fausse, étape manquante
- Un parcours métier livré prend une ligne dans `Flux par zone`
- Ni liste d'assertions, ni récit daté, ni scénario qui redit un test
