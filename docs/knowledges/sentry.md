---
title: "Sentry — Remontée d'erreurs durcie (Python + Angular)"
version: "sentry-sdk 2.71.0 / @sentry/angular 11.9.0"
description: "Référence technique pour les deux SDK Sentry du projet : durcissement RGPD, réglages non négociables, scrubbing, corrélation de release et empaquetage PyInstaller."
date: "2026-10-18"
keywords: ["sentry", "rgpd", "scrubbing", "observabilite", "angular", "python", "pyinstaller"]
scope: ["docs"]
technologies: ["Python", "Angular", "Tauri", "PyInstaller"]
---

# Description

Deux SDK dans une même application : `@sentry/angular` pour les erreurs de la webview, `sentry-sdk` pour celles du sidecar. **Erreurs techniques uniquement** : sidecar qui tombe, API injoignable, parsing cassé. Aucun événement métier (cf. [ADR-014](../adrs/014-observabilite-sentry-et-rgpd.md)).

Plan Developer gratuit, région EU, plafonné à 5 000 erreurs par mois, **les suivantes étant jetées silencieusement**. C'est la raison de fond du durcissement : noyer les crashs sous de la télémétrie fait perdre le vrai bug quand il arrive.

**Sentry est actif d'office, sans écran de consentement.** Sur un outil personnel partagé entre amis, une case à cocher ne protège rien ; ce qui protège, c'est ce que le SDK a le droit d'envoyer.

---

# Concepts Clés

## Durcissement du SDK Python

### Description

Trois réglages décident de ce qui quitte la machine de l'utilisateur : `data_collection` fermé catégorie par catégorie, `server_name` fixe et un `before_send` qui masque. Ils se testent au même titre que le reste du code.

### Exemple

```python
sentry_sdk.init(
    dsn=SENTRY_DSN,                    # o<id>.ingest.de.sentry.io → région EU
    release=RELEASE,                   # f"{APP_NAME}@{__version__}", identique côté Angular
    environment="production",
    data_collection={                  # posée : toute catégorie omise est collectée
        "user_info": False,
        "cookies": {"mode": "off"},
        "http_headers": {"request": {"mode": "off"}},
        "http_bodies": [],
        "url_query_params": {"mode": "off"},
        "graphql": {"document": False, "variables": False},
        "gen_ai": {"inputs": False, "outputs": False},
        "database_query_data": False,
        "queues": False,
        "stack_frame_variables": False,  # variables de frame : chemins, titres, clé API
    },
    server_name="techno-tagger",       # défaut : nom de machine de l'utilisateur
    before_send=scrub_event,
)
```

### Points Importants

- **`data_collection` remplace `send_default_pii` depuis la 2.70.0 et ferme chaque catégorie une à une** : `user_info`, `cookies`, `http_headers`, `http_bodies`, `url_query_params`, `graphql`, `gen_ai`, `database_query_data`, `queues` et `stack_frame_variables`. Une catégorie omise est collectée. `stack_frame_variables` joint un instantané des variables locales de chaque frame, qui contiennent les chemins complets, l'artiste et le titre en cours de traitement voire la clé API si elle transite par une variable locale de `scraper_client.py`
- **`include_local_variables` est ignoré dès que `data_collection` est posé** (2.70.0 et suivantes, vérifié le 2026-10-15) : le passer à `False` à côté ne ferme rien puisque sa valeur d'origine (`True`) ne compte plus. Seul `stack_frame_variables` décide
- **L'`EventScrubber` par défaut du SDK n'est pas installé sous `data_collection`** (`client.py` de 2.71.0, lu le 2026-10-16) : son denylist (`api_key`, `secret`, `token`, `password`...) ne s'applique plus aux champs libres. Aucune donnée sensible dans `set_extra`, `set_context` ni `set_tag` puisque `before_send` n'a aucun moyen de la reconnaître
- **Une montée du SDK qui ajoute une catégorie la laisse ouverte** : un test lit la configuration résolue et casse dans ce cas (`sidecar/tests/unit/core/test_sentry_payload.py`)
- **`server_name` est auto-détecté** : sans valeur fixe, le nom de la machine part avec chaque événement
- **`send_default_pii` a pour défaut `None`** (vérifié dans `sentry_sdk.consts.DEFAULT_OPTIONS`) : il ne s'active pas ; posé à côté de `data_collection`, le SDK l'ignore en émettant un `DeprecationWarning`. Le SDK JavaScript, lui, n'a plus cette option depuis la v11 (cf. § SDK Angular)
- **`LoggingIntegration` est active par défaut avec `level=logging.INFO`** : tout log INFO devient un breadcrumb attaché au prochain événement, chemin complet ou titre de morceau compris. `level=None` la neutralise ; `auto_enabling_integrations=False` empêche toute autre intégration implicite de se réactiver dans son dos
- Le DSN de la région EU passe par `ingest.de.sentry.io` : la résidence des données se choisit à la création de l'organisation et ne se change pas ensuite
- Ces réglages **ne dispensent pas du scrubbing** : ils ferment les canaux les plus larges, pas tous

---

## Scrubbing par `before_send`

### Description

Dernier filet avant l'envoi. Les chemins de fichiers contiennent le nom d'utilisateur de l'OS, y compris dans les frames de la stack.

### Exemple

```python
import re

USER_PATH = re.compile(r"[A-Za-z]:\\Users\\[^\\\\]+", re.IGNORECASE)

def scrub_event(event: dict, hint: dict) -> dict | None:
    serialized = json.dumps(event)
    return json.loads(USER_PATH.sub(r"<user>", serialized))
```

### Points Importants

- **`before_send` reçoit l'event déjà enrichi par le scope** : c'est le bon endroit, après les intégrations et avant l'envoi
- Rendre `None` annule l'envoi : utile pour filtrer une classe d'erreurs entière
- **L'URL complète et la query string des requêtes sont toujours envoyées**, indépendamment de `send_default_pii` : sans objet ici, le sidecar n'exposant aucun serveur HTTP, mais à revérifier si cela changeait
- **`ArgvIntegration` est active par défaut et attache `sys.argv`** : à désactiver si des chemins devaient un jour être passés en argument au sidecar
- `ModulesIntegration` envoie la liste des paquets installés à chaque event : fuite d'infrastructure, pas de donnée personnelle
- **Le message d'une exception part en `<message>` hors d'une liste fermée de types** (`_SAFE_MESSAGE_TYPES`) : les messages du sidecar portent le nom du fichier ou le `track_id` et la `ValidationError` de pydantic la valeur reçue, qu'aucun motif ne reconnaît dans du texte libre. Un type n'entre dans la liste que si son message est construit sans chemin, nom de fichier, `track_id` ni valeur reçue de l'API
- **Le motif de chemin est sensible aux guillemets** : `repr()` entoure de `"` un chemin qui contient une apostrophe (`Don't Stop.mp3`) et de `'` les autres, donc un chemin ouvert par un guillemet court jusqu'au guillemet fermant : un nom à apostrophe est masqué en entier dans ces deux formes. Résidu accepté (constaté sur le motif au 2026-10-18) : un chemin ouvert par `'` sans guillemet fermant, au nom à apostrophe (`open 'D:\Music\Nova Pulse - Don't Stop.mp3 failed`), laisse la fin du nom après la dernière apostrophe (`t Stop.mp3 failed`). `repr()` n'écrit jamais ce cas et tout message d'exception hors de la liste fermée part en `<message>` de toute façon

---

## SDK Angular

### Description

Initialisation dans `main.ts` avant le bootstrap, gestionnaire d'erreurs fourni dans `app.config.ts`.

### Exemple

```typescript
// core/observability/sentry-options.ts, appelé par main.ts avant le bootstrap
const PRIVATE_INTEGRATIONS = new Set(['Breadcrumbs', 'Console', 'Replay', 'CultureContext']);

export const sentryOptions = (dsn: string, release: string, environment: string): BrowserOptions => ({
  dsn,                                      // constantes `define` d'esbuild, pas d'environment.ts
  release,                                  // `${APP_NAME}@${APP_VERSION}`, identique au sidecar
  environment,
  integrations: (defaults) => defaults.filter((i) => !PRIVATE_INTEGRATIONS.has(i.name)),
  dataCollection: {
    userInfo: false,                        // sinon `infer_ip: auto` : Sentry déduit l'IP
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
  beforeSend: scrub,
});

// main.ts
Sentry.init(sentryOptions(SENTRY_DSN_UI, `${APP_NAME}@${APP_VERSION}`, APP_ENVIRONMENT));
bootstrapApplication(AppComponent, appConfig);
```

```typescript
// app.config.ts
providers: [
  { provide: ErrorHandler, useValue: Sentry.createErrorHandler({ showDialog: false, logErrors: true }) },
]
```

### Points Importants

- **`createErrorHandler()` est la seule fabrique exposée**, à brancher par `{ provide: ErrorHandler, useValue: ... }`. Il n'existe aucun `provideErrorHandler()` : vérifié dans `@sentry/angular` 10.72.0, qui n'exporte que `createErrorHandler` et `SentryErrorHandler`, et confirmé par la doc officielle
- **`Breadcrumbs` capture les interactions et `Console` le contenu de la console**, donc des noms de morceaux affichés à l'écran ; **`Replay` capture le DOM** ; **`CultureContext` envoie la locale, le calendrier et le fuseau horaire** de l'utilisateur. Les quatre sont à retirer, pas à régler. `Console` est une intégration à part depuis la v11 : un filtre écrit pour la v10 la laisse passer
- **Sentry 11 remplace `sendDefaultPii` par `dataCollection`, et l'option absente collecte tout** : IP inférée (`userInfo`), cookies, en-têtes, corps HTTP, paramètres d'URL. Chaque catégorie se ferme explicitement. Mesuré le 2026-10-02 sur l'événement envoyé : avec la config v10, `sdk.settings.infer_ip` vaut `auto` et une ligne de console part en breadcrumb ; avec `dataCollection` fermé et `Console` retirée, `never` et aucun breadcrumb de console
- La `peerDependency` couvre `@angular/core >= 14.x <= 22.x`, inchangée en 11.6.0
- **Une montée mineure peut ajouter une catégorie à `dataCollection`**, ouverte par défaut comme les autres : `sentry-options.ts` type l'objet `satisfies ClosedDataCollection` (toutes les catégories requises, `frameContextLines` exceptée), donc la catégorie ajoutée casse `tsc` (constaté le 2026-10-19 en retirant `queues`). La fermer à cet endroit
- 11.5 : `Sentry.init()` avertit si un client est déjà actif, et `close()` délie le client qu'il ferme (`getClient()` rend alors `undefined`)
- Les source maps se génèrent en mode `hidden`, s'uploadent vers Sentry et **ne sont pas livrées dans le bundle** distribué

---

## Corréler les deux SDK par la release

### Description

Deux SDK, deux projets Sentry, mais une seule version distribuée. La même valeur de `release` des deux côtés permet de croiser une erreur de webview et une erreur de sidecar sur la même livraison.

### Exemple

```
release = "techno-tagger@1.4.2"   # préfixe + version release-please, identique des deux côtés
```

### Points Importants

- La valeur vient de la version de l'application, celle que release-please synchronise entre `package.json`, `Cargo.toml`, `tauri.conf.json` et `pyproject.toml` (cf. [release-please.md](release-please.md))
- Sans `release`, une erreur ne se rattache à aucune version : le diagnostic à distance chez un utilisateur devient une devinette
- `environment` distingue les runs de développement de ceux des utilisateurs, ce qui évite de consommer le quota avec ses propres essais

---

## Empaquetage PyInstaller

### Description

`sentry-sdk` charge ses intégrations par `importlib`, invisible à l'analyse statique.

### Exemple

```
# Dépendance de build à déclarer explicitement
pyinstaller-hooks-contrib
```

### Points Importants

- **Le hook `hook-sentry_sdk.py` de `pyinstaller-hooks-contrib` est indispensable** : il introspecte les intégrations activées par défaut et les ajoute aux imports cachés
- Sans lui, les intégrations sont désactivées silencieusement ou lèvent une `ImportError` au démarrage selon la version
- **Vérifier la remontée depuis l'application installée** par `TECHNO_TAGGER_SENTRY_SELFTEST=1` (PRODUCTION.md § Observabilité) avant de considérer l'observabilité en place
- La suite de tests du hook est épinglée sur une version antérieure du SDK : le mécanisme est stable, la combinaison exacte n'est pas garantie sans essai

---

## Ce qui ne passe jamais par Sentry

### Description

Un seul canal fait sortir des titres de morceaux de la machine, et il est explicite : le bouton « envoyer ce rapport » de l'écran final.

### Exemple

```typescript
import { open } from '@tauri-apps/plugin-opener';

async function sendReport(trackTitle: string, matchId: string): Promise<void> {
  const body = encodeURIComponent(`Titre : ${trackTitle}\nMatch : ${matchId}`);
  await open(`https://github.com/<org>/techno-tagger/issues/new?body=${body}`);
}
```

### Points Importants

- **Le bouton ouvre une issue pré-remplie dans le navigateur** via le plugin `opener`, que l'utilisateur relit, ampute ou abandonne avant de valider. L'application ne pousse rien elle-même
- Ce canal ne consomme pas le quota Sentry et reste le canal d'amélioration du matching
- La règle « HTTPS vers techno-scraper, Sentry et GitHub uniquement » reste donc vraie
- **La clé API ne doit apparaître dans aucun event** : c'est ce que `stack_frame_variables: False` garantit en premier lieu
- Les logs locaux (`tagger.log`, rotation à 5 Mo, 3 sauvegardes) restent sur la machine et se récupèrent par le bouton « ouvrir le dossier de logs »

---

# Commandes Clés

## Upload des source maps

### Description

Après le build Angular, avant que `tauri build` n'embarque `frontendDist` : les source maps de la webview partent vers Sentry puis sont détruites localement, pour qu'aucune ne se retrouve dans l'installeur.

### Syntaxe

```bash
sentry-cli sourcemaps upload \
  --org "$SENTRY_ORG" \
  --project "$SENTRY_PROJECT_UI" \
  --release "techno-tagger@$npm_package_version" \
  dist/techno-tagger-ui/browser

find dist/techno-tagger-ui/browser -name '*.map' -delete
```

### Points Importants

- **Le script `sourcemaps` de `package.json` enchaîne les deux étapes**, appelé par `pnpm build` : upload conditionné à `SENTRY_AUTH_TOKEN`, suppression des `.map` systématique ensuite, token présent ou non
- **La configuration `production` génère les maps en mode `hidden`** (`sourceMap: { hidden: true }`) : produites pour l'upload, sans commentaire `sourceMappingURL` qui les exposerait dans le bundle livré
- **Sentry résout la stack par les Debug IDs qu'`@angular/build` injecte**, pas par le chemin des fichiers : la release et l'org/projet identifient le bon jeu de maps
- Une map oubliée dans `dist/` finit dans l'installeur : `tauri-codegen` n'écarte aucune extension au moment d'embarquer `frontendDist`

---

# Bonnes Pratiques

## ✅ Recommandations

- **Tester le durcissement Python sur l'enveloppe réellement construite** : variables de frame absentes, `server_name` fixe, `data_collection` résolu entièrement fermé
- **Retirer `Breadcrumbs` et `Replay` côté Angular**, plutôt que d'essayer de les filtrer après coup
- **Poser la même `release` des deux côtés**, alimentée par la version que release-please synchronise
- **Vérifier la remontée depuis l'application installée** par `TECHNO_TAGGER_SENTRY_SELFTEST=1` (PRODUCTION.md § Observabilité) avant de considérer l'observabilité en place
- **Garder `before_send` centré sur les chemins**, et l'étendre chaque fois qu'un nouveau champ transporte une donnée locale
- **Réserver Sentry aux erreurs techniques** : le quota de 5 000 par mois est un budget, pas un plafond théorique

## ❌ Anti-Patterns

- **Poser `data_collection` sans fermer `stack_frame_variables`** : l'option rouvre alors les variables de frame, en silence
- **Laisser `server_name` auto-détecté** : le nom de la machine de l'utilisateur part avec chaque event
- **Activer `send_default_pii`** pour « avoir plus de contexte »
- **Envoyer des événements métier** (morceau résolu, run terminé) : le quota se remplit et le vrai crash est jeté
- **Ajouter un écran de consentement** en croyant régler le sujet : ce qui protège est ce que le SDK envoie, pas une case cochée
- **Oublier `pyinstaller-hooks-contrib`** : les intégrations disparaissent sans message clair
- **Livrer les source maps dans le bundle** : elles vont chez Sentry, pas chez l'utilisateur

---

# 🔗 Ressources

## Documentation Officielle

- [Sentry Python](https://docs.sentry.io/platforms/python/) · [Options](https://docs.sentry.io/platforms/python/configuration/options/) · [Données collectées](https://docs.sentry.io/platforms/python/data-management/data-collected/)
- [Sentry Angular](https://docs.sentry.io/platforms/javascript/guides/angular/) · [Error Handler](https://docs.sentry.io/platforms/javascript/guides/angular/features/error-handler/)
- [Données sensibles (JavaScript)](https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/)
- [Région EU](https://sentry.zendesk.com/hc/en-us/articles/25074658211227-About-Sentry-s-EU-Region)

## Ressources Complémentaires

- [ADR-014 : Observabilité Sentry et RGPD](../adrs/014-observabilite-sentry-et-rgpd.md)
- [hook-sentry_sdk.py](https://github.com/pyinstaller/pyinstaller-hooks-contrib/blob/master/_pyinstaller_hooks_contrib/stdhooks/hook-sentry_sdk.py)
- [pyinstaller.md](pyinstaller.md) : hooks et imports dynamiques
