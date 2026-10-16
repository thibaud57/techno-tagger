# Contrat NDJSON des Réglages : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer à l'interface, par le protocole NDJSON, le vidage et la taille du cache disque, les seuils de matching par défaut et le fichier de logs du sidecar.

**Architecture:** Trois tâches, chacune livrant ensemble le Python et son miroir TypeScript :
- la mesure et le vidage du cache, purs, dans `resolution/cache.py` ;
- deux champs de l'événement `version` (`default_thresholds`, `log_file`), `log_dir()` passant dans `core/paths.py` ;
- les commandes `get_cache_size` et `clear_cache`, leurs événements, le garde `run_not_written` porté par `CurrentRun.awaits_write` et `_Session.clear_cache`.

`SidecarService` expose les nouveaux signaux sans écran : les rangées arrivent avec les sub-projects 03 et 04.

**Tech Stack:** Python 3.14, pydantic 2, pytest + pytest-asyncio ; TypeScript, Angular 22, Vitest. Helpers `ndjson_loop` (`drive`, `conversation`, `resolved_run`, `written_run`, `start_command`), `stubs.raising`, fixtures `app_data`, `_key`, `folder`, `api`.

**Spec:** `docs/superpowers/specs/settings/01-protocole-ndjson-reglages-design.md`

## Global Constraints

- **Noms du contrat, figés** :
  - commandes : `get_cache_size`, `clear_cache`, sans champ ;
  - événements : `cache_size { size_bytes }`, `cache_cleared { freed_bytes, size_bytes }` ;
  - champs de `version` : `default_thresholds` (`ThresholdsPayload`), `log_file` (chemin de `tagger.log`) ;
  - code d'erreur `run_not_written`, sans params.
- **Commandes** : `extra="forbid"`, `strict=True` (classe `Command`). **Événements** : `frozen` (classe `Event`). Jamais de phrase émise, seulement `code` et `params`.
- **Une valeur, une source** : les seuils par défaut viennent de `DEFAULT_THRESHOLDS`, le fichier de logs de `log_dir()` et `LOG_FILE_NAME`. Aucun 70, 90 ni nom de fichier de logs écrit côté TypeScript, fixtures comprises (valeurs fictives distinctes dans les tests).
- **`clear_cache`** : `phase_busy` pendant une phase longue, puis `run_not_written` si le run courant n'est pas confirmé ou garde un `write_error`. Plans, dumps, rapports et logs jamais touchés.
- **Miroir TS** : chaque champ, commande ou événement ajouté côté Python l'est côté TS dans la même tâche et le même commit, stub et specs compris.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement. Commentaires TypeScript sans accents, comme le code existant.
- **Tests** : noms en anglais, AAA (l'Act est l'appel testé), `@pytest.mark.asyncio` et `_key` sur les tests NDJSON qui lancent un run. Aucun test de plomberie Pydantic ou de TypeScript (no-lib-test).
- **Gate vert à chaque commit** :
  - `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar` ;
  - plus `just lint-ui && just typecheck-ui && just test-ui` quand le TS ou un JSON de langue change.

  Commits `type(scope): description`, scope `cache` ou `settings`.

## Review Focus

- **Double clic sur « Vider le cache »** : le second `clear_cache` rend zéro libéré, zéro restant, sans erreur (Task 3, `test_clears_an_already_empty_cache_without_error`).
- **Run interrompu par `cancel_run` en pleine phase réseau** : il reste courant et non confirmé, le vidage est refusé (Task 3, `test_refuses_to_clear_the_cache_of_a_cancelled_run`).
- **Nouveau run après un vidage** : les dossiers du cache sont recréés et la phase réseau va au bout (Task 3, `test_clears_the_cache_of_a_written_run_and_runs_again`).
- **Premier lancement, cache jamais créé** : mesure et vidage rendent zéro sans lever (Task 1, `test_measures_an_absent_cache_as_empty`, `test_clears_an_absent_cache_without_error`).
- **Fichier tenu ouvert par un antivirus** : il reste, compte dans ce qui reste, et le vidage ne lève pas (Task 1, `test_keeps_a_file_that_resists_deletion_and_counts_it`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/resolution/cache.py` | `cache_dir`, `ClearedCache`, `cache_size`, `clear_cache` |
| `sidecar/src/tagger/core/paths.py` | `log_dir`, déplacé depuis `__main__.py` |
| `sidecar/src/tagger/core/logger.py` | `LOG_FILE_NAME`, nom du fichier tournant |
| `sidecar/src/tagger/protocol.py` | `Version.default_thresholds`, `Version.log_file`, `GetCacheSize`, `ClearCache`, `CacheSize`, `CacheCleared`, unions |
| `sidecar/src/tagger/handlers.py` | `handle_get_version`, `handle_get_cache_size`, `handle_clear_cache`, `CurrentRun.awaits_write`, `_cache_dir` |
| `sidecar/src/tagger/__main__.py` | `RunNotWrittenError`, `_Session.clear_cache`, dispatch |
| `public/i18n/{fr,en}.json` | `errors.run_not_written` |
| `sidecar/tests/unit/resolution/test_cache_disk.py` | Mesure et vidage |
| `sidecar/tests/unit/core/test_paths.py`, `sidecar/tests/unit/test_main.py` | Garde du dossier de logs, déplacé |
| `sidecar/tests/unit/test_protocol_models.py` | Littéral `Version` |
| `sidecar/tests/integration/test_ndjson_settings.py` | Contrat de bout en bout |
| `src/app/core/sidecar/protocol.ts` | Miroir TS |
| `src/app/core/sidecar/sidecar.service.ts` | Signaux, méthodes, routage |
| `src/app/core/sidecar/sidecar.service.spec.ts` | Helper `versionEvent`, envoi, routage |
| `src/fixtures/sidecar-stub.ts` | Nouveaux membres publics |
| `docs/ARCHITECTURE.md` | Contrat |

---

### Task 1: Mesure et vidage du cache

**Files:**
- Modify: `sidecar/src/tagger/resolution/cache.py`
- Modify: `sidecar/src/tagger/handlers.py` (`_cache_dir`, import de `app_data_dir`)
- Test: `sidecar/tests/unit/resolution/test_cache_disk.py`

**Interfaces:**
- Consumes: `tagger.core.paths.app_data_dir() -> Path`, helpers privés `_size_of` et `_unlink` de `cache.py`.
- Produces :
  - `cache_dir() -> Path` (`app_data_dir() / "cache"`) ;
  - `class ClearedCache(NamedTuple)` : `freed_bytes: int`, `size_bytes: int` ;
  - `cache_size(root: Path) -> int` ;
  - `clear_cache(root: Path) -> ClearedCache`.

- [ ] **Step 1: Écrire les tests**

Dans `sidecar/tests/unit/resolution/test_cache_disk.py`, remplacer l'import de `tagger.resolution.cache` par :

```python
from tagger.resolution.cache import (
    ClearedCache,
    DiskCache,
    ResponseCache,
    cache_size,
    clear_cache,
    response_key,
)
```

Ajouter après le helper `_files` :

```python
def _fill(root: Path) -> None:
    """Une reponse et une pochette, de tailles distinctes : la somme prouve les deux dossiers."""
    (root / "responses").mkdir(parents=True)
    (root / "artworks").mkdir()
    (root / "responses" / "a.json").write_bytes(TEN_BYTES)
    (root / "artworks" / "b.jpg").write_bytes(TEN_BYTES * 2)
```

Puis, en fin de fichier :

```python
def test_measures_the_files_of_every_cache_folder(tmp_path: Path) -> None:
    _fill(tmp_path)

    size = cache_size(tmp_path)

    assert size == 30


def test_measures_an_absent_cache_as_empty(tmp_path: Path) -> None:
    size = cache_size(tmp_path / "missing")

    assert size == 0


def test_clears_every_file_and_keeps_the_folders(tmp_path: Path) -> None:
    _fill(tmp_path)

    cleared = clear_cache(tmp_path)

    assert cleared == ClearedCache(freed_bytes=30, size_bytes=0)
    assert _files(tmp_path / "responses") == []
    assert _files(tmp_path / "artworks") == []


def test_clears_an_absent_cache_without_error(tmp_path: Path) -> None:
    cleared = clear_cache(tmp_path / "missing")

    assert cleared == ClearedCache(freed_bytes=0, size_bytes=0)


def test_keeps_a_file_that_resists_deletion_and_counts_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sous Windows, un antivirus qui tient un fichier ouvert fait echouer `unlink`."""
    _fill(tmp_path)
    monkeypatch.setattr(
        "pathlib.Path.unlink", raising(PermissionError(13, "locked by another process"))
    )

    cleared = clear_cache(tmp_path)

    assert cleared == ClearedCache(freed_bytes=0, size_bytes=30)
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd sidecar && uv run pytest tests/unit/resolution/test_cache_disk.py -x -q`
Expected: FAIL à la collecte, `ImportError: cannot import name 'ClearedCache'`.

- [ ] **Step 3: Implémenter**

Dans `sidecar/src/tagger/resolution/cache.py`, ajouter l'import après `from tagger.core.errors import TaggerError` :

```python
from tagger.core.paths import app_data_dir
```

Ajouter après `class PendingWrite` :

```python
class ClearedCache(NamedTuple):
    """Octets supprimes, puis ceux qui restent : un fichier verrouille survit au vidage."""

    freed_bytes: int
    size_bytes: int


def cache_dir() -> Path:
    return app_data_dir() / "cache"


def cache_size(root: Path) -> int:
    """Taille des fichiers sous `root`, sous-dossiers compris ; zero sans dossier."""
    return sum(_size_of(path) for path in _cached_files(root))


def clear_cache(root: Path) -> ClearedCache:
    """Supprime chaque fichier sous `root`. Les dossiers restent : `DiskCache.begin` les
    recree de toute facon, et le scope de l'asset protocol vise un chemin, pas un dossier.

    Un fichier qui resiste (antivirus sous Windows) reste en place et compte dans ce qui
    reste : `_unlink` le journalise sans lever.
    """
    freed = 0
    for path in _cached_files(root):
        size = _size_of(path)
        if _unlink(path):
            freed += size
    return ClearedCache(freed_bytes=freed, size_bytes=cache_size(root))


def _cached_files(root: Path) -> list[Path]:
    """Tout fichier, `.tmp` orphelin compris : le cache est jetable en entier (ADR-013)."""
    return [path for path in root.rglob("*") if path.is_file()]
```

`Path` reste importé sous `TYPE_CHECKING` : les annotations sont évaluées paresseusement en 3.14.

Dans `sidecar/src/tagger/handlers.py` :
- ajouter `cache_dir` à l'import groupé de `tagger.resolution.cache` (ordre alphabétique, après `ResponseCache`) ;
- remplacer le corps de `_cache_dir` par `return cache_dir() / name` ;
- retirer `from tagger.core.paths import app_data_dir`, qui n'a plus d'usage (ruff le signale sinon).

- [ ] **Step 4: Vérifier le passage**

Run: `cd sidecar && uv run pytest tests/unit/resolution/test_cache_disk.py -x -q`
Expected: PASS.

- [ ] **Step 5: Gate et commit**

```bash
just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar
git add sidecar/src/tagger/resolution/cache.py sidecar/src/tagger/handlers.py sidecar/tests/unit/resolution/test_cache_disk.py
git commit -m "feat(cache): mesure et vidage du cache disque"
```

---

### Task 2: Seuils par défaut et fichier de logs dans `version`

**Files:**
- Modify: `sidecar/src/tagger/core/paths.py`
- Modify: `sidecar/src/tagger/core/logger.py` (`LOG_FILE_NAME`)
- Modify: `sidecar/src/tagger/__main__.py` (`log_dir` retiré, importé de `core/paths.py`)
- Modify: `sidecar/src/tagger/protocol.py` (`Version`)
- Modify: `sidecar/src/tagger/handlers.py` (`handle_get_version`)
- Create: `sidecar/tests/integration/test_ndjson_settings.py`
- Modify: `sidecar/tests/unit/core/test_paths.py`, `sidecar/tests/unit/test_main.py`, `sidecar/tests/unit/test_protocol_models.py`
- Modify: `src/app/core/sidecar/protocol.ts` (`VersionEvent`)
- Modify: `src/app/core/sidecar/sidecar.service.ts`, `src/app/core/sidecar/sidecar.service.spec.ts`
- Modify: `src/fixtures/sidecar-stub.ts`
- Modify: `docs/ARCHITECTURE.md` (§ Matching l.208, événement `version` l.514)

**Interfaces:**
- Consumes: `DEFAULT_THRESHOLDS` (`resolution/matching.py`), `ThresholdsPayload` (`protocol.py`).
- Produces :
  - `tagger.core.paths.log_dir() -> Path` ;
  - `Version.default_thresholds: ThresholdsPayload`, `Version.log_file: Path` ;
  - `tagger.core.logger.LOG_FILE_NAME: Final = "tagger.log"`, employé par `setup_logging` ;
  - côté TS, `VersionEvent.default_thresholds: ThresholdsPayload`, `VersionEvent.log_file: string`, `SidecarService.defaultThresholds: Signal<ThresholdsPayload | null>`, `SidecarService.logFile: Signal<string | null>`.

- [ ] **Step 1: Écrire les tests Python**

Dans `sidecar/tests/unit/core/test_paths.py`, étendre l'import (`from tagger.core.paths import app_data_dir, extended_path, log_dir`) et ajouter après `test_falls_back_under_the_home_folder_without_localappdata` :

```python
def test_puts_the_log_folder_under_the_application_data_folder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Tauri compose `appLocalDataDir()` avec l'identifiant du bundle, pas avec le
    nom de l'application : le sidecar ecrirait sinon hors des scopes de la webview.
    """
    monkeypatch.setenv("LOCALAPPDATA", "C:/Users/x/AppData/Local")

    folder = log_dir()

    assert folder == Path("C:/Users/x/AppData/Local") / BUNDLE_IDENTIFIER / "logs"
```

Dans `sidecar/tests/unit/test_main.py`, supprimer `test_the_log_folder_follows_the_bundle_identifier` (l.131-139), repris ci-dessus.

Dans `sidecar/tests/unit/test_protocol_models.py`, ajouter `ThresholdsPayload` à l'import de `tagger.protocol` et remplacer la construction de `test_an_event_serialises_on_a_single_line` :

```python
def test_an_event_serialises_on_a_single_line() -> None:
    line = emit(
        Version(
            event="version",
            version="1.2.3",
            api_key_configured=True,
            default_thresholds=ThresholdsPayload(floor=65, ceiling=85),
            log_file=Path("C:/data/trace.log"),
        )
    )

    assert "\n" not in line
    assert json.loads(line)["version"] == "1.2.3"
```

Créer `sidecar/tests/integration/test_ndjson_settings.py` :

```python
"""Reglages servis par le sidecar : seuils par defaut, fichier de logs, cache."""

import pytest
from ndjson_loop import drive

from tagger.core.logger import LOG_FILE_NAME
from tagger.core.paths import log_dir
from tagger.resolution.matching import DEFAULT_THRESHOLDS


@pytest.mark.usefixtures("app_data")
def test_gives_the_default_thresholds_and_the_log_file() -> None:
    """Tels que l'interface les lit sur le fil : la valeur de depart des Reglages vient d'ici."""
    events = drive('{"command":"get_version"}\n')

    assert events[0]["default_thresholds"] == {
        "floor": DEFAULT_THRESHOLDS.floor,
        "ceiling": DEFAULT_THRESHOLDS.ceiling,
    }
    assert events[0]["log_file"] == str(log_dir() / LOG_FILE_NAME)
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd sidecar && uv run pytest tests/unit/core/test_paths.py tests/unit/test_protocol_models.py tests/integration/test_ndjson_settings.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'log_dir' from 'tagger.core.paths'`.

- [ ] **Step 3: Implémenter le Python**

Dans `sidecar/src/tagger/core/paths.py`, ajouter après `app_data_dir` :

```python
def log_dir() -> Path:
    # Recalcule et non recu de Tauri : le logger est arme avant la premiere lecture
    # de stdin, donc avant qu'aucune commande NDJSON ait pu porter le chemin. Un
    # argument de spawn demanderait d'ouvrir `args` dans le scope shell, ou un
    # argument non conforme est retire en silence.
    return app_data_dir() / "logs"
```

Dans `sidecar/src/tagger/core/logger.py`, nommer le fichier tournant une seule fois, avant `setup_logging` :

```python
# Lu aussi par `version` : l'interface revele ce fichier, le seul a joindre a un signalement.
LOG_FILE_NAME: Final = "tagger.log"
```

puis remplacer `log_dir / "tagger.log"` par `log_dir / LOG_FILE_NAME` dans `setup_logging` (importer `Final` de `typing` s'il ne l'est pas).

Dans `sidecar/src/tagger/__main__.py` :
- supprimer la fonction `log_dir` (l.88-93) ;
- remplacer `from tagger.core.paths import app_data_dir` par `from tagger.core.paths import log_dir` (`app_data_dir` n'y sert qu'à `log_dir`).

Dans `sidecar/src/tagger/protocol.py`, compléter `Version` :

```python
class Version(Event):
    """`api_key_configured` parce que seul le sidecar lit le trousseau : c'est ici
    que l'interface apprend qu'une cle existe, avant tout run (ADR-012).

    `default_thresholds` et `log_file` pour la meme raison : seul le sidecar les connait,
    les Reglages en partent sans les recopier.
    """

    event: Literal["version"]
    version: str
    api_key_configured: bool
    default_thresholds: ThresholdsPayload
    log_file: Path
```

Dans `sidecar/src/tagger/handlers.py` :
- ajouter `ThresholdsPayload` à l'import groupé de `tagger.protocol` (après `StartTagging`) ;
- ajouter `from tagger.core.logger import LOG_FILE_NAME` et `from tagger.core.paths import log_dir` (ce dernier à la place de l'import retiré en Task 1) ;
- compléter `handle_get_version` :

```python
def handle_get_version() -> Version:
    """Version nue et presence d'une cle : jamais la cle elle-meme (ADR-012)."""
    return Version(
        event="version",
        version=__version__,
        api_key_configured=read_api_key() is not None,
        default_thresholds=ThresholdsPayload(
            floor=DEFAULT_THRESHOLDS.floor, ceiling=DEFAULT_THRESHOLDS.ceiling
        ),
        log_file=log_dir() / LOG_FILE_NAME,
    )
```

- [ ] **Step 4: Vérifier le passage Python**

Run: `cd sidecar && uv run pytest tests/unit/core/test_paths.py tests/unit/test_main.py tests/unit/test_protocol_models.py tests/unit/test_handlers.py tests/integration/test_ndjson_settings.py -x -q`
Expected: PASS.

- [ ] **Step 5: Écrire les tests TS**

Dans `src/app/core/sidecar/sidecar.service.spec.ts`, ajouter `VersionEvent` à l'import de `./protocol` puis, après la constante `EXTRACTION` :

```typescript
const DEFAULT_THRESHOLDS = { floor: 65, ceiling: 85 } as const
const LOG_FILE = "C:/data/trace.log"

/** `version` complet : chaque test ne pose que le champ qu'il observe. */
const versionEvent = (overrides: Partial<VersionEvent> = {}): VersionEvent => ({
  event: "version",
  version: APP_VERSION,
  api_key_configured: false,
  default_thresholds: DEFAULT_THRESHOLDS,
  log_file: LOG_FILE,
  ...overrides,
})
```

Remplacer chaque littéral `version` passé à `transport.emit`, le contrat exigeant les deux champs :
- l.128, 165, 247, 359 : `transport.emit(versionEvent())` ;
- l.136 : `transport.emit(versionEvent({ api_key_configured: true }))` ;
- l.151 : `transport.emit(versionEvent({ version }))` ;
- l.173 : `transport.emit(versionEvent({ version: "0.0.1-old" }))` ;
- l.853 : `const VERSION = versionEvent({ api_key_configured: true })`.

Le littéral de l.381, passé à `onStderr` par `JSON.stringify`, ne change pas : il n'est pas typé `SidecarEvent`.

Ajouter après `feeds the api key state from the version event` :

```typescript
  it("feeds the default thresholds and the log file from the version event", async () => {
    await service.start()

    transport.emit(versionEvent())

    expect(service.defaultThresholds()).toEqual(DEFAULT_THRESHOLDS)
    expect(service.logFile()).toBe(LOG_FILE)
  })
```

- [ ] **Step 6: Vérifier l'échec**

Run: `just typecheck-ui`
Expected: FAIL, `Object literal may only specify known properties, and 'default_thresholds' does not exist in type 'VersionEvent'` et `Property 'defaultThresholds' does not exist on type 'SidecarService'`.

- [ ] **Step 7: Implémenter le TS**

Dans `src/app/core/sidecar/protocol.ts`, compléter `VersionEvent` :

```typescript
export interface VersionEvent {
  readonly event: "version"
  readonly version: string
  /** Seul le sidecar lit le trousseau : l'interface l'apprend ici. */
  readonly api_key_configured: boolean
  /** Seuils que le sidecar applique sans `thresholds` : valeurs de depart des Reglages. */
  readonly default_thresholds: ThresholdsPayload
  /** Fichier de logs courant, que les Reglages revelent dans l'Explorateur. */
  readonly log_file: string
}
```

Dans `src/app/core/sidecar/sidecar.service.ts`, après `_apiKeyConfigured` :

```typescript
  private readonly _defaultThresholds = signal<ThresholdsPayload | null>(null)
  private readonly _logFile = signal<string | null>(null)
```

Après `readonly apiKeyConfigured = ...` :

```typescript
  /** `null` tant que la version n'est pas arrivee, comme `apiKeyConfigured`. */
  readonly defaultThresholds = this._defaultThresholds.asReadonly()
  readonly logFile = this._logFile.asReadonly()
```

Dans `handleLine`, `case "version"`, après `this._apiKeyConfigured.set(event.api_key_configured)` :

```typescript
        this._defaultThresholds.set(event.default_thresholds)
        this._logFile.set(event.log_file)
```

Dans `src/fixtures/sidecar-stub.ts`, `defaults()`, après `version: signal("1.0.0"),` :

```typescript
  defaultThresholds: signal(null),
  logFile: signal(null),
```

- [ ] **Step 8: Vérifier le passage TS**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/core/sidecar/sidecar.service.spec.ts`
Expected: PASS.

- [ ] **Step 9: Mettre à jour ARCHITECTURE.md**

- l.208 : remplacer « Réglables dans les Settings à l'étape 8 ; `start_tagging` accepte déjà des seuils. » par « Réglables dans les Settings à l'étape 8 : `start_tagging` accepte des seuils, et `version` porte ceux que le sidecar applique sans eux (`default_thresholds`), seule source des valeurs de départ. »
- ligne `version` de la table des événements (l.514) : ajouter en fin de cellule « ; `default_thresholds` : seuils que le sidecar applique quand `start_tagging` n'en porte pas, valeurs de départ des Réglages ; `log_file` : fichier de logs courant, que les Réglages révèlent dans l'Explorateur ».

- [ ] **Step 10: Gate et commit**

```bash
just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar
just lint-ui && just typecheck-ui && just test-ui
git add sidecar/src/tagger/core/paths.py sidecar/src/tagger/core/logger.py sidecar/src/tagger/__main__.py sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/tests/unit/core/test_paths.py sidecar/tests/unit/test_main.py sidecar/tests/unit/test_protocol_models.py sidecar/tests/integration/test_ndjson_settings.py src/app/core/sidecar/protocol.ts src/app/core/sidecar/sidecar.service.ts src/app/core/sidecar/sidecar.service.spec.ts src/fixtures/sidecar-stub.ts docs/ARCHITECTURE.md
git commit -m "feat(settings): seuils par défaut et fichier de logs dans version"
```

---

### Task 3: Commandes `get_cache_size` et `clear_cache`

**Files:**
- Modify: `sidecar/src/tagger/protocol.py` (`GetCacheSize`, `ClearCache`, `CacheSize`, `CacheCleared`, unions)
- Modify: `sidecar/src/tagger/handlers.py` (`handle_get_cache_size`, `handle_clear_cache`, `CurrentRun.awaits_write`)
- Modify: `sidecar/src/tagger/__main__.py` (`RunNotWrittenError`, `_Session.clear_cache`, dispatch)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Modify: `sidecar/tests/integration/test_ndjson_settings.py`
- Modify: `src/app/core/sidecar/protocol.ts`, `src/app/core/sidecar/sidecar.service.ts`, `src/app/core/sidecar/sidecar.service.spec.ts`
- Modify: `src/fixtures/sidecar-stub.ts`
- Modify: `docs/ARCHITECTURE.md` (table des commandes, ligne `set_api_key`, table des événements, § Cache)

**Interfaces:**
- Consumes: `cache_dir`, `cache_size`, `clear_cache`, `ClearedCache` (Task 1) ; `CurrentRun.writer`, `CurrentRun.live.snapshot().tracks`, `TrackState.WRITE_ERROR` ; `_Session._ensure_idle()`.
- Produces :
  - `GetCacheSize`, `ClearCache` (commandes), `CacheSize(size_bytes: int)`, `CacheCleared(freed_bytes: int, size_bytes: int)` (événements) ;
  - `handle_get_cache_size() -> CacheSize`, `handle_clear_cache() -> CacheCleared` ;
  - `CurrentRun.awaits_write: bool` (propriété) ;
  - `RunNotWrittenError` (code `run_not_written`) ;
  - côté TS, `GetCacheSizeCommand`, `ClearCacheCommand`, `CacheSizeEvent`, `CacheClearedEvent`, `SidecarService.cacheSize: Signal<number | null>`, `SidecarService.cacheCleared: Signal<CacheClearedEvent | null>`, `loadCacheSize(): Promise<void>`, `clearCache(): Promise<void>`.

- [ ] **Step 1: Écrire les tests d'intégration**

Dans `sidecar/tests/integration/test_ndjson_settings.py`, remplacer les imports par :

```python
from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation, drive, resolved_run, start_command, written_run
from scraper_responses import YOUR_MIND

from tagger.core.file_failures import FileFailureReason
from tagger.core.logger import LOG_FILE_NAME
from tagger.core.paths import log_dir
from tagger.resolution.cache import cache_dir
from tagger.resolution.matching import DEFAULT_THRESHOLDS
from tagger.run import writing
from tagger.run.plan import plan_dir
from tagger.tags.files import TagsWriteError

if TYPE_CHECKING:
    from pathlib import Path

    from tagging_api import FakeApi
```

Puis ajouter à la suite du test existant :

```python
def _cached_files() -> list[Path]:
    return sorted(path for path in cache_dir().rglob("*") if path.is_file())


def _fill_cache() -> int:
    """Une reponse et une pochette : rend la taille totale ecrite."""
    (cache_dir() / "responses").mkdir(parents=True)
    (cache_dir() / "artworks").mkdir()
    (cache_dir() / "responses" / "a.json").write_bytes(b"r" * 10)
    (cache_dir() / "artworks" / "b.jpg").write_bytes(b"p" * 32)
    return 42


@pytest.mark.usefixtures("app_data")
def test_measures_then_clears_the_cache_and_keeps_the_plans() -> None:
    filled = _fill_cache()
    plan_dir().mkdir(parents=True)
    kept = plan_dir() / "kept.json"
    kept.write_text("{}", encoding="utf-8")

    events = drive('{"command":"get_cache_size"}\n{"command":"clear_cache"}\n')

    assert events == [
        {"event": "cache_size", "size_bytes": filled},
        {"event": "cache_cleared", "freed_bytes": filled, "size_bytes": 0},
    ]
    assert _cached_files() == []
    assert kept.is_file()


@pytest.mark.usefixtures("app_data")
def test_clears_an_already_empty_cache_without_error() -> None:
    """Double clic sur le bouton : le second vidage n'a rien a supprimer."""
    _fill_cache()

    events = drive('{"command":"clear_cache"}\n{"command":"clear_cache"}\n')

    assert events[1] == {"event": "cache_cleared", "freed_bytes": 0, "size_bytes": 0}


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_refuses_to_clear_the_cache_of_a_run_not_written(folder: Path) -> None:
    """`write_tags` lit la pochette dans le cache au moment d'ecrire."""
    async with conversation() as talk:
        await resolved_run(talk, folder)
        cached = _cached_files()
        talk.send(command="clear_cache")
        error = await talk.expect("error")

    assert (error["code"], error["params"], error["command"]) == (
        "run_not_written",
        {},
        "clear_cache",
    )
    assert cached
    assert _cached_files() == cached


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_refuses_to_clear_the_cache_of_a_cancelled_run(folder: Path, api: FakeApi) -> None:
    """Un run interrompu reste courant : il garde son rattrapage, donc son ecriture."""
    gate = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(**start_command(folder))
        await gate.reached.wait()
        talk.send(command="cancel_run")
        await talk.expect("progress", phase="url_recovery")
        talk.send(command="clear_cache")
        error = await talk.expect("error")

    assert error["code"] == "run_not_written"


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_refuses_to_clear_the_cache_while_a_failed_write_awaits_its_retry(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def locked(path: Path, *_args: object) -> object:
        raise TagsWriteError(path, FileFailureReason.FILE_LOCKED)

    monkeypatch.setattr(writing, "write_tags", locked)

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")
        talk.send(command="clear_cache")
        error = await talk.expect("error")

    assert error["code"] == "run_not_written"


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_refuses_to_clear_the_cache_while_a_run_searches(folder: Path, api: FakeApi) -> None:
    gate = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(**start_command(folder))
        await gate.reached.wait()
        talk.send(command="clear_cache")
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["params"], error["command"]) == (
        "phase_busy",
        {"phase": "tagging"},
        "clear_cache",
    )


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_clears_the_cache_of_a_written_run_and_runs_again(folder: Path) -> None:
    """Le cache est jetable : un run qui suit son vidage repaie ses appels et va au bout."""
    async with conversation() as talk:
        await written_run(talk, folder)
        talk.send(command="clear_cache")
        cleared = await talk.expect("cache_cleared")
        talk.send(**start_command(folder))
        await talk.expect("run_finished", phase="network")

    assert cleared["freed_bytes"] > 0
    assert cleared["size_bytes"] == 0
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_settings.py -x -q`
Expected: FAIL sur `test_measures_then_clears_the_cache_and_keeps_the_plans`, l'événement reçu étant `error` de code `malformed_command` (commande inconnue).

- [ ] **Step 3: Implémenter le protocole**

Dans `sidecar/src/tagger/protocol.py`, après `GetRollbackTarget` :

```python
class GetCacheSize(Command):
    """Relue a l'ouverture des Reglages : un run fait grossir le cache entre deux visites."""

    command: Literal["get_cache_size"]


class ClearCache(Command):
    """Refusee tant que le run courant attend son ecriture (`run_not_written`)."""

    command: Literal["clear_cache"]
```

Ajouter `GetCacheSize` et `ClearCache` à la fin de `AnyCommand` (avant `Field(discriminator=...)`) et de `ExecutableCommand`, puis `"get_cache_size"` et `"clear_cache"` à la fin de `CommandName`.

Après `RollbackTarget` :

```python
class CacheSize(Event):
    event: Literal["cache_size"]
    size_bytes: int


class CacheCleared(Event):
    """`size_bytes` : ce qui reste, un fichier verrouille survivant au vidage."""

    event: Literal["cache_cleared"]
    freed_bytes: int
    size_bytes: int
```

- [ ] **Step 4: Implémenter les handlers et le garde**

Dans `sidecar/src/tagger/handlers.py` :
- ajouter `CacheCleared` et `CacheSize` à l'import groupé de `tagger.protocol` (ordre alphabétique, en tête) ;
- ajouter `cache_size` et `clear_cache` à l'import groupé de `tagger.resolution.cache` ;
- ajouter `from tagger.run.models import TrackState` après `from tagger.run.arbitration import Arbitration` ;
- ajouter après `handle_get_rollback_target` :

```python
def handle_get_cache_size() -> CacheSize:
    return CacheSize(event="cache_size", size_bytes=cache_size(cache_dir()))


def handle_clear_cache() -> CacheCleared:
    """Le garde est dans la session, seule a connaitre le run courant."""
    cleared = clear_cache(cache_dir())
    logger.info("cache cleared")
    return CacheCleared(
        event="cache_cleared", freed_bytes=cleared.freed_bytes, size_bytes=cleared.size_bytes
    )
```

- ajouter à `CurrentRun`, après la propriété `busy` :

```python
    @property
    def awaits_write(self) -> bool:
        """Ses pochettes servent encore : ecriture a confirmer, ou echecs que `retry_write`
        rejouera. `write_tags` les lit dans le cache au moment d'ecrire."""
        if self.writer is None:
            return True
        return any(record.state is TrackState.WRITE_ERROR for record in self.live.snapshot().tracks)
```

Dans `sidecar/src/tagger/__main__.py` :
- ajouter `handle_clear_cache` et `handle_get_cache_size` à l'import de `tagger.handlers`, `ClearCache` et `GetCacheSize` à celui de `tagger.protocol` ;
- ajouter après `RunCommittedError` :

```python
class RunNotWrittenError(TaggerError):
    """Le run courant attend son ecriture : vider le cache lui ferait ecrire ses morceaux sans
    leur pochette, en silence, `write_tags` gardant alors l'image d'origine."""

    code: ClassVar[str] = "run_not_written"

    def __init__(self) -> None:
        super().__init__("the current run is not written")
```

- ajouter à `_Session`, après `announce_interrupted_run` :

```python
    async def clear_cache(self) -> None:
        """Attendu par la boucle, sans phase longue : un `start_tagging` envoye pendant le vidage
        part apres lui, sans course."""
        self._ensure_idle()
        if self._current is not None and self._current.awaits_write:
            raise RunNotWrittenError
        self.send(await asyncio.to_thread(handle_clear_cache))
```

- ajouter dans `_dispatch`, avant `case _:` :

```python
        case GetCacheSize():
            session.send(await asyncio.to_thread(handle_get_cache_size))
        case ClearCache():
            await session.clear_cache()
```

Dans `public/i18n/fr.json`, après `"write_not_open"` :

```json
    "run_not_written": "Le run affiché attend l'écriture de ses tags.\nTerminez-la avant de vider le cache.",
```

Dans `public/i18n/en.json`, au même endroit :

```json
    "run_not_written": "The run on screen is waiting for its tags to be written.\nFinish writing before clearing the cache.",
```

- [ ] **Step 5: Vérifier le passage Python**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_settings.py tests/unit/test_protocol_models.py tests/unit/test_error_translations.py -x -q`
Expected: PASS.

- [ ] **Step 6: Écrire les tests TS**

Dans `src/app/core/sidecar/sidecar.service.spec.ts`, ajouter au tableau du `it.each` (« sends %s as its command ») :

```typescript
    ["a cache size request", (target) => target.loadCacheSize(), { command: "get_cache_size" }],
    ["a cache clearing", (target) => target.clearCache(), { command: "clear_cache" }],
```

Puis, après le test `feeds the default thresholds and the log file from the version event` :

```typescript
  it("feeds the cache size from a measure, then from a clearing", async () => {
    await service.start()
    transport.emit({ event: "cache_size", size_bytes: 4096 })

    transport.emit({ event: "cache_cleared", freed_bytes: 4000, size_bytes: 96 })

    expect(service.cacheSize()).toBe(96)
    expect(service.cacheCleared()).toEqual({
      event: "cache_cleared",
      freed_bytes: 4000,
      size_bytes: 96,
    })
  })
```

- [ ] **Step 7: Vérifier l'échec**

Run: `just typecheck-ui`
Expected: FAIL, `Property 'loadCacheSize' does not exist on type 'SidecarService'` et `Type '"cache_size"' is not assignable to type ...`.

- [ ] **Step 8: Implémenter le TS**

Dans `src/app/core/sidecar/protocol.ts`, après `GetRollbackTargetCommand` :

```typescript
/** Taille du cache, relue a l'ouverture des Reglages. */
export interface GetCacheSizeCommand {
  readonly command: "get_cache_size"
}

/** Refusee en `run_not_written` tant que le run courant attend son ecriture. */
export interface ClearCacheCommand {
  readonly command: "clear_cache"
}
```

Ajouter `| GetCacheSizeCommand` et `| ClearCacheCommand` à la fin de `SidecarCommand`. Après `RollbackTargetEvent` :

```typescript
export interface CacheSizeEvent {
  readonly event: "cache_size"
  readonly size_bytes: number
}

/** `size_bytes` : ce qui reste, un fichier verrouille survivant au vidage. */
export interface CacheClearedEvent {
  readonly event: "cache_cleared"
  readonly freed_bytes: number
  readonly size_bytes: number
}
```

Ajouter `| CacheSizeEvent` et `| CacheClearedEvent` à `SidecarEvent`, avant `| SidecarErrorEvent`.

Dans `src/app/core/sidecar/sidecar.service.ts` :
- ajouter `CacheClearedEvent` à l'import de `./protocol` ;
- ajouter `cache_size: true,` et `cache_cleared: true,` à `KNOWN_EVENTS`, avant `error: true,` ;
- après `_logFile` :

```typescript
  private readonly _cacheSize = signal<number | null>(null)
  private readonly _cacheCleared = signal<CacheClearedEvent | null>(null)
```

- après `readonly logFile = ...` :

```typescript
  /** Octets du cache, `null` avant la premiere mesure. */
  readonly cacheSize = this._cacheSize.asReadonly()
  /** Dernier vidage : de quoi l'annoncer. */
  readonly cacheCleared = this._cacheCleared.asReadonly()
```

- après `loadRollbackTarget()` :

```typescript
  async loadCacheSize(): Promise<void> {
    await this.query({ command: "get_cache_size" })
  }

  async clearCache(): Promise<void> {
    await this.send({ command: "clear_cache" })
  }
```

- dans `handleLine`, après `case "rollback_target"` :

```typescript
      case "cache_size":
        this._cacheSize.set(event.size_bytes)
        break
      case "cache_cleared":
        this._cacheSize.set(event.size_bytes)
        this._cacheCleared.set(event)
        break
```

Dans `src/fixtures/sidecar-stub.ts`, `defaults()` : après `logFile: signal(null),` ajouter `cacheSize: signal(null),` et `cacheCleared: signal(null),` ; après `loadRollbackTarget: ...` :

```typescript
  loadCacheSize: vi.fn<SidecarService["loadCacheSize"]>(() => Promise.resolve()),
  clearCache: vi.fn<SidecarService["clearCache"]>(() => Promise.resolve()),
```

- [ ] **Step 9: Vérifier le passage TS**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/core/sidecar/sidecar.service.spec.ts`
Expected: PASS.

- [ ] **Step 10: Mettre à jour ARCHITECTURE.md**

- Table des commandes, après la ligne `get_rollback_target` :

```markdown
| `get_cache_size` | aucune. Rend `cache_size` : la taille des fichiers sous `appLocalDataDir()/cache`, relue sur le disque à chaque appel |
| `clear_cache` | aucune. Supprime les fichiers du cache, réponses et pochettes, et rend `cache_cleared`. Un fichier qui résiste (antivirus) reste et compte dans ce qui reste. Refusée en `phase_busy` pendant une phase longue, puis en `run_not_written` tant que le run courant n'est pas confirmé ou garde un `write_error` : `write_tags` lit la pochette dans le cache au moment d'écrire et garderait sinon l'image d'origine, en silence. Plans, dumps, rapports et logs ne sont jamais touchés |
```

- Ligne `set_api_key` : retirer la dernière phrase (« `clear_cache` (bouton « vider le cache » des Settings) est prévu à l'étape 8, absent du contrat au 2026-10-13 »).
- Table des événements, avant la ligne `error` :

```markdown
| `cache_size` | `size_bytes` : taille du cache. Réponse à `get_cache_size` |
| `cache_cleared` | `freed_bytes` : octets supprimés ; `size_bytes` : ce qui reste, un fichier verrouillé survivant au vidage. Réponse à `clear_cache` |
```

- § Cache (l.681) : remplacer « bouton « vider le cache » dans les Settings à l'étape 8 » par « vidé depuis les Settings par `clear_cache`, refusé tant qu'un run attend son écriture (§ API) ».

- [ ] **Step 11: Gate et commit**

```bash
just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar
just lint-ui && just typecheck-ui && just test-ui
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py public/i18n/fr.json public/i18n/en.json sidecar/tests/integration/test_ndjson_settings.py src/app/core/sidecar/protocol.ts src/app/core/sidecar/sidecar.service.ts src/app/core/sidecar/sidecar.service.spec.ts src/fixtures/sidecar-stub.ts docs/ARCHITECTURE.md
git commit -m "feat(settings): commandes get_cache_size et clear_cache"
```
