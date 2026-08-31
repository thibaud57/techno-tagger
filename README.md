# techno-tagger

Application desktop Windows qui extrait les morceaux d'une playlist depuis une bibliothèque musicale, puis remplace leurs métadonnées par des données propres issues de Beatport et Bandcamp.

Trois couches sur la machine de l'utilisateur, aucun serveur ni port ouvert :

| Zone | Rôle | Gestionnaire |
|---|---|---|
| `src/` | Interface Angular 22 + PrimeNG, aucune logique métier | pnpm |
| `sidecar/` | Métier complet en Python, empaqueté en binaire par PyInstaller | uv |
| `src-tauri/` | Coquille Tauri v2 : plugins, packaging, updater | cargo |

L'interface et le métier communiquent par un protocole NDJSON sur les flux standard, testable en ligne de commande sans lancer l'application.

## Démarrage

Les prérequis, l'installation et les commandes de développement sont dans le `Justfile` : `just --list` en donne l'inventaire. Tout se lance **depuis Git Bash**, le `Justfile` et les scripts pnpm passant par `bash`.

## Documentation

| Document | Contenu |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, contrat NDJSON, ADRs |
| [docs/VERSIONS.md](docs/VERSIONS.md) | Versions exactes et compatibilité croisée |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | Release, distribution, observabilité |
| [docs/DESIGN.md](docs/DESIGN.md) | Design system et mapping des composants |

## Licence

Projet personnel, sans ambition commerciale.
