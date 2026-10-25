# Image et déploiement de la démo : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publier la démo sur `demo-techno-tagger.thibaud-geisler.com` à chaque release, dans un container durci qui ne peut rien atteindre, surveillé depuis l'extérieur.

**Architecture:** `demo/Dockerfile` construit la démo par `pnpm build:demo`, puis la sert par `nginx-unprivileged`. `demo/compose.yaml` la fait tourner en lecture seule, sans capacités, derrière Traefik, dans un Compose Dokploy isolé. Chaque PR construit et sonde l'image. Le job `demo` de `release-please.yml` la pousse sur GHCR après l'installeur, puis appelle `compose.redeploy`, comme le portfolio.

**Tech Stack:** Docker (BuildKit, secrets de build), nginx, GitHub Actions, Dokploy et Traefik côté hébergement (versions relevées à la mise en place, jamais écrites ici), pytest pour la garde de cohérence. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/demo-web-publique/04-image-et-deploiement-design.md`

## Global Constraints

- **Images** : `node:24-slim` pour le build, `nginx/nginx-unprivileged` en alpine sur la branche stable pour le service (`1.30.6-alpine` au relevé du 2026-10-25). Le tag est confirmé par `docs/tech-researcher` à la Task 1 et épinglé par tag, jamais `latest`.
- **pnpm** : `ARG PNPM_VERSION=12.14.0` sur une ligne, `npm install -g pnpm@${PNPM_VERSION}` (paquet présent sur npm, vérifié le 2026-10-25).
- **Secret de build** : `--mount=type=secret,id=primeng_license_key,required=false`, jamais `ARG`.
- **Copie de service** : `COPY --from=build /app/dist/techno-tagger-ui-demo/browser /usr/share/nginx/html`, sans variable.
- **Port** : 8080 partout (`listen`, `expose`, healthcheck).
- **En-têtes dans `demo/headers.conf`**, seule source, inclus avec `always` dans chaque `location` (un `add_header` de `location` efface ceux du serveur) :
  - **CSP** (exacte) : `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'; object-src 'none'` ;
  - `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **nginx.conf** : `server_tokens off`, `autoindex off`, `client_max_body_size 1k`, `gzip on` (`text/html`, `application/json`, `application/javascript`, `text/css`, `image/svg+xml`), temp paths et PID sous `/tmp`. `location /` : `try_files $uri /index.html`. `location /demo/`, `location /i18n/`, `location ~ \.\w+$` : `try_files $uri =404`. `location = /healthz` : `200` en `text/plain`, `access_log off`. Traefik ne pose que le HSTS.
- **Cache** : `Cache-Control: public, max-age=31536000, immutable` sur les fichiers hachés, `no-cache` sur `index.html` (`location = /index.html`) et sur le scénario (`location = /demo/scenario.json`, que le test de cohérence lit).
- **Compose** :
  - service `demo`, `image: ${DEMO_IMAGE}`, `pull_policy: always`, `restart: unless-stopped`, `init: true`, `expose: ["8080"]`, ni `ports`, ni `volumes`, ni `privileged` ;
  - `read_only: true`, `tmpfs: ["/tmp:size=16m"]`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, `pids_limit: 64`, `mem_limit: 128m`, `cpus: "0.5"` ;
  - healthcheck `wget -q --spider http://127.0.0.1:8080/healthz`, `30s` / `5s` / `3` / `start_period: 10s` ;
  - logging `json-file` `20m` × `5`.
- **Image publiée** : `ghcr.io/${{ github.repository }}-demo`, tags `latest` et `{{version}}`.
- **Actions** (épinglées par SHA, version en commentaire `# vX.Y.Z` sur la ligne, dernières versions relevées le 2026-10-25 sur leurs dépôts) :
  - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1), avec `persist-credentials: false` ;
  - `docker/login-action@81c6f93d4bc991e510b342a00b419b3bb4efc5c6` (v4.7.0) ;
  - `docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302` (v6.2.0) ;
  - `docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069` (v4.4.1) ;
  - `docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc` (v7.4.0).
- **Secrets** : `DOKPLOY_URL` (origine sans slash final), `DOKPLOY_TOKEN`, `DOKPLOY_COMPOSE_ID`, `PRIMENG_LICENSE_KEY` (existant). Tous passés par `env:` au niveau du step, jamais interpolés dans un `run:` ni dans un `with:` (`.claude/rules/github-actions/secrets-variables.md`).
- **Docs gouvernées par un skill** : PRODUCTION.md (`production-doc`), ARCHITECTURE.md (`architecture-doc`), VERSIONS.md (`versions-doc`), rules (`rules-doc`). Charger le skill avant d'écrire. Aucun nom d'outil d'hébergement au-delà de ceux que PRODUCTION.md cite déjà, la sonde externe nommée par son rôle, aucune version de l'hébergement.
- **Gate vert à chaque commit** : `just lint-workflows`, `just lint-sidecar`, `just test-sidecar`, plus la commande de vérification de la tâche. `just lint` entier exige le binaire du sidecar, inutile ici. Commits `feat(demo): …` pour l'image et le compose, `chore(ci): …` pour les workflows, `docs: …` pour la doc.

## Review Focus

- **Rechargement direct d'une route de l'app** (`/settings`, `/tagging`) : nginx sert l'app, pas un 404 (Task 1, sonde `curl /settings` de la Step 4 ; Task 3, même sonde dans `demo-image`).
- **Asset haché disparu ou 404 quelconque** : réponse 404 avec les en-têtes de sécurité, jamais `index.html` sous un mauvais type (Task 1, sonde `/nope.js` ; Task 3, même sonde).
- **Container en lecture seule** : nginx démarre sans écrire hors de `/tmp` (Task 2, `docker compose up` avec `DEMO_IMAGE` local ; Task 3, `docker run --read-only`).
- **Compose dédurci dans une PR** : la garde nomme la clé retirée ou ajoutée (Task 2, `test_keeps_the_compose_hardened`).
- **Montée de Node ou de pnpm d'un seul côté** : la garde nomme le fichier en retard (Task 1 et Task 2, `test_demo_image_coherence.py`).
- **Job `build` en échec à la release** : la démo n'est pas redéployée (Task 4, `if:` sans fonction de statut, donc `success()` implicite, vérifié par `actionlint` et la lecture du graphe).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `demo/Dockerfile` | Build de la démo, image de service |
| `demo/nginx.conf` | Routes, `/healthz`, cache, compression |
| `demo/headers.conf` | En-têtes de sécurité, seule source |
| `demo/compose.yaml` | Container durci pour Dokploy |
| `.dockerignore` | Contexte minimal du build |
| `sidecar/tests/unit/test_demo_image_coherence.py` | Valeurs recopiées entre fichiers, durcissement du compose |

---

### Task 1: Image de la démo

**Files:**
- Create: `demo/Dockerfile`, `demo/nginx.conf`, `demo/headers.conf`, `.dockerignore`, `sidecar/tests/unit/test_demo_image_coherence.py`
- Modify: `docs/VERSIONS.md`

**Interfaces:**
- Consumes : `pnpm build:demo` et sa sortie `dist/techno-tagger-ui-demo/browser` (lot 2), `src/demo/` versionné (lot 1), `fetch("/demo/scenario.json")` de `src/app/demo/demo-scenario.service.ts` (lot 2), `REPO` de `sidecar/tests/helpers/protocol_mirror.py`
- Produces : constantes de test `DOCKERFILE = REPO / "demo/Dockerfile"`, `NGINX_CONF = REPO / "demo/nginx.conf"`, `HEADERS_CONF = REPO / "demo/headers.conf"`, `COMPOSE = REPO / "demo/compose.yaml"`, que la Task 2 réutilise

- [ ] **Step 1: Confirmer le tag de `nginx/nginx-unprivileged` et de `node:24-slim`**

Lancer `Agent(subagent_type: "docs/tech-researcher")` sur `nginx-unprivileged` (`type_recherche=versions`, `ecosysteme=[Docker, nginx, alpine]`), puis sur `node` en variante `24-slim`. Confirmer le tag stable alpine (`1.30.6-alpine` au 2026-10-25) et que `wget` est présent dans l'image (busybox).

- [ ] **Step 2: Write the failing tests**

```python
def test_keeps_the_node_major_of_the_image_equal_to_the_engines_of_package_json_and_the_ci_runtime() -> None:
    image_major = _match(r"^FROM node:(\d+)-slim", DOCKERFILE)
    engines_major = re.search(r"\d+", _package()["engines"]["node"]).group(0)
    ci_major = _match(r"runtime:\s*node@(\d+)", REPO / ".github/actions/setup-pnpm/action.yml")

    assert image_major == engines_major == ci_major, "Dockerfile, package.json et setup-pnpm divergent sur la majeure de Node"


def test_installs_the_pnpm_version_pinned_by_dev_engines() -> None:
    assert _match(r"^ARG PNPM_VERSION=(\S+)$", DOCKERFILE) == _package()["devEngines"]["packageManager"]["version"]


def test_copies_the_output_path_of_the_demo_build_configuration() -> None:
    output_path = _angular()["projects"]["techno-tagger-ui"]["architect"]["build"]["configurations"]["demo"]["outputPath"]

    assert _match(r"^COPY --from=build /app/(\S+)/browser ", DOCKERFILE) == output_path


def test_serves_the_scenario_at_the_path_the_shell_fetches() -> None:
    fetched = _match(r'fetch\("(/demo/scenario\.json)"\)', REPO / "src/app/demo/demo-scenario.service.ts")
    assets_output = next(a["output"] for a in _angular()["projects"]["techno-tagger-ui"]["architect"]["build"]["configurations"]["demo"]["assets"] if a["input"] == "src/demo")

    assert _match(r"^\s*location = (/demo/scenario\.json) ", NGINX_CONF) == fetched
    assert fetched.startswith(f"/{assets_output}/")
```

`_match(pattern, path)` lève une `AssertionError` nommant le fichier quand le motif manque. `_package()` et `_angular()` lisent le JSON depuis `REPO`.

- [ ] **Step 3: Run to verify they fail**

Run: `cd sidecar && uv run pytest tests/unit/test_demo_image_coherence.py -x -q`
Expected: FAIL, `demo/Dockerfile` absent

- [ ] **Step 4: Implement `Dockerfile`, `nginx.conf`, `headers.conf` and `.dockerignore`, then check by hand**

Contenu fixé par les Global Constraints et le spec § Architecture approach (étapes, `.dockerignore`, routes, en-têtes dans `headers.conf` inclus avec `always` dans chaque `location`, cache, compression, temp paths sous `/tmp`).

Run :
```bash
docker build -f demo/Dockerfile -t techno-tagger-demo:local .
docker run -d --rm --name demo-local --read-only --tmpfs /tmp --cap-drop ALL -p 8080:8080 techno-tagger-demo:local
curl -fsS http://localhost:8080/healthz
for p in / /settings /demo/scenario.json /nope.js; do echo "== $p"; curl -sI "http://localhost:8080$p" | grep -i "^HTTP\|content-security-policy\|x-robots-tag\|x-frame-options\|cache-control"; done
curl -fsS http://localhost:8080/settings | grep -c "<app-root"
docker exec demo-local id -u
docker stop demo-local
```
Expected : `/healthz` à 200 ; les quatre URLs portent la CSP exacte, `X-Robots-Tag: noindex` et `X-Frame-Options: DENY`, `/nope.js` en `404`, `/demo/scenario.json` en `no-cache` ; `1` pour `/settings` ; un UID différent de `0` (scénario 1 du spec).

- [ ] **Step 5: Run the tests**

Même commande qu'à la Step 3. Expected: PASS

- [ ] **Step 6: VERSIONS.md**

Charger `Skill[versions-doc]`, ajouter les deux images de base avec les versions de la Step 1, dans la catégorie infrastructure du document.

- [ ] **Step 7: Gate and commit**

```bash
git add demo/Dockerfile demo/nginx.conf demo/headers.conf .dockerignore sidecar/tests/unit/test_demo_image_coherence.py docs/VERSIONS.md
git commit -m "feat(demo): image Docker de la demo servie par nginx non-root"
```

### Task 2: Compose durci

**Files:**
- Create: `demo/compose.yaml`
- Modify: `sidecar/tests/unit/test_demo_image_coherence.py`

**Interfaces:**
- Consumes : `DOCKERFILE`, `NGINX_CONF`, `COMPOSE` (Task 1)

- [ ] **Step 1: Write the failing tests**

```python
def test_serves_exposes_and_probes_the_same_port() -> None:
    listened = _match(r"^\s*listen\s+(\d+);", NGINX_CONF)
    exposed = _match(r'^\s*expose:\s*\[\s*"(\d+)"\s*\]', COMPOSE)
    probed = _match(r"http://127\.0\.0\.1:(\d+)/healthz", COMPOSE)

    assert listened == exposed == probed == "8080"


@pytest.mark.parametrize(
    "line",
    ["read_only: true", "cap_drop: [ALL]", "no-new-privileges:true", "pids_limit: 64"],
    ids=["read-only", "cap-drop", "no-new-privileges", "pids-limit"],
)
def test_keeps_the_compose_hardened(line: str) -> None:
    assert line in COMPOSE.read_text(encoding="utf-8"), f"compose.yaml a perdu `{line}`"


@pytest.mark.parametrize("key", ["ports:", "volumes:", "privileged"], ids=["ports", "volumes", "privileged"])
def test_keeps_the_compose_closed(key: str) -> None:
    assert key not in COMPOSE.read_text(encoding="utf-8"), f"compose.yaml porte `{key}`"
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sidecar && uv run pytest tests/unit/test_demo_image_coherence.py -x -q`
Expected: FAIL, `demo/compose.yaml` absent

- [ ] **Step 3: Implement `compose.yaml`, then run it locally**

Valeurs des Global Constraints. Puis :
```bash
DEMO_IMAGE=techno-tagger-demo:local docker compose -f demo/compose.yaml up -d
docker compose -f demo/compose.yaml ps
```
Expected : le service passe `healthy` en moins d'une minute, alors que le système de fichiers est en lecture seule. Arrêter par `docker compose -f demo/compose.yaml down`.

- [ ] **Step 4: Run the tests**

Même commande qu'à la Step 2. Expected: PASS

- [ ] **Step 5: Gate and commit**

```bash
git add demo/compose.yaml sidecar/tests/unit/test_demo_image_coherence.py
git commit -m "feat(demo): compose durci de la demo pour Dokploy"
```

### Task 3: Contrôle de l'image à chaque PR

**Files:**
- Modify: `.github/workflows/ci.yml` (job `ui` : `just build-demo` après la garde du bundle desktop du lot 2 ; nouveau job `demo-image` ; agrégateur `ci`), `.github/dependabot.yml`

**Interfaces:**
- Consumes : `changes.outputs.source`, actions des Global Constraints, `demo/headers.conf` (Task 1)
- Produces : job `demo-image`, que l'agrégateur `ci` attend

- [ ] **Step 1: `just build-demo` dans le job `ui`**

Après le step « Garde du bundle desktop » (lot 2) : `- run: just build-demo`. Le build de démo casse ainsi dans la PR, avant l'image.

- [ ] **Step 2: Job `demo-image`**

Squelette :
- `needs: changes`, `if: needs.changes.outputs.source == 'true'`, `runs-on: ubuntu-24.04`, `timeout-minutes: 15`, `permissions: { contents: read }`, `defaults.run.shell: bash` ;
- steps : checkout (`persist-credentials: false`) ; `setup-buildx-action` ; `build-push-action` avec `context: .`, `file: demo/Dockerfile`, `push: false`, `load: true`, `tags: techno-tagger-demo:ci`, cache `type=gha` (aucun secret) ;
- un step nommé « Sonder l'image en lecture seule » : `docker run -d --name demo --read-only --tmpfs /tmp --cap-drop ALL -p 8080:8080`, attente de `/healthz` par boucle bornée (10 essais d'une seconde). Il lit la CSP attendue dans `demo/headers.conf` (`grep -oP 'Content-Security-Policy "\K[^"]+'`), puis échoue si l'une des réponses `/`, `/settings`, `/demo/scenario.json`, `/nope.js` n'a pas cette CSP ou `X-Robots-Tag: noindex`, si `/nope.js` n'est pas `404`, si `/demo/scenario.json` n'est pas `no-cache`, si `/settings` ne contient pas `<app-root`, ou si `docker exec demo id -u` rend `0`.

Dans l'agrégateur `ci` : `demo-image` dans `needs`, `DEMO_IMAGE: ${{ needs.demo-image.result }}` dans `env`, dans l'`echo` et dans la boucle `for` qui refuse `failure` et `cancelled` (il n'y a pas de condition à étendre, l'agrégateur itère sur les résultats).

- [ ] **Step 3: Dependabot**

Entrée `docker` : `directory: "/demo"`, `target-branch: develop`, `schedule.interval: monthly`, `open-pull-requests-limit: 5`, groupe `minor-patch` (`update-types: [minor, patch]`), au format des quatre autres.

- [ ] **Step 4: Vérifier**

Run: `just lint-workflows`
Expected: actionlint vert. Puis, sur la PR du lot : `ui` vert avec `build-demo`, `demo-image` vert, et `ci` vert.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/dependabot.yml
git commit -m "chore(ci): construire et sonder l'image de demo a chaque PR"
```

### Task 4: Déploiement au tag

**Files:**
- Modify: `.github/workflows/release-please.yml` (job `demo`, après `build`)

**Interfaces:**
- Consumes : `needs.release-please.outputs.release_created` et `tag_name`, secrets des Global Constraints

- [ ] **Step 1: Job `demo`**

Squelette :
- `needs: [release-please, build]`, `if: needs.release-please.outputs.release_created == 'true'`, `runs-on: ubuntu-24.04`, `timeout-minutes: 20`, `permissions: { contents: read, packages: write }` ;
- checkout sur `ref: ${{ needs.release-please.outputs.tag_name }}`, `persist-credentials: false` ;
- `login-action` sur `ghcr.io` (`github.actor`, mot de passe `${{ secrets.GITHUB_TOKEN }}` : le seul secret que l'action lit par `with:`, usage documenté de l'action) ;
- `metadata-action` : `images: ghcr.io/${{ github.repository }}-demo`, `tags: type=raw,value=latest` puis `type=semver,pattern={{version}},value=${{ needs.release-please.outputs.tag_name }}` ;
- `setup-buildx-action` ;
- `build-push-action` : `context: .`, `file: demo/Dockerfile`, `push: true`, tags et labels du `metadata`, `secret-envs: primeng_license_key=PRIMENG_LICENSE_KEY` avec `env: PRIMENG_LICENSE_KEY: ${{ secrets.PRIMENG_LICENSE_KEY }}` sur le step, cache `type=gha` ;
- step nommé « Redeployer la demo sur Dokploy » : `DOKPLOY_URL`, `DOKPLOY_TOKEN`, `DOKPLOY_COMPOSE_ID` en `env:`. Une seule requête `curl -fsSL --max-time 60 -X POST "$DOKPLOY_URL/api/compose.redeploy"` avec `-H "x-api-key: $DOKPLOY_TOKEN"`, `-H "Content-Type: application/json"` et `-d "{\"composeId\":\"$DOKPLOY_COMPOSE_ID\"}"`. Aucune nouvelle tentative automatique, le pourquoi en commentaire : un POST accepté sans réponse à temps relancerait un second redéploiement. Un échec se relance à la main (Re-run job).

- [ ] **Step 2: Vérifier**

Run: `just lint-workflows`
Expected: actionlint vert, et dans le graphe `demo` attend `build`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-please.yml
git commit -m "chore(ci): publier et redeployer la demo a chaque release"
```

### Task 5: Documentation d'exploitation

**Files:**
- Modify: `docs/PRODUCTION.md`, `docs/ARCHITECTURE.md`, `.claude/rules/github-actions/secrets-variables.md`

- [ ] **Step 1: PRODUCTION.md**

Charger `Skill[production-doc]`. Sections à amender (numéros de ligne relevés le 2026-10-25, à retrouver par leur titre) :
- `# 🌍 Environnements` (`:205`) : ligne « Démo web », phrases « aucun hébergement » et « pas de staging » ;
- `## Variables d'Environnement` (`:220`) : les trois secrets Dokploy dans le bloc des secrets GitHub ;
- `### Gestion des Secrets` (`:421`) et `### Rotation` (`:448`) : la clé Dokploy, actif à pouvoir de déploiement : portée relevée à la mise en place, rotation au moins annuelle et à tout soupçon de fuite, révocation côté Dokploy puis secret GitHub remplacé ;
- `## Pipelines` (`:270`) : job `demo` et job `demo-image` ;
- `## Rollback` (`:287`) : `DEMO_IMAGE` sur `…-demo:X.Y.Z`, puis Redeploy, puis retour à `latest` une fois le correctif publié ;
- `# 🔐 Sécurité & Configuration` (`:415`) : en-têtes de la démo (nginx seul, `headers.conf`, HSTS par Traefik, aucun middleware d'en-têtes sur ce domaine), isolation (Isolated Deployment, lecture seule, `cap_drop`, `pids_limit`), logs sans adresse de visiteur et leur rétention (`20m` × `5`), et l'introduction « sans objet » ;
- `## Stack Monitoring` (`:494`) et `## Alertes` (`:545`) : la sonde de disponibilité externe sur `/healthz` (même service que le portfolio, nommé par son rôle), et l'email GitHub d'un job en échec ;
- `## Checklist Release` (`:106`), bloc Manuel : avant le tag « `DEMO_IMAGE` vaut `latest` dans Dokploy » ; après le tag « démo redéployée, version affichée dans les Réglages égale au tag, parcours joué par `/verify` sans violation CSP ni requête hors origine » ;
- `## Stratégie Backup` (`:667`) : rien à sauvegarder, l'image se reconstruit depuis le tag ;
- nouvelle sous-section « Mise en place de la démo » dans § CI/CD, avec les sept étapes manuelles du spec, dans son ordre : DNS, Dokploy, secrets, première release et paquet GHCR public, vérification en ligne, sonde externe, portfolio (`?lang`, nouvel onglet, pages de contact, cookies sans `Domain=`).

- [ ] **Step 2: ARCHITECTURE.md**

Charger `Skill[architecture-doc]`. Dans § Infrastructure, l'hébergement passe de « Aucun » à « Aucun pour l'app ; démo web statique sur le VPS (Dokploy, ADR-023) ». Ajouter le job `demo` au diagramme de la chaîne de release.

- [ ] **Step 3: Rule `secrets-variables.md`**

Charger `Skill[rules-doc]`. Dans « À faire », les trois secrets Dokploy rejoignent la liste des secrets stockés. Dans « À éviter », la raison de « pas d'`environment:` » ne repose plus sur « aucun déploiement serveur ». Elle devient : un seul déploiement, déclenché par le tag, dont release-please est déjà le point de contrôle humain.

- [ ] **Step 4: Vérifier les liens et commit**

Run: `grep -n "demo-techno-tagger\|DOKPLOY_COMPOSE_ID\|healthz" docs/PRODUCTION.md | head`
Expected : les sections ci-dessus portent la démo.

```bash
git add docs/PRODUCTION.md docs/ARCHITECTURE.md .claude/rules/github-actions/secrets-variables.md
git commit -m "docs: exploitation de la demo web publique"
```

### Task 6: Mise en place et premier déploiement (propriétaire)

Étapes manuelles, à faire par le propriétaire une fois le lot fusionné. Elles sont décrites dans PRODUCTION.md (Task 5).

- [ ] **Step 1: DNS** : enregistrement `demo-techno-tagger`, de même cible que l'apex.
- [ ] **Step 2: Dokploy** :
  - projet `techno-tagger`, environment `demo` ;
  - Compose depuis GitHub, branche `main`, fichier `demo/compose.yaml`, Isolated Deployment activé, déploiement automatique coupé ;
  - Environment : `DEMO_IMAGE=<image publiée par le job demo>:latest` ;
  - Domains : `demo-techno-tagger.thibaud-geisler.com`, service `demo`, port `8080`, HTTPS Let's Encrypt, aucun middleware d'en-têtes attaché ;
  - clé d'API : noter sa portée telle que Dokploy la présente, et la reporter dans PRODUCTION.md § Gestion des Secrets.
- [ ] **Step 3: Secrets GitHub** du dépôt : `DOKPLOY_URL`, `DOKPLOY_TOKEN`, `DOKPLOY_COMPOSE_ID`.
- [ ] **Step 4: Première release** : à la fin du job `demo`, passer le paquet GHCR de la démo en public, puis relancer le job s'il a échoué au tirage.
- [ ] **Step 5: Vérifier en ligne** :

Run: `for p in / /settings /nope.js; do curl -sI "https://demo-techno-tagger.thibaud-geisler.com$p" | grep -i "^HTTP\|content-security-policy\|x-robots-tag\|strict-transport"; done && curl -fsS https://demo-techno-tagger.thibaud-geisler.com/healthz`
Expected : sur les trois URLs, la CSP égale celle de `demo/headers.conf` (Traefik ne l'a pas remplacée), `X-Robots-Tag: noindex`, HSTS posé par Traefik ; `/nope.js` en `404` ; `/healthz` à 200. La version affichée dans les Réglages de la démo égale le tag. `/verify` joue le parcours complet contre l'URL en ligne : aucune violation CSP en console, aucune requête hors de l'origine de la démo (scénario 2 du spec). Dans les devtools, aucun cookie du portfolio n'est visible sur le sous-domaine.

- [ ] **Step 6: Sonde externe** : sur le service de disponibilité déjà utilisé pour le portfolio, une sonde HTTP sur `https://demo-techno-tagger.thibaud-geisler.com/healthz`, 5 minutes, alerte email au changement d'état. Elle passe « UP ».
- [ ] **Step 7: Portfolio** (son dépôt) : le bouton « Voir la démo » pointe vers `https://demo-techno-tagger.thibaud-geisler.com/?lang=fr` ou `?lang=en` selon la langue de la page, avec `target="_blank" rel="noopener noreferrer"` ; les pages `/fr/contact` et `/en/contact` répondent ; les cookies du portfolio n'ont pas d'attribut `Domain=`. Puis, depuis le portfolio en anglais, cliquer : la démo s'ouvre en anglais dans un nouvel onglet, et « Me contacter » mène à la page de contact anglaise.
