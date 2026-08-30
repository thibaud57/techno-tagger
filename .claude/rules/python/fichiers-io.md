---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python Fichiers, JSON & Dates — Règles

## À faire
- `encoding="utf-8"` explicite à chaque `open()`, `read_text()` et `write_text()` : la cible est Windows, dont la locale par défaut est `cp1252`
- `pathlib.Path` et l'opérateur `/` pour tout chemin, `mkdir(parents=True, exist_ok=True)` et `unlink(missing_ok=True)` pour les créations et suppressions
- Émettre chaque événement NDJSON sur une seule ligne, `model_dump_json()` pour les modèles du protocole et `json.dumps` sans `indent` ailleurs, suivie d'un flush
- `ensure_ascii=False` pour les rapports JSON lisibles, `sort_keys=True` quand un rendu déterministe est attendu
- `default=` et `object_hook=` pour sérialiser et relire les types non natifs
- `datetime.now(UTC)` et `isoformat()` pour produire, `fromisoformat()` pour relire
- Lire la configuration d'environnement par `os.getenv(clé, défaut)` avec cast explicite, et `os.environ[clé]` quand l'absence doit être fatale

## À éviter
- Concaténer des chemins en chaînes, ou passer par `os.path` dans du code neuf
- Écrire un diagnostic sur `stdout`, réservé au flux NDJSON — `stderr` et le fichier de log pour tout le reste
- `datetime.utcnow()` et `utcfromtimestamp()` : dépréciés depuis 3.12, ils retournent un naive
- Un chemin temporaire en dur : `tempfile.TemporaryDirectory` en code, `tmp_path` en test
- `f.readlines()` sur un fichier volumineux — le fichier s'itère ligne par ligne

## Gotchas
- Un `datetime` naive et un aware ne se comparent ni ne se soustraient : `TypeError` à l'exécution
- Chemins longs Windows : au-delà de la limite historique l'écriture échoue, motif `path_too_long` (cf. [ARCHITECTURE.md § Robustesse](../../../docs/ARCHITECTURE.md#-robustesse--modes-de-panne))
- Toute IO fichier reste bloquante : la passer par `asyncio.to_thread` dans du code async
- 3.14 : `Path.copy()` et `Path.move()` couvrent la copie d'arborescence sans importer `shutil`
- Les rapports et les logs écrits sur le disque sont en anglais, indépendamment de la langue de l'interface

## Exemples
```python
# ✅
plan_path = data_dir / "runs" / f"{run_id}.json"
plan_path.parent.mkdir(parents=True, exist_ok=True)
plan_path.write_text(json.dumps(plan, ensure_ascii=False, sort_keys=True), encoding="utf-8")

sys.stdout.write(json.dumps(event) + "\n")   # une ligne = un événement
sys.stdout.flush()

# ❌ encodage implicite, indent sur le flux, horodatage naive
plan_path.write_text(json.dumps(plan, indent=2))
created_at = datetime.utcnow()
```
