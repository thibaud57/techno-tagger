---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python : fichiers, JSON et dates

## À faire
- `encoding="utf-8"` explicite à chaque `open()`, `read_text()` et `write_text()` : la cible est Windows, dont la locale par défaut est `cp1252`
- `mkdir(parents=True, exist_ok=True)` et `unlink(missing_ok=True)` pour les créations et suppressions (PTH impose déjà `pathlib`)
- Émettre chaque événement NDJSON sur une seule ligne (`model_dump_json()`, ou `json.dumps` sans `indent`), vidée par le `line_buffering=True` posé sur `stdout` au démarrage, pas par des `flush()` (cf. [ADR-005](../../../docs/adrs/005-sidecar-python-protocole-ndjson.md))
- `ensure_ascii=False` pour les rapports JSON lisibles, `sort_keys=True` quand un rendu déterministe est attendu
- `isoformat()` pour produire un horodatage, `fromisoformat()` pour le relire (DTZ impose déjà `datetime.now(UTC)`)
- Lire la configuration d'environnement par `os.getenv(clé, défaut)` avec cast explicite et `os.environ[clé]` quand l'absence doit être fatale

## À éviter
- Concaténer des chemins en chaînes
- Écrire un diagnostic sur `stdout`, réservé au flux NDJSON : `stderr` et le fichier de log pour tout le reste
- `f.readlines()` sur un fichier volumineux : le fichier s'itère ligne par ligne

## Gotchas
- Un `datetime` naive et un aware ne se comparent ni ne se soustraient : `TypeError` à l'exécution
- Chemins longs Windows : au-delà de la limite historique l'écriture échoue, motif `path_too_long` (cf. [ARCHITECTURE.md § Robustesse](../../../docs/ARCHITECTURE.md#%EF%B8%8F-robustesse--modes-de-panne)). `extended_path` (préfixe `\\?\`) s'applique une seule fois, à la frontière d'I/O : `files.py` pour les tags, `renaming` et `rollback` pour leurs propres accès disque, jamais par chaque appelant
- Toute IO fichier reste bloquante : la passer par `asyncio.to_thread` dans du code async
- 3.14 : `Path.copy()`, `Path.move()` et leurs variantes `copy_into()` / `move_into()` couvrent la copie d'arborescence sans importer `shutil`
- 3.14 : les `Path` rendus par `iterdir()` portent un `Path.info` pré-rempli quand l'OS le fournit, qui évite un `stat()` par entrée
- Les rapports et les logs écrits sur le disque sont en anglais, indépendamment de la langue de l'interface

## Exemples
```python
# ✅
plan_path = data_dir / "runs" / f"{run_id}.json"
plan_path.parent.mkdir(parents=True, exist_ok=True)
plan_path.write_text(json.dumps(plan, ensure_ascii=False, sort_keys=True), encoding="utf-8")

sys.stdout.reconfigure(line_buffering=True)  # une fois, au démarrage
sys.stdout.write(json.dumps(event) + "\n")   # une ligne = un événement, vidée par le \n

# ❌ encodage implicite, indent sur le flux
plan_path.write_text(json.dumps(plan, indent=2))
```
