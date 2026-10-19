---
paths:
  - "sidecar/src/tagger/__main__.py"
  - "sidecar/build.py"
  - "sidecar/src/tagger/core/observability.py"
---

# Sentry — SDK Python

## À faire
- Poser `data_collection` avec chaque catégorie fermée, `stack_frame_variables: False` compris : posée, l'option fait ignorer `include_local_variables` et collecte toute catégorie omise
- Fixer `server_name` sur une constante : sans valeur, le nom de la machine de l'utilisateur part avec chaque événement
- Laisser `send_default_pii` à son défaut : il s'agit de ne pas l'activer, pas de le régler
- Poser un `before_send` qui masque les chemins utilisateur, et l'étendre chaque fois qu'un nouveau champ transporte une donnée locale
- Masquer tout message d'exception hors de `_SAFE_MESSAGE_TYPES` et n'y ajouter un type que si son message est construit sans chemin, nom de fichier, `track_id` ni valeur reçue de l'API
- Ne passer aucune donnée sensible à `set_extra`, `set_context` ni `set_tag` : sous `data_collection`, le SDK n'installe plus son `EventScrubber`, son denylist ne s'applique plus (`client.py` de 2.71.0, lu le 2026-10-16)
- Poser la même `release` que côté Angular, préfixe compris (`techno-tagger@X.Y.Z`) : le paquet s'appelle `tagger`, et sans le préfixe `nom@` Sentry ne classe plus les versions
- Renseigner `environment` pour que les runs de développement ne consomment pas le quota des utilisateurs
- Couvrir l'appel à `init()` d'un `try/except` : une remontée d'erreurs cassée ne doit jamais empêcher l'application de démarrer
- Déclarer `pyinstaller-hooks-contrib` en dépendance de build et vérifier la présence de `hook-sentry_sdk.py`
- Provoquer une exception de test **depuis le binaire empaqueté** et confirmer son arrivée dans Sentry avant de considérer l'observabilité en place
- Tester sur l'enveloppe réellement construite (`test_sentry_payload.py`) : variables de frame, `server_name`, `data_collection` résolu

## À éviter
- Envoyer des événements métier (morceau résolu, run terminé) : le quota de 5 000 par mois se remplit et le vrai crash est jeté
- Activer `send_default_pii` pour « avoir plus de contexte »
- Ajouter un écran de consentement en croyant régler le sujet : ce qui protège est ce que le SDK envoie
- Laisser `ArgvIntegration` active si des chemins devaient un jour être passés en argument au sidecar
- Oublier `pyinstaller-hooks-contrib` : les intégrations disparaissent sans message clair

## Gotchas
- `sentry_sdk.init()` peut planter dans le binaire figé : les intégrations sont importées par `importlib.import_module` et le SDK n'intercepte que `DidNotEnable` et `SyntaxError`, pas `ImportError`
- `LoggingIntegration` est active par défaut avec `level=logging.INFO` : tout log INFO devient un breadcrumb attaché au prochain événement, chemin complet ou titre de morceau compris. `level=None` coupe les breadcrumbs
- `ModulesIntegration` envoie la liste des paquets installés à chaque event : fuite d'infrastructure, pas de donnée personnelle
- `AsyncioIntegration` n'est pas dans les intégrations par défaut, elle s'ajoute à la main
- 2.70.0 : `data_collection` passe en premier niveau ; une montée qui ajoute une catégorie la laisse ouverte, le garde-fou de `test_sentry_payload.py` la signale
- 2.68.0 : `enable_logs` et `enable_metrics` deviennent des no-op, suppression à la prochaine majeure. Les exemples 1.x sont invalides (`with_locals` renommé `include_local_variables`, API Hub remplacée par les scopes)
- Le DSN de la région EU passe par `ingest.de.sentry.io` : la résidence des données se choisit à la création de l'organisation et ne se change plus ensuite
- La suite de tests du hook PyInstaller est épinglée sur une version antérieure du SDK : le mécanisme est stable, la combinaison exacte ne l'est pas sans essai

> Ces réglages ne dispensent pas du scrubbing : ils ferment les canaux les plus larges, pas tous. La clé API ne doit apparaître dans aucun event (cf. [keyring/secrets.md](../keyring/secrets.md) et [ADR-014](../../../docs/adrs/014-observabilite-sentry-et-rgpd.md)).

## Exemples
```python
# ✅ tous les réglages posés explicitement, y compris le canal breadcrumbs
sentry_sdk.init(
    dsn=SENTRY_DSN,
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
    server_name="techno-tagger",       # sinon : nom de machine de l'utilisateur
    before_send=scrub_event,
    integrations=[LoggingIntegration(level=None, event_level=None, sentry_logs_level=None)],  # coupe les breadcrumbs de log
    auto_enabling_integrations=False,
)

# ❌ défauts laissés en place : variables locales et hostname partent avec chaque event
sentry_sdk.init(dsn=SENTRY_DSN)
```
