# techno-tagger

Application desktop Windows qui extrait les morceaux d'une playlist depuis une bibliothèque musicale, puis remplace leurs métadonnées par des données propres issues de Beatport et Bandcamp.

Trois couches sur la machine de l'utilisateur, aucun serveur ni port ouvert :

| Zone | Rôle | Gestionnaire |
|---|---|---|
| `src/` | Interface Angular 22 + PrimeNG, aucune logique métier | pnpm |
| `sidecar/` | Métier complet en Python, empaqueté en binaire par PyInstaller | uv |
| `src-tauri/` | Coquille Tauri v2 : plugins, packaging, updater | cargo |

L'interface et le métier communiquent par un protocole NDJSON sur les flux standard, testable en ligne de commande sans lancer l'application.

## Installation

Pour utiliser l'application, sous Windows 10 ou 11 :

1. Télécharger `techno-tagger_<version>_x64-setup.exe` depuis la [dernière version publiée](https://github.com/thibaud57/techno-tagger/releases/latest).
2. Le lancer. Windows affiche « Windows a protégé votre ordinateur » : l'installeur n'est pas signé. Cliquer « Informations complémentaires », puis « Exécuter quand même ».
3. Au premier lancement, ouvrir Réglages > API et saisir la clé API reçue à part.
4. Si l'application affiche « Le moteur de l'application est introuvable », l'antivirus a mis son moteur en quarantaine : le restaurer, l'ajouter aux exclusions, puis cliquer « Réessayer ».

Les mises à jour se proposent d'elles-mêmes au lancement de l'application.

## Démarrage

Prérequis : [pnpm](https://pnpm.io/), [uv](https://docs.astral.sh/uv/), [cargo](https://www.rust-lang.org/tools/install), [just](https://github.com/casey/just) avec bash (Git Bash sous Windows, le `Justfile` et les scripts pnpm passant par `bash`) et [actionlint](https://github.com/rhysd/actionlint) (`winget install rhysd.actionlint`, requis par `just lint`). Versions exactes dans `engines` et `devEngines` de `package.json` (Node, pnpm), `required-version` de `sidecar/pyproject.toml` (uv), `rust-toolchain.toml` et `sidecar/.python-version`.

```bash
cp .env.example .env    # secrets de build, commentés dans le fichier (DSN vides = SDK Sentry inerte)
just setup              # installe les trois zones et construit le binaire du sidecar
just dev                # application complète (Angular + fenêtre Tauri)
```

`just --list` donne l'inventaire des recettes, `just check` diagnostique l'environnement.

## Documentation

| Doc | Contenu |
|---|---|
| [docs/BRAINSTORM.md](docs/BRAINSTORM.md) | Vision, périmètre, features |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, contrat NDJSON, ADRs |
| [docs/VERSIONS.md](docs/VERSIONS.md) | Versions exactes et compatibilité croisée |
| [docs/DESIGN.md](docs/DESIGN.md) | Design system et mapping des composants |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | Release, distribution, observabilité |
| [docs/adrs/](docs/adrs/) | Décisions d'architecture actées |
| [docs/knowledges/](docs/knowledges/) | Fiches techniques par librairie |
| [CHANGELOG.md](CHANGELOG.md) | Historique des versions, tenu par release-please |

## Licence

[MIT](LICENSE).
