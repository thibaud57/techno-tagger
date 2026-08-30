---
title: "Sentry — Remontée d'erreurs durcie (Python + Angular)"
version: "sentry-sdk 2.68.1 / @sentry/angular 10.72.0"
description: "Référence technique pour les deux SDK Sentry du projet : durcissement RGPD, réglages non négociables, scrubbing, corrélation de release et empaquetage PyInstaller."
date: "2026-08-29"
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

## Les trois réglages non négociables (Python)

### Description

Trois options décident de ce qui quitte la machine de l'utilisateur. Elles se testent au même titre que le reste du code.

### Exemple

```python
sentry_sdk.init(
    dsn=SENTRY_DSN,                    # o<id>.ingest.de.sentry.io → région EU
    release=APP_VERSION,               # même valeur que côté Angular
    environment="production",
    include_local_variables=False,     # défaut True : à forcer
    server_name="techno-tagger",       # défaut : nom de machine de l'utilisateur
    # send_default_pii laissé au défaut (False), ne pas l'activer
    before_send=scrub_event,
)
```

### Points Importants

- **`include_local_variables` vaut `True` par défaut** : le SDK joint alors un instantané des variables locales de chaque frame, qui contiennent les chemins complets, l'artiste et le titre en cours de traitement, et potentiellement la clé API si elle transite par une variable locale de `scraper_client.py`
- **`server_name` est auto-détecté** : sans valeur fixe, le nom de la machine part avec chaque événement
- **`send_default_pii` est déjà à `False`** : il s'agit de ne pas l'activer, pas de le régler
- Le DSN de la région EU passe par `ingest.de.sentry.io` : la résidence des données se choisit à la création de l'organisation et ne se change pas ensuite
- Ces trois réglages **ne dispensent pas du scrubbing** : ils ferment les canaux les plus larges, pas tous

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

---

## SDK Angular

### Description

Initialisation dans `main.ts` avant le bootstrap, gestionnaire d'erreurs fourni dans `app.config.ts`.

### Exemple

```typescript
// main.ts
Sentry.init({
  dsn: environment.sentryDsn,
  release: environment.appVersion,      // identique au sidecar
  environment: 'production',
  sendDefaultPii: false,
  integrations: (defaults) =>
    defaults.filter((i) => i.name !== 'Breadcrumbs' && i.name !== 'Replay'),
});

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
- **`Breadcrumbs` capture les interactions et le contenu de la console**, donc des noms de morceaux affichés à l'écran ; **`Replay` capture le DOM**. Les deux sont à retirer, pas à régler
- `sendDefaultPii` est déjà `false` par défaut côté JavaScript, contrairement à Python où le défaut documenté est `None`
- La `peerDependency` couvre `@angular/core >= 14.x <= 22.x`
- Les source maps se génèrent en mode `hidden`, s'uploadent vers Sentry et **ne sont pas livrées dans le bundle** distribué

---

## Corréler les deux SDK par la release

### Description

Deux SDK, deux projets Sentry, mais une seule version distribuée. La même valeur de `release` des deux côtés permet de croiser une erreur de webview et une erreur de sidecar sur la même livraison.

### Exemple

```
release = "1.4.2"   # version produite par release-please, identique partout
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
- **Vérifier la remontée depuis le binaire empaqueté**, pas seulement en développement : provoquer une exception de test et confirmer son arrivée dans Sentry
- La suite de tests du hook est épinglée sur une version antérieure du SDK : le mécanisme est stable, la combinaison exacte n'est pas garantie sans essai

---

## Ce qui ne passe jamais par Sentry

### Description

Un seul canal fait sortir des titres de morceaux de la machine, et il est explicite : le bouton « envoyer ce rapport » de l'écran final.

### Points Importants

- **Le bouton ouvre une issue pré-remplie dans le navigateur** via le plugin `opener`, que l'utilisateur relit, ampute ou abandonne avant de valider. L'application ne pousse rien elle-même
- Ce canal ne consomme pas le quota Sentry et reste le canal d'amélioration du matching
- La règle « HTTPS vers techno-scraper, Sentry et GitHub uniquement » reste donc vraie
- **La clé API ne doit apparaître dans aucun event** : c'est ce que `include_local_variables=False` garantit en premier lieu
- Les logs locaux (`tagger.log`, rotation à 5 Mo, 3 sauvegardes) restent sur la machine et se récupèrent par le bouton « ouvrir le dossier de logs »

---

# Bonnes Pratiques

## ✅ Recommandations

- **Tester les trois réglages Python comme du code métier** : un test qui construit un event et vérifie l'absence de variables locales et de nom de machine
- **Retirer `Breadcrumbs` et `Replay` côté Angular**, plutôt que d'essayer de les filtrer après coup
- **Poser la même `release` des deux côtés**, alimentée par la version que release-please synchronise
- **Provoquer une erreur de test depuis le binaire empaqueté** avant de considérer l'observabilité en place
- **Garder `before_send` centré sur les chemins**, et l'étendre chaque fois qu'un nouveau champ transporte une donnée locale
- **Réserver Sentry aux erreurs techniques** : le quota de 5 000 par mois est un budget, pas un plafond théorique

## ❌ Anti-Patterns

- **Laisser `include_local_variables` à son défaut** : c'est la fuite la plus large, et elle est silencieuse
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

- [ADR-014 — Observabilité Sentry et RGPD](../adrs/014-observabilite-sentry-et-rgpd.md)
- [hook-sentry_sdk.py](https://github.com/pyinstaller/pyinstaller-hooks-contrib/blob/master/_pyinstaller_hooks_contrib/stdhooks/hook-sentry_sdk.py)
- [pyinstaller.md](pyinstaller.md) — hooks et imports dynamiques
