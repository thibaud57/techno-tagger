---
feature: "Post-MVP Feature 1 : Démo web publique"
subproject: "image-et-deploiement"
goal: "Publier la démo sur demo-techno-tagger.thibaud-geisler.com à chaque release, dans un container durci qui ne peut rien atteindre, surveillé depuis l'extérieur"
status: "draft"
complexity: "L"
tdd_scope: "partial"
depends_on: ["01-enregistreur-de-scenario-design.md", "02-shell-de-demo-design.md", "03-rejeu-du-scenario-design.md"]
date: "2026-10-25"
---

# Image et déploiement de la démo

## Scope

Ce lot couvre :
- l'image Docker de la démo, construite par `pnpm build:demo` puis servie par nginx non-root ;
- un compose durci, déployé par Dokploy dans un réseau isolé ;
- un job de release qui pousse l'image sur GHCR et redéploie à chaque tag, après l'installeur ;
- un contrôle de l'image à chaque PR ;
- la surveillance externe et la documentation d'exploitation.

Le déploiement suit le modèle du portfolio (relevé du 2026-10-25), réglages d'isolation en plus. Exclut le contenu de la démo (lots 1 à 3). Les retouches du portfolio (lien `?lang`, nouvel onglet, pages de contact) se font dans son dépôt, mais ce lot les inscrit dans PRODUCTION.md comme prérequis de mise en place.

### État livré

À la fin de ce sub-project, on peut :
- construire l'image en local et la lancer en lecture seule ;
- lire par `curl` la CSP, `noindex` et `/healthz` attendus, sur l'accueil comme sur une route de l'app et une 404 ;
- après le tag suivant, ouvrir la démo sur `https://demo-techno-tagger.thibaud-geisler.com`, que la sonde de disponibilité externe voit en ligne.

## Dependencies

- `01-enregistreur-de-scenario-design.md` (statut: draft) : `src/demo/` versionné, que le build de l'image copie sans rien générer, et ADR-023 que la doc d'exploitation cite.
- `02-shell-de-demo-design.md` (statut: draft) : `pnpm build:demo`, sortie `dist/techno-tagger-ui-demo/browser`, démo servie à la racine, `/demo/scenario.json` lu par le shell.
- `03-rejeu-du-scenario-design.md` (statut: draft) : démo complète, prête à publier.

## Files touched

- **À créer** : `demo/Dockerfile` (deux étapes : build sur `node:24-slim`, service sur `nginx/nginx-unprivileged`)
- **À créer** : `demo/nginx.conf` (routes, `/healthz`, cache, compression) et `demo/headers.conf` (en-têtes de sécurité, seule source, inclus dans chaque `location`)
- **À créer** : `demo/compose.yaml` (service `demo`, durci)
- **À créer** : `.dockerignore` (racine, contexte du build)
- **À créer** : `sidecar/tests/unit/test_demo_image_coherence.py` (valeurs recopiées entre fichiers, durcissement du compose)
- **À modifier** : `.github/workflows/release-please.yml` (job `demo`)
- **À modifier** : `.github/workflows/ci.yml` (`just build-demo` dans `ui`, job `demo-image`, ajouté aux variables et à la boucle de l'agrégateur `ci`)
- **À modifier** : `.github/dependabot.yml` (écosystème `docker` sur `/demo`)
- **À modifier** : `docs/PRODUCTION.md` (via `Skill[production-doc]`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Infrastructure, via `Skill[architecture-doc]`)
- **À modifier** : `docs/VERSIONS.md` (images de base épinglées, via `Skill[versions-doc]`)
- **À modifier** : `.claude/rules/github-actions/secrets-variables.md` (la prémisse « aucun déploiement serveur » devient fausse, via `Skill[rules-doc]`)

## Architecture approach

- **Image** (`demo/Dockerfile`, contexte à la racine) :
  - **Étape de build** sur `node:24-slim`. Debian porte `bash`, qu'exige `scriptShell: bash` de `pnpm-workspace.yaml`, absent d'alpine.
    - `ARG PNPM_VERSION=12.14.0`, la version de `devEngines.packageManager`, puis `npm install -g pnpm@${PNPM_VERSION}` ;
    - `pnpm install --frozen-lockfile`, puis `pnpm build:demo`. `APP_VERSION` vient de `$npm_package_version`, donc du `package.json` du checkout : au tag, celui que release-please a monté. `src/demo/` est versionné (lot 1), aucune génération n'a lieu dans le build ;
    - `PRIMENG_LICENSE_KEY` passe par un secret de build monté (`--mount=type=secret,id=primeng_license_key,required=false`), jamais par `ARG`, comme `SENTRY_AUTH_TOKEN` dans le portfolio. Absent en PR, la clé est vide. La clé finit lisible dans le bundle, comme dans l'installeur (ADR-003), mais n'entre pas dans l'historique de l'image.
  - **Étape de service** sur `nginx/nginx-unprivileged`, en alpine, sur la branche stable de nginx (`1.30.6-alpine` au relevé du 2026-10-25, à confirmer à l'implémentation). `nginxinc/nginx-unprivileged` n'est plus maintenu.
    - Ne contient que `dist/techno-tagger-ui-demo/browser`, `nginx.conf` et `headers.conf`. Écoute sur 8080, sous l'utilisateur non-root de l'image.
  - Images épinglées par tag, et suivies par Dependabot.
- **nginx** (`demo/nginx.conf` et `demo/headers.conf`) :
  - **Routes** : `location /` sert les routes de l'app par `try_files $uri /index.html`. `location /demo/`, `location /i18n/` et les fichiers à extension (`location ~ \.\w+$`) répondent `=404` quand le fichier manque : un asset haché disparu après un redéploiement rend 404, jamais `index.html` sous un mauvais type. `location = /healthz` rend `200` en `text/plain` sans fichier, `access_log off`. `autoindex off` écrit explicitement.
  - **En-têtes dans un seul fichier**, `headers.conf`, inclus dans chaque `location`, avec `always` : dans nginx, un `add_header` de `location` efface ceux hérités du serveur, et sans `always` les 4xx n'en ont aucun. C'est la seule source des en-têtes de la démo, que la CI lit.
  - **CSP** : `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'; object-src 'none'`. `style-src 'unsafe-inline'` est exigé par les styles que PrimeNG pose à l'exécution, comme dans la CSP Tauri. Risque résiduel : une injection CSS, sans donnée à exfiltrer dans la démo ; `script-src 'self'` sans inline ferme le reste.
  - `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
  - **Traefik ne pose que le HSTS**, réglage global du point d'entrée. Aucun middleware d'en-têtes du portfolio n'est attaché au domaine de la démo : la CSP vue en ligne doit être celle de `headers.conf`, vérifié à la mise en place. La limitation de débit du point d'entrée s'applique à tout hôte, rien de plus sur ce domaine.
  - Cache : `immutable` d'un an sur les fichiers hachés, `no-cache` sur `index.html` et `/demo/scenario.json`. `gzip on` sur `text/html`, `application/json`, `application/javascript`, `text/css`, `image/svg+xml` : le scénario porte toutes les réponses enregistrées.
  - `server_tokens off`, `client_max_body_size 1k` (la démo ne reçoit aucun corps), temp paths et PID sous `/tmp`.
  - **Logs** : le format par défaut de l'image, sur la sortie standard. L'adresse consignée est celle de Traefik, pas celle du visiteur : aucune donnée personnelle. Rétention par le logging Docker du compose.
- **Container** (`demo/compose.yaml`) :
  - `image: ${DEMO_IMAGE}`, posée dans l'onglet Environment de Dokploy. Le compte qui porte l'image n'est pas écrit dans le dépôt, le nom de l'image dérive de `github.repository` dans le workflow (mon choix, 2026-10-25).
  - `pull_policy: always`, `restart: unless-stopped`, `init: true`, `expose: ["8080"]`, aucun `ports`, aucun `volumes`.
  - `read_only: true` avec `tmpfs: ["/tmp:size=16m"]`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, `pids_limit: 64`.
  - `mem_limit: 128m`, `cpus: "0.5"` (mon choix, 2026-10-25).
  - Healthcheck sur `http://127.0.0.1:8080/healthz` (`wget -q --spider`), `interval: 30s`, `timeout: 5s`, `retries: 3`, `start_period: 10s`. Traefik ne route que vers un container `healthy`.
  - Logging `json-file`, `max-size 20m`, `max-file 5`, comme le portfolio.
  - **Gardé par le test de cohérence** : Dokploy relit `main` à chaque redéploiement, une édition qui retirerait `read_only`, `cap_drop`, `no-new-privileges` ou `pids_limit`, ou ajouterait `ports`, `volumes` ou `privileged`, partirait en production sans alerte. Le test lit ces clés.
  - L'isolation réseau (Isolated Deployment) est un réglage de Dokploy, hors fichier : la checklist de mise en place le vérifie.
- **Job `demo`** (`release-please.yml`, `.claude/rules/github-actions/workflows.md`, `job-control.md`, `security-permissions.md`, `secrets-variables.md`, `runners.md`, `cache-outputs.md`, `expressions-contexts.md`) :
  - **Déclenchement** : `needs: [release-please, build]`, `if: needs.release-please.outputs.release_created == 'true'`. La démo ne part qu'après l'installeur publié, et un échec de `build` la saute.
  - **Environnement** : `ubuntu-24.04`, `timeout-minutes: 20`, `permissions: { contents: read, packages: write }`, checkout sur `needs.release-please.outputs.tag_name` avec `persist-credentials: false` (le job ne pousse rien sur Git).
  - **Image** :
    - actions épinglées par SHA avec leur version en commentaire (`.claude/rules/github-actions/security-permissions.md`), dernières versions relevées le 2026-10-25 sur leurs dépôts :
      - `docker/login-action@81c6f93d4bc991e510b342a00b419b3bb4efc5c6` (v4.7.0) ;
      - `docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302` (v6.2.0) ;
      - `docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069` (v4.4.1) ;
      - `docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc` (v7.4.0) ;
    - image `ghcr.io/${{ github.repository }}-demo` ;
    - tags `latest` et `{{version}}` de `tag_name` ;
    - cache `type=gha` ;
    - secret de build `primeng_license_key`, passé par `secret-envs` depuis une variable `env:` du step qui lit `secrets.PRIMENG_LICENSE_KEY` (`.claude/rules/github-actions/secrets-variables.md` : un secret se passe par `env:`).
  - **Redéploiement** : une seule requête `curl -fsSL --max-time 60 -X POST "$DOKPLOY_URL/api/compose.redeploy"`, en-tête `x-api-key: $DOKPLOY_TOKEN`, corps `{"composeId":"$DOKPLOY_COMPOSE_ID"}`, secrets passés par `env:`. Pas de nouvelle tentative automatique : un POST accepté mais sans réponse à temps relancerait un second redéploiement, un échec réseau se relance à la main (Re-run job). Mêmes noms de secrets que le portfolio, posés dans les secrets de ce dépôt. `DOKPLOY_URL` est l'origine du tableau de bord, sans slash final.
  - **Clé d'API Dokploy** : actif à pouvoir de déploiement, exposé à toute modification de workflow qui atteint `main`. Sa portée est celle qu'offre Dokploy à sa création (relevée à la mise en place, écrite dans PRODUCTION.md). Rotation : au moins une fois par an et à tout soupçon de fuite, révocation côté Dokploy d'abord, puis secret GitHub remplacé.
  - Un échec de ce job ne touche pas l'installeur, déjà publié. GitHub l'envoie par email.
  - Un lot uniquement `chore:` ne crée pas de release, donc ne redéploie pas (`.claude/rules/release-please/config.md`).
- **CI des PR** (`ci.yml`) :
  - le job `ui` ajoute `just build-demo` après `just build-ui` (le lot 2 y a déjà posé la garde du bundle desktop) ;
  - un job `demo-image` (`ubuntu-24.04`, condition `changes`) construit l'image sans la pousser, avec une clé PrimeNG vide. Il la lance en `--read-only --tmpfs /tmp --cap-drop ALL`, puis vérifie : `/healthz` à `200` ; sur `/`, `/settings`, `/demo/scenario.json` et une URL inexistante à extension (`/nope.js`, attendue en 404), la CSP et `X-Robots-Tag` lus depuis `demo/headers.conf` (aucune copie dans le workflow) ; `Cache-Control: no-cache` sur `/demo/scenario.json` ; `<app-root` dans `/settings` ; l'UID du process différent de 0 ;
  - `demo-image` rejoint l'agrégateur `ci` : son résultat entre dans les variables `env` et la boucle qui refuse `failure` et `cancelled` (l'agrégateur n'a pas de condition, il itère sur les résultats).
- **Vérification du parcours sous la CSP** : Playwright n'est pas une dépendance du dépôt. C'est `/verify`, au gate du lot et à la mise en place, qui joue le parcours complet contre l'image lancée en local et échoue sur toute violation CSP en console ou toute requête hors origine. La checklist de release le reprend.
- **Dependabot** : écosystème `docker`, `directory: /demo`, `target-branch: develop`, `interval: monthly`, `open-pull-requests-limit: 5`, groupe `minor-patch`, comme les autres.
- **`.dockerignore`** : le contexte ne garde que ce que le build lit. `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `angular.json`, les `tsconfig*.json`, `.postcssrc.json` (sans lui le build passe et l'app sort sans Tailwind), `src/` (`src/demo/` compris), `public/` et `demo/` restent. Le reste est exclu, explicitement `node_modules`, `dist`, `sidecar`, `src-tauri`, `.git`, `.claude`, `.env*`, `demo-data`, `docs`.
- **Cohérence** (`test_demo_image_coherence.py`, garde d'« une valeur, une source ») : lecture des fichiers par expressions régulières sur un format fixé. Le Dockerfile tient la version de pnpm sur une ligne `ARG PNPM_VERSION=`, et la copie de l'étape de service est écrite sans variable. Aucune dépendance de parsing de plus (mon choix, 2026-10-25). Les vérifications :
  - la majeure de Node du `FROM` égale celle d'`engines.node` de `package.json` et celle du `runtime: node@` de `.github/actions/setup-pnpm/action.yml` ;
  - la version de pnpm installée égale `devEngines.packageManager.version` ;
  - le port de `listen` de `nginx.conf` égale celui d'`expose` et du healthcheck de `compose.yaml` ;
  - le dossier copié dans l'étape de service égale le `outputPath` de la configuration `demo` d'`angular.json` ;
  - le chemin `no-cache` de `nginx.conf` égale celui que `demo-scenario.service.ts` charge, et son dossier égale l'`output` des assets de démo d'`angular.json` ;
  - `compose.yaml` porte `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges:true`, `pids_limit: 64`, et ne porte ni `ports:`, ni `volumes:`, ni `privileged`.
- **Mise en place chez le propriétaire**, procédure écrite dans PRODUCTION.md, dans cet ordre :
  1. **DNS** : un enregistrement `demo-techno-tagger` de même cible que l'apex.
  2. **Dokploy** : projet `techno-tagger`, environment `demo`, Compose depuis GitHub (branche `main`, fichier `demo/compose.yaml`), Isolated Deployment activé, déploiement automatique coupé (la CI déclenche). Onglet Environment : `DEMO_IMAGE`. Onglet Domains : hôte `demo-techno-tagger.thibaud-geisler.com`, service `demo`, port `8080`, HTTPS Let's Encrypt, aucun middleware d'en-têtes attaché. Noter la portée de la clé d'API telle que Dokploy la présente.
  3. **Secrets GitHub** : `DOKPLOY_URL`, `DOKPLOY_TOKEN`, `DOKPLOY_COMPOSE_ID`.
  4. **Première release et GHCR** : au premier push, le paquet de la démo est privé ; le passer en public, pour que Dokploy le tire sans identifiants, puis relancer le job `demo` s'il a échoué au tirage.
  5. **Vérification en ligne** : en-têtes sur l'accueil, une route et une 404, `/healthz`, version des Réglages égale au tag, parcours par `/verify`, aucun cookie du portfolio sur le sous-domaine.
  6. **Sonde de disponibilité externe** (le service déjà utilisé pour le portfolio) : une sonde HTTP sur `https://demo-techno-tagger.thibaud-geisler.com/healthz`, toutes les 5 minutes, alerte email au changement d'état.
  7. **Portfolio** (son dépôt) : le bouton « Voir la démo » pointe vers la démo avec `?lang=fr` ou `?lang=en` selon la langue de la page, s'ouvre dans un nouvel onglet (`target="_blank" rel="noopener noreferrer"`), et les pages `/fr/contact` et `/en/contact` que le bandeau cible existent. Les cookies du portfolio restent sans attribut `Domain=` : un cookie posé sur `.thibaud-geisler.com` serait lisible par le sous-domaine.
- **Retour arrière** (mon choix, 2026-10-25) : poser dans Dokploy `DEMO_IMAGE` sur la version précédente (`…-demo:X.Y.Z`), puis Redeploy. C'est immédiat, sans rebuild. La variable reste épinglée tant qu'on ne la remet pas sur `latest` : la checklist de release vérifie qu'elle vaut `latest` avant de publier, sinon la démo resterait figée sans alerte.
- **Docs** :
  - **PRODUCTION.md** :
    - Environnements : ligne « Démo web » ; les phrases « aucun hébergement », « pas de staging » et « en-têtes sans objet » sont amendées ;
    - Variables : les trois secrets Dokploy ;
    - Gestion des Secrets et Rotation : la clé Dokploy, portée, rotation et révocation ci-dessus ;
    - Pipelines : le job `demo` et le job `demo-image` ;
    - Rollback : la procédure ci-dessus ;
    - Sécurité : en-têtes (nginx seul, HSTS par Traefik), isolation, logs sans adresse de visiteur et leur rétention ;
    - Observabilité : la sonde externe, et l'email GitHub d'un job en échec ;
    - Checklist Release : « `DEMO_IMAGE` vaut `latest` ; après le tag : démo redéployée, version affichée dans les Réglages égale au tag, parcours joué par `/verify` sans violation CSP ni requête sortante » ;
    - Backup : rien à sauvegarder, l'image se reconstruit depuis le tag ;
    - Mise en place : les sept étapes ci-dessus.
  - **ARCHITECTURE.md** : § Infrastructure, hébergement de la démo.
  - **VERSIONS.md** : les deux images de base.
  - Les noms des outils de l'hébergement se limitent à ceux que PRODUCTION.md cite déjà (Dokploy) ; la sonde est nommée par son rôle, et aucune version de l'hébergement n'est écrite dans le dépôt.

## Acceptance criteria

### Scénario 1 : l'image tourne en lecture seule
**GIVEN** l'image construite en local
**WHEN** on la lance en `--read-only --tmpfs /tmp --cap-drop ALL` et qu'on interroge `/healthz`, `/`, `/settings`, `/demo/scenario.json` et `/nope.js`
**THEN** `/healthz` répond `200`, `/` et `/settings` servent l'app, `/demo/scenario.json` répond en `no-cache`, `/nope.js` répond `404`
**AND** toutes ces réponses, la 404 comprise, portent la CSP de `headers.conf`, `X-Robots-Tag: noindex` et `X-Frame-Options: DENY`
**AND** le process nginx ne tourne pas en root

### Scénario 2 : rien ne sort
**GIVEN** l'image lancée en local
**WHEN** `/verify` joue tout le parcours dans un navigateur
**THEN** la console ne montre aucune violation CSP et le navigateur n'émet aucune requête hors de l'origine de la démo
**AND** la même vérification se refait en ligne à la mise en place

### Scénario 3 : déploiement au tag
**GIVEN** une release créée par release-please
**WHEN** le job `build` réussit
**THEN** le job `demo` pousse `latest` et `X.Y.Z`, puis Dokploy redéploie
**AND** la démo en ligne affiche dans les Réglages la version du tag

### Scénario 4 : l'installeur d'abord
**GIVEN** une release dont le job `build` échoue
**WHEN** le workflow se termine
**THEN** le job `demo` est sauté et la démo garde la version précédente

### Scénario 5 : une PR qui casse l'image
**GIVEN** une PR qui casse le Dockerfile ou la configuration nginx
**WHEN** la CI tourne
**THEN** `demo-image` échoue et l'agrégateur `ci` est rouge

### Scénario 6 : une copie qui diverge
**GIVEN** une montée de la majeure de Node dans `package.json` sans toucher au Dockerfile
**WHEN** la suite du sidecar tourne
**THEN** `test_demo_image_coherence.py` échoue en nommant les deux fichiers

### Scénario 7 : panne vue de l'extérieur
**GIVEN** la sonde de disponibilité externe en place
**WHEN** la démo cesse de répondre sur `/healthz`
**THEN** un email part au changement d'état, même si le VPS entier est éteint

### Scénario 8 : un compose dédurci ne part pas
**GIVEN** une PR qui retire `cap_drop` de `compose.yaml` ou lui ajoute `ports`
**WHEN** la suite du sidecar tourne
**THEN** `test_demo_image_coherence.py` échoue en nommant la clé

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_demo_image_coherence.py` :
  - keeps the Node major of the image equal to the engines of package.json and the CI runtime
  - installs the pnpm version pinned by devEngines
  - serves, exposes and probes the same port
  - copies the output path of the demo build configuration
  - serves the scenario at the path the shell fetches
  - keeps the compose hardened

### Integration
- Job `demo-image` de `ci.yml` (shell, sans framework) : image construite, lancée en lecture seule, `/healthz` à `200`, en-têtes de `headers.conf` sur `/`, `/settings`, `/demo/scenario.json` et une 404, `no-cache` sur le scénario, process non root.
- `/verify` au gate du lot : parcours complet sous l'image, console sans violation CSP, aucune requête hors origine.

## Edge cases

- **Premier push du paquet GHCR** : privé par défaut. Dokploy échoue à tirer l'image tant qu'il n'est pas passé en public (étape 4 de la mise en place).
- **Clé PrimeNG absente en PR** : `demo-image` construit sans clé, l'app afficherait la notice de licence. Sans effet, l'image de PR n'est jamais publiée.
- **Redéploiement pendant une visite** : le recreate coupe la démo quelques secondes. La sonde peut voir un « DOWN » puis un « UP » autour d'une release, comme pour le portfolio. Un onglet resté ouvert qui demande un bundle haché disparu reçoit 404, pas `index.html` : il recharge.
- **`compose.yaml` modifié par une release** : Dokploy relit `main` au redéploiement, le fichier suit donc la release qui le change, et le test de cohérence a vérifié son durcissement dans la PR.
- **Limitation de débit du VPS** : le point d'entrée Traefik l'applique déjà à tout hôte. Aucun middleware de plus sur ce domaine, il compterait double. Ses valeurs vivent dans la configuration de l'hébergement, hors de ce dépôt.
- **`/healthz` toujours `200`** : la sonde voit le process, pas l'app. Une seconde sonde sur `/` avec le mot-clé `app-root` peut s'ajouter si un incident le justifie.
- **`DEMO_IMAGE` laissée épinglée après un retour arrière** : la release suivante redéploie la vieille version. La checklist de release le vérifie avant le tag.

## Architectural decisions

### Décision : d'où vient le nom de l'image dans le compose

**Options envisagées :**
- **A. Écrit en dur**, comme le portfolio : lisible, mais l'identifiant du compte GitHub entre dans un fichier du dépôt (le nom de l'image, lui, dérive déjà de `github.repository` dans le workflow).
- **B. Variable `DEMO_IMAGE` de Dokploy** : le fichier reste générique, et la même variable sert au retour arrière.

**Choix : B**

**Rationale :**
- Le retour arrière devient un changement de variable, sans commit ni rebuild
- Aucun identifiant de compte de plus dans un dépôt public

### Décision : qui pose les en-têtes de sécurité

**Options envisagées :**
- **A. Le middleware d'en-têtes du portfolio, côté Traefik** : rien dans l'image, mais une CSP écrite pour le portfolio, qui autorise d'autres origines, remplacerait celle de la démo, et la vérification locale ne verrait rien.
- **B. nginx seul, Traefik ne posant que le HSTS** : les en-têtes voyagent avec l'image, `curl` en local les voit tels qu'en ligne, et le job `demo-image` les vérifie à chaque PR.

**Choix : B**

**Rationale :**
- Une valeur, une source : `headers.conf`, lu par la CI et par le test de cohérence
- La CSP de la démo est plus stricte que celle d'un site avec analytics : elle ne doit pas hériter

### Décision : contrôler l'image avant la release

**Options envisagées :**
- **A. Seulement au tag** : rien à ajouter, mais une casse du Dockerfile se découvre après la publication de l'installeur, et la démo reste à la version précédente.
- **B. Job `demo-image` à chaque PR** : quelques minutes de CI, et la casse se voit dans la PR.

**Choix : B**

**Rationale :**
- Le tag est ce qui publie : il ne doit rien découvrir
- Le même job prouve la lecture seule et les en-têtes (scénario 1)
