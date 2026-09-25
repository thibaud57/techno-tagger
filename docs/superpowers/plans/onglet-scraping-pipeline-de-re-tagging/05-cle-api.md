# Clé API : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à chaque utilisateur d'enregistrer une fois la clé API qui lui a été remise, rangée dans le trousseau Windows côté sidecar, pour que le pipeline puisse appeler techno-scraper.

**Architecture:** Un module `tagger/api_key.py` est seul à toucher le trousseau, avec un backend forcé à `WinVaultKeyring` au démarrage. La commande `set_api_key` range la clé et répond par l'événement `version`, dont `api_key_configured` devient réel. Côté webview, le service expose `apiKeyConfigured` et la page Settings reçoit sa section API, réduite au champ de la clé. La documentation est réalignée sur l'URL figée.

**Tech Stack:** Python 3.14, keyring 25.7, pydantic 2.13, pytest ; Angular 22 (Signal Forms, signals), PrimeNG 22 (`p-password`, `pButton`, `p-tag`), ngx-translate 18, Vitest.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/05-cle-api-design.md`

## Global Constraints

- **Trousseau** : service `APP_NAME` (`tagger/__init__.py`), identifiant constant `x-api-key`, backend forcé par `keyring.set_keyring(WinVaultKeyring())` dans `main()` avant la boucle.
- **Format de la clé** : ASCII imprimable sans espace (`^[\x21-\x7e]+$`), 1 à 2560 caractères. Aucune vérification auprès de l'API.
- **Erreurs** : `api_key_not_stored` (`PasswordSetError`), `keyring_unavailable` (`NoKeyringError`), `malformed_command` existant pour une clé hors format. Une `KeyringError` à la lecture vaut absence de clé, loguée en WARNING.
- **Réponse de `set_api_key`** : l'événement `version` existant, avec `api_key_configured` à jour. Aucun événement nouveau.
- **Aucune fuite** : la clé n'apparaît dans aucun log, `params`, message d'erreur, événement ni `repr` de commande. Aucun test ne touche le Credential Manager de la machine : un trousseau en mémoire est posé d'office pour chaque test.
- **UI** : `p-password` `[feedback]="false"` `[toggleMask]="true"`, jamais prérempli, vidé à l'envoi ; bouton primaire `size="small"` désactivé à vide ; libellés FR et EN dans le même commit, espace insécable (` `) avant `:` `;` `?` `!` en français, vouvoiement, actions à l'infinitif.
- **Design** : maquette `ui_kits/techno-tagger/SettingsScreen.jsx` section « API », rangée « Clé X-API-Key » seule ; container porté par le shell, aucun padding ni `max-width` de page (arbitrages `.design-sync/NOTES.md`).
- **Réutiliser** : `TaggerError`, `error_from_validation` (ne garde que `loc` et `type`), `ErrorMessageComponent`, `PAGE_HOST` et `FADE_IN` de `shared/utils/motion`, le `FakeTransport` de `sidecar.service.spec.ts`.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`. Commits `type(scope): description`, scopes `settings` (sidecar et UI) et `docs`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/api_key.py` | Lecture et écriture de la clé, erreurs. |
| `sidecar/src/tagger/protocol.py` | Commande `SetApiKey`, unions. |
| `sidecar/src/tagger/handlers.py` | `handle_get_version` lit le trousseau, `handle_set_api_key`. |
| `sidecar/src/tagger/__main__.py` | Backend forcé, dispatch de `SetApiKey`. |
| `sidecar/tests/helpers/memory_keyring.py` | Trousseaux de test : en mémoire, qui refuse l'écriture, qui échoue en lecture. |
| `sidecar/tests/conftest.py` | Fixture autouse `memory_keyring`. |
| `sidecar/tests/unit/test_api_key.py`, `test_handlers.py`, `tests/integration/test_ndjson_loop.py` | Tests sidecar. |
| `src/app/core/models/protocol.ts`, `sidecar.service.ts` (+ spec) | Miroir TS, signal `apiKeyConfigured`, `setApiKey`. |
| `src/app/features/settings/settings-page.component.{ts,html,spec.ts}` | Section API. |
| `public/i18n/{fr,en}.json` | Libellés et erreurs. |
| `docs/…` | Réalignement sur l'URL figée. |

---

## Task 1: Trousseau côté sidecar

**Files:**
- Create: `sidecar/src/tagger/api_key.py`
- Create: `sidecar/tests/helpers/memory_keyring.py`
- Modify: `sidecar/tests/conftest.py`
- Test: `sidecar/tests/unit/test_api_key.py`

**Interfaces:**
- Produces:
  - `SERVICE: Final`, `USERNAME: Final = "x-api-key"`
  - `ApiKeyError(TaggerError)`, `ApiKeyNotStoredError()` (`api_key_not_stored`), `KeyringUnavailableError()` (`keyring_unavailable`)
  - `read_api_key() -> str | None`, `store_api_key(key: str) -> None`
  - helpers : `MemoryKeyring` (attribut `secrets: dict[tuple[str, str], str]`), `RefusingKeyring`, `FailingKeyring` ; fixture autouse `memory_keyring: MemoryKeyring`

- [ ] **Step 1: Écrire les trousseaux de test**

Créer `sidecar/tests/helpers/memory_keyring.py` :

```python
"""Trousseaux de test : aucun test ne touche le Credential Manager de la machine."""

from keyring.backend import KeyringBackend
from keyring.errors import KeyringError, PasswordSetError


class MemoryKeyring(KeyringBackend):
    """Secrets gardes en memoire, pour le temps d'un test."""

    priority = 1

    def __init__(self) -> None:
        super().__init__()
        self.secrets: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.secrets.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.secrets[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        self.secrets.pop((service, username), None)


class RefusingKeyring(MemoryKeyring):
    """Refuse l'ecriture, comme le Credential Manager sur un secret trop gros."""

    def set_password(self, service: str, username: str, password: str) -> None:
        raise PasswordSetError("refused")


class FailingKeyring(MemoryKeyring):
    """Echoue a la lecture, comme un trousseau verrouille."""

    def get_password(self, service: str, username: str) -> str | None:
        raise KeyringError("locked")
```

Dans `sidecar/tests/conftest.py`, ajouter `import keyring` et `from memory_keyring import MemoryKeyring` aux imports, puis la fixture après `_isolate_root_logger` :

```python
@pytest.fixture(autouse=True)
def memory_keyring() -> Iterator[MemoryKeyring]:
    """Trousseau en memoire pose pour chaque test, backend precedent restaure apres.

    Autouse : `get_version` lit desormais le trousseau, et un test qui l'oublierait
    toucherait le Credential Manager de la machine qui fait tourner la suite.
    """
    previous = keyring.get_keyring()
    backend = MemoryKeyring()
    keyring.set_keyring(backend)

    yield backend

    keyring.set_keyring(previous)
```

- [ ] **Step 2: Écrire les tests du trousseau**

Créer `sidecar/tests/unit/test_api_key.py` :

```python
"""Tests de la lecture et de l'ecriture de la cle dans le trousseau."""

import keyring
import pytest
from keyring.backends import fail
from memory_keyring import FailingKeyring, MemoryKeyring, RefusingKeyring

from tagger.api_key import (
    ApiKeyNotStoredError,
    KeyringUnavailableError,
    read_api_key,
    store_api_key,
)


def test_reads_no_key_from_an_empty_keyring(memory_keyring: MemoryKeyring) -> None:
    key = read_api_key()

    assert key is None


def test_stores_then_reads_the_key(memory_keyring: MemoryKeyring) -> None:
    store_api_key("k3y-t0k3n")

    key = read_api_key()

    assert key == "k3y-t0k3n"


def test_reads_no_key_when_the_keyring_fails_on_read() -> None:
    keyring.set_keyring(FailingKeyring())

    key = read_api_key()

    assert key is None


def test_raises_api_key_not_stored_when_the_keyring_refuses_the_write() -> None:
    keyring.set_keyring(RefusingKeyring())

    with pytest.raises(ApiKeyNotStoredError) as error:
        store_api_key("k3y-t0k3n")

    assert error.value.code == "api_key_not_stored"
    assert "k3y-t0k3n" not in str(error.value)
    assert error.value.params == {}


def test_raises_keyring_unavailable_without_backend() -> None:
    keyring.set_keyring(fail.Keyring())

    with pytest.raises(KeyringUnavailableError) as error:
        store_api_key("k3y-t0k3n")

    assert error.value.code == "keyring_unavailable"
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_api_key.py -x -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.api_key'`

- [ ] **Step 4: Implémenter le module**

Créer `sidecar/src/tagger/api_key.py` :

```python
"""Cle X-API-Key de techno-scraper, rangee dans le trousseau de l'OS (ADR-012).

Seul module du sidecar a toucher le trousseau. La cle n'apparait dans aucun log,
aucun parametre d'erreur ni aucun evenement : l'interface n'apprend que son
existence, par l'evenement `version`.
"""

import logging
from typing import ClassVar, Final

import keyring
from keyring.errors import KeyringError, NoKeyringError, PasswordSetError

from tagger import APP_NAME
from tagger.errors import TaggerError

logger = logging.getLogger(__name__)

SERVICE: Final = APP_NAME
# Une seule entree : l'identifiant ne sert qu'a la retrouver dans le Credential Manager.
USERNAME: Final = "x-api-key"


class ApiKeyError(TaggerError):
    """Echec d'enregistrement de la cle, sans jamais porter la cle elle-meme."""

    code: ClassVar[str] = "api_key_error"


class ApiKeyNotStoredError(ApiKeyError):
    """Le trousseau a refuse l'ecriture."""

    code: ClassVar[str] = "api_key_not_stored"

    def __init__(self) -> None:
        super().__init__("api key not stored")


class KeyringUnavailableError(ApiKeyError):
    """Aucun backend de trousseau : le symptome du binaire fige mal empaquete."""

    code: ClassVar[str] = "keyring_unavailable"

    def __init__(self) -> None:
        super().__init__("no keyring backend")


def read_api_key() -> str | None:
    """Cle enregistree, `None` au premier lancement ou si le trousseau est illisible.

    Un trousseau illisible ne bloque pas l'application : l'onglet Tagging dira qu'il
    manque la cle, ce qui oriente vers la bonne correction.
    """
    try:
        return keyring.get_password(SERVICE, USERNAME)
    except KeyringError:
        logger.warning("api key unreadable reason=keyring_error")
        return None


def store_api_key(key: str) -> None:
    """Range la cle, en remplacant la precedente."""
    try:
        keyring.set_password(SERVICE, USERNAME, key)
    except NoKeyringError as exc:
        raise KeyringUnavailableError from exc
    except PasswordSetError as exc:
        raise ApiKeyNotStoredError from exc
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_api_key.py -x -q`
Expected: PASS, 5 tests

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert, `test_reports_the_sidecar_version` compris (le trousseau en mémoire est posé d'office)

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/api_key.py sidecar/tests/helpers/memory_keyring.py sidecar/tests/conftest.py sidecar/tests/unit/test_api_key.py
git commit -m "feat(settings): ranger la cle API dans le trousseau de Windows"
```

---

## Task 2: Commande `set_api_key` et version réelle

**Files:**
- Modify: `sidecar/src/tagger/protocol.py` (commande, unions)
- Modify: `sidecar/src/tagger/handlers.py` (`handle_get_version`, `handle_set_api_key`)
- Modify: `sidecar/src/tagger/__main__.py` (backend forcé, dispatch)
- Test: `sidecar/tests/unit/test_handlers.py`, `sidecar/tests/integration/test_ndjson_loop.py`

**Interfaces:**
- Consumes: `read_api_key`, `store_api_key`, `ApiKeyNotStoredError`, `MemoryKeyring`, `RefusingKeyring` (Task 1)
- Produces:
  - `SetApiKey(command: Literal["set_api_key"], api_key: str)`, membre d'`AnyCommand` et d'`ExecutableCommand`
  - `handle_set_api_key(command: SetApiKey) -> Version`

- [ ] **Step 1: Écrire les tests des handlers**

Dans `sidecar/tests/unit/test_handlers.py`, ajouter `import pytest`, `from pydantic import ValidationError`, `from memory_keyring import MemoryKeyring`, `from tagger.api_key import SERVICE, USERNAME`, `from tagger.handlers import handle_set_api_key` et `from tagger.protocol import SetApiKey` aux imports, puis :

```python
def test_reports_whether_an_api_key_is_configured(memory_keyring: MemoryKeyring) -> None:
    memory_keyring.secrets[(SERVICE, USERNAME)] = "k3y-t0k3n"

    event = handle_get_version()

    assert event.api_key_configured is True


def test_answers_set_api_key_with_a_version_that_reports_the_key(
    memory_keyring: MemoryKeyring,
) -> None:
    command = SetApiKey(command="set_api_key", api_key="k3y-t0k3n")

    event = handle_set_api_key(command)

    assert event.event == "version"
    assert event.api_key_configured is True
    assert memory_keyring.secrets[(SERVICE, USERNAME)] == "k3y-t0k3n"


@pytest.mark.parametrize(
    "api_key", ["", "k3y t0k3n", "clé", "x" * 2561], ids=["empty", "space", "non-ascii", "too-long"]
)
def test_rejects_an_api_key_out_of_format(api_key: str) -> None:
    with pytest.raises(ValidationError):
        SetApiKey(command="set_api_key", api_key=api_key)


def test_never_shows_the_api_key_in_the_command_repr() -> None:
    command = SetApiKey(command="set_api_key", api_key="k3y-t0k3n")

    shown = repr(command)

    assert "k3y-t0k3n" not in shown
```

- [ ] **Step 2: Écrire le test de sécurité de bout en bout**

Dans `sidecar/tests/integration/test_ndjson_loop.py`, ajouter `import logging`, `import keyring`, `from memory_keyring import MemoryKeyring, RefusingKeyring` aux imports, extraire la lecture brute de `drive` et ajouter les tests :

```python
def drive_raw(commands: str) -> str:
    """Injecte des commandes et rend la sortie brute, pour y chercher une fuite."""
    stdout = io.StringIO()
    asyncio.run(run_loop(io.StringIO(commands), stdout))

    return stdout.getvalue()


def drive(commands: str) -> list[dict[str, object]]:
    """Injecte des commandes et rend les evenements emis, un par ligne."""
    return [json.loads(line) for line in drive_raw(commands).splitlines() if line]


SECRET = "sk-live-9f8e7d6c5b4a"


def _set_api_key(api_key: str) -> str:
    return json.dumps({"command": "set_api_key", "api_key": api_key}) + "\n"


def test_never_echoes_the_api_key_on_stdout_nor_in_the_logs(
    memory_keyring: MemoryKeyring, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    commands = _set_api_key(SECRET) + _set_api_key(f"{SECRET} with-space")

    output = drive_raw(commands)

    assert SECRET not in output
    assert SECRET not in caplog.text
    assert [json.loads(line)["event"] for line in output.splitlines()] == ["version", "error"]


def test_never_echoes_the_api_key_when_the_keyring_refuses_it(
    caplog: pytest.LogCaptureFixture,
) -> None:
    keyring.set_keyring(RefusingKeyring())
    caplog.set_level(logging.DEBUG)

    output = drive_raw(_set_api_key(SECRET))

    assert SECRET not in output
    assert SECRET not in caplog.text
    assert json.loads(output)["code"] == "api_key_not_stored"
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_handlers.py tests/integration/test_ndjson_loop.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'handle_set_api_key' from 'tagger.handlers'`

- [ ] **Step 4: Déclarer la commande**

Dans `sidecar/src/tagger/protocol.py`, ajouter `StringConstraints` à l'import pydantic et `Final` à l'import `typing` si absents, puis après `ExtractPlaylist` :

```python
# ASCII imprimable sans espace : contrainte du decodage latin-1 des en-tetes cote
# API (PRODUCTION.md § Regles). 2560 : plafond du Credential Manager.
_API_KEY_PATTERN: Final = r"^[\x21-\x7e]+$"
_API_KEY_MAX_LENGTH: Final = 2560


class SetApiKey(Command):
    """Seul passage de la cle dans le protocole : elle ne revient jamais vers la webview.

    Le format est controle, pas la validite : une cle revoquee arrete le run sur
    ses 403 (ARCHITECTURE.md § Cle API invalide ou revoquee).
    """

    command: Literal["set_api_key"]
    api_key: Annotated[
        str,
        StringConstraints(pattern=_API_KEY_PATTERN, max_length=_API_KEY_MAX_LENGTH),
        Field(repr=False),
    ]
```

Ajouter `SetApiKey` aux deux unions :

```python
type AnyCommand = Annotated[
    GetVersion | Shutdown | ListPlaylists | ExtractPlaylist | SetApiKey,
    Field(discriminator="command"),
]
```

```python
type ExecutableCommand = GetVersion | ListPlaylists | ExtractPlaylist | SetApiKey
```

(garder la forme exacte des déclarations existantes, en y ajoutant seulement `SetApiKey`).

- [ ] **Step 5: Implémenter les handlers**

Dans `sidecar/src/tagger/handlers.py`, ajouter `from tagger.api_key import read_api_key, store_api_key` et `SetApiKey` à l'import du protocole, puis remplacer `handle_get_version` :

```python
def handle_get_version() -> Version:
    """Version nue et presence d'une cle : jamais la cle elle-meme (ADR-012)."""
    return Version(
        event="version",
        version=__version__,
        api_key_configured=read_api_key() is not None,
    )


def handle_set_api_key(command: SetApiKey) -> Version:
    """Range la cle puis rend la version : l'interface y lit que la cle existe."""
    store_api_key(command.api_key)
    return handle_get_version()
```

- [ ] **Step 6: Forcer le backend et dispatcher**

Dans `sidecar/src/tagger/__main__.py`, ajouter `import keyring`, `from keyring.backends.Windows import WinVaultKeyring`, et `handle_set_api_key`, `SetApiKey` aux imports existants. Remplacer le TODO keyring de `main()` par :

```python
    # Avant tout acces au secret : dans le binaire fige, la decouverte par entry
    # points rend une liste vide et keyring basculerait sur son backend `fail`.
    keyring.set_keyring(WinVaultKeyring())
```

Dans `_dispatch`, le trousseau étant bloquant, passer `GetVersion` par un thread et ajouter la branche :

```python
        case GetVersion():
            _write(stdout, emit(await asyncio.to_thread(handle_get_version)))
        case SetApiKey():
            _write(stdout, emit(await asyncio.to_thread(handle_set_api_key, command)))
```

- [ ] **Step 7: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_handlers.py tests/integration/test_ndjson_loop.py tests/unit/test_api_key.py -x -q`
Expected: PASS

- [ ] **Step 8: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 9: Commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py sidecar/tests/unit/test_handlers.py sidecar/tests/integration/test_ndjson_loop.py
git commit -m "feat(settings): commande set_api_key et presence reelle de la cle"
```

---

## Task 3: Miroir TypeScript et état de la clé dans le service

**Files:**
- Modify: `src/app/core/models/protocol.ts`
- Modify: `src/app/core/sidecar.service.ts`
- Test: `src/app/core/sidecar.service.spec.ts`

**Interfaces:**
- Consumes: commande `set_api_key` et événement `version` (Task 2)
- Produces: `SetApiKeyCommand` ; `SidecarService.apiKeyConfigured: Signal<boolean | null>`, `SidecarService.setApiKey(apiKey: string): Promise<void>`

- [ ] **Step 1: Écrire les tests du service**

Dans `src/app/core/sidecar.service.spec.ts`, dans le `describe("SidecarService")`, ajouter :

```typescript
  it("feeds the api key state from the version event", async () => {
    await service.start()

    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: true })

    expect(service.apiKeyConfigured()).toBe(true)
  })

  it("sends the api key command", async () => {
    await service.start()

    await service.setApiKey("k3y-t0k3n")

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
      command: "set_api_key",
      api_key: "k3y-t0k3n",
    })
  })
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm test --run src/app/core/sidecar.service.spec.ts`
Expected: FAIL, `service.apiKeyConfigured is not a function`

- [ ] **Step 3: Étendre le miroir du contrat**

Dans `src/app/core/models/protocol.ts`, après `ExtractPlaylistCommand` :

```typescript
export interface SetApiKeyCommand {
  readonly command: "set_api_key"
  /** Seul passage de la cle vers le sidecar : elle ne revient jamais vers la webview. */
  readonly api_key: string
}
```

et étendre l'union :

```typescript
export type SidecarCommand =
  | GetVersionCommand
  | ShutdownCommand
  | ListPlaylistsCommand
  | ExtractPlaylistCommand
  | SetApiKeyCommand
```

- [ ] **Step 4: Exposer l'état et la commande**

Dans `src/app/core/sidecar.service.ts` :

- après `private readonly _version` : `private readonly _apiKeyConfigured = signal<boolean | null>(null)` ;
- après `readonly version = ...` :

```typescript
  /** `null` tant que la version n'est pas arrivee : l'etat de la cle n'est pas encore connu. */
  readonly apiKeyConfigured = this._apiKeyConfigured.asReadonly()
```

- dans `restart()`, après `this._version.set(null)` : `this._apiKeyConfigured.set(null)` ;
- après `extractPlaylist` :

```typescript
  /**
   * La cle part une fois vers le sidecar et n'est gardee dans aucun signal : seul
   * son etat revient, par l'evenement `version`.
   */
  async setApiKey(apiKey: string): Promise<void> {
    await this.send({ command: "set_api_key", api_key: apiKey })
  }
```

- dans `handleLine`, branche `version` :

```typescript
      case "version":
        this._version.set(event.version)
        this._apiKeyConfigured.set(event.api_key_configured)
        break
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm test --run src/app/core/sidecar.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add src/app/core/models/protocol.ts src/app/core/sidecar.service.ts src/app/core/sidecar.service.spec.ts
git commit -m "feat(settings): exposer l'etat de la cle API cote webview"
```

---

## Task 4: Section API de l'onglet Settings

**Files:**
- Modify: `src/app/features/settings/settings-page.component.ts`
- Modify: `src/app/features/settings/settings-page.component.html`
- Create: `src/app/features/settings/settings-page.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: `SidecarService.apiKeyConfigured`, `setApiKey`, `available`, `lastError` (Task 3), `ErrorMessageComponent`

- [ ] **Step 0: Lire la maquette**

Lire `.design-sync/design-system/ui_kits/techno-tagger/SettingsScreen.jsx`, composant `SettingsScreen`, section « API », rangée « Clé X-API-Key », et la fiche `.design-sync/design-system/components/forms/Password.prompt.md`. Reprendre la structure (libellé et aide à gauche, contrôles à droite), jamais les valeurs ni le padding de page : le shell porte le container.

- [ ] **Step 1: Écrire les tests de la page**

Créer `src/app/features/settings/settings-page.component.spec.ts` :

```typescript
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { SidecarService } from "../../core/sidecar.service"

import SettingsPageComponent from "./settings-page.component"

/**
 * Ce qui se teste ici est la disponibilite de l'enregistrement et la commande
 * emise : la cle ne doit jamais rester dans l'ecran une fois envoyee.
 */
function mountWith(overrides: Partial<Record<string, unknown>> = {}) {
  const service = {
    apiKeyConfigured: signal<boolean | null>(false),
    available: signal(true),
    lastError: signal(null),
    setApiKey: vi.fn(() => Promise.resolve()),
    ...overrides,
  }

  TestBed.configureTestingModule({
    imports: [SettingsPageComponent],
    providers: [provideTranslateService(), { provide: SidecarService, useValue: service }],
  })

  const fixture = TestBed.createComponent(SettingsPageComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service }
}

describe("SettingsPageComponent", () => {
  it("shows whether a key is configured", () => {
    const { fixture } = mountWith({ apiKeyConfigured: signal(true) })

    const text = (fixture.nativeElement as HTMLElement).textContent ?? ""

    expect(text).toContain("settings.api.key.configured")
  })

  it("disables saving while the field is empty", () => {
    const { component } = mountWith()

    const enabled = component["canSave"]()

    expect(enabled).toBe(false)
  })

  it("sends the key then clears the field", async () => {
    const { component, service } = mountWith()
    component["entry"].set({ apiKey: "k3y-t0k3n" })

    await component["save"]()

    expect(service.setApiKey).toHaveBeenCalledWith("k3y-t0k3n")
    expect(component["entry"]().apiKey).toBe("")
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm test --run src/app/features/settings/settings-page.component.spec.ts`
Expected: FAIL, `component.canSave is not a function`

- [ ] **Step 3: Implémenter le composant**

Remplacer `src/app/features/settings/settings-page.component.ts` :

```typescript
import { Component, computed, inject, signal } from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Label } from "primeng/label"
import { Password } from "primeng/password"
import { Tag } from "primeng/tag"

import { SidecarService } from "../../core/sidecar.service"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"

interface ApiKeyEntry {
  apiKey: string
}

/** Erreurs que seul l'enregistrement de la cle peut produire dans cet ecran. */
const API_KEY_ERRORS: ReadonlySet<string> = new Set([
  "api_key_not_stored",
  "keyring_unavailable",
  "malformed_command",
  "sidecar_unavailable",
])

/**
 * Section API, seule livree par la Feature 2 : les autres reglages (seuils, langue,
 * signal sonore, cache, logs) arrivent avec la Feature 7.
 */
@Component({
  selector: "app-settings-page",
  imports: [TranslatePipe, FormField, ButtonDirective, Label, Password, Tag, ErrorMessageComponent],
  templateUrl: "./settings-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class SettingsPageComponent {
  private readonly sidecar = inject(SidecarService)

  /** Jamais prerempli : la cle n'est pas relue depuis le trousseau (ADR-012). */
  protected readonly entry = signal<ApiKeyEntry>({ apiKey: "" })
  protected readonly fields = form(this.entry)
  protected readonly apiKeyConfigured = this.sidecar.apiKeyConfigured
  protected readonly canSave = computed(
    () => this.entry().apiKey !== "" && this.sidecar.available() === true,
  )
  protected readonly error = computed(() => {
    const error = this.sidecar.lastError()

    return error !== null && API_KEY_ERRORS.has(error.code) ? error : null
  })

  /** Le champ est vide avant l'envoi : un double clic ne renvoie rien. */
  protected async save(): Promise<void> {
    const apiKey = this.entry().apiKey
    if (apiKey === "") {
      return
    }
    this.entry.set({ apiKey: "" })
    await this.sidecar.setApiKey(apiKey)
  }
}
```

Remplacer `src/app/features/settings/settings-page.component.html` :

```html
<div class="flex flex-col gap-6">
  <h1 class="text-2xl font-semibold">{{ "settings.title" | translate }}</h1>

  <section class="flex flex-col gap-4">
    <h2 class="text-xl font-semibold">{{ "settings.api.title" | translate }}</h2>

    <div class="grid grid-cols-[max-content_1fr] items-start gap-4">
      <div class="flex flex-col gap-1">
        <label pLabel for="api-key">{{ "settings.api.key.label" | translate }}</label>
        <span class="text-xs text-muted-color">{{ "settings.api.key.hint" | translate }}</span>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <p-password
            inputId="api-key"
            size="small"
            [formField]="fields.apiKey"
            [feedback]="false"
            [toggleMask]="true"
            [placeholder]="'settings.api.key.placeholder' | translate"
          />
          <button pButton type="button" size="small" [disabled]="!canSave()" (click)="save()">
            {{ "settings.api.key.save" | translate }}
          </button>
          @switch (apiKeyConfigured()) {
            @case (true) {
              <p-tag severity="success" [value]="'settings.api.key.configured' | translate" />
            }
            @case (false) {
              <p-tag severity="secondary" [value]="'settings.api.key.missing' | translate" />
            }
          }
        </div>

        @if (error(); as shown) {
          <app-error-message [error]="shown" />
        }
      </div>
    </div>
  </section>
</div>
```

Le `@switch` n'affiche rien tant que l'état vaut `null` : la version n'est pas encore arrivée.

- [ ] **Step 4: Ajouter les libellés**

Dans `public/i18n/fr.json`, remplacer le bloc `"settings"` par :

```json
  "settings": {
    "title": "Réglages",
    "api": {
      "title": "API",
      "key": {
        "label": "Clé X-API-Key",
        "hint": "Rangée dans le trousseau de Windows, jamais affichée : saisissez-la de nouveau pour la remplacer.",
        "placeholder": "Saisir la clé reçue",
        "save": "Enregistrer",
        "configured": "Clé enregistrée",
        "missing": "Aucune clé"
      }
    }
  }
```

et ajouter dans `"errors"` :

```json
    "api_key_not_stored": "La clé n'a pas pu être rangée dans le trousseau de Windows. Réessayez.",
    "keyring_unavailable": "Le trousseau de Windows est inaccessible. Relancez l'application.",
```

Dans `public/i18n/en.json`, même structure :

```json
  "settings": {
    "title": "Settings",
    "api": {
      "title": "API",
      "key": {
        "label": "X-API-Key",
        "hint": "Stored in the Windows credential manager, never shown: enter it again to replace it.",
        "placeholder": "Enter the key you received",
        "save": "Save",
        "configured": "Key saved",
        "missing": "No key"
      }
    }
  }
```

```json
    "api_key_error": "The API key could not be saved.",
    "api_key_not_stored": "The key could not be stored in the Windows credential manager. Try again.",
    "keyring_unavailable": "The Windows credential manager is unavailable. Restart the application.",
```

`api_key_error` est le code de la classe de base `ApiKeyError`, jamais levée telle quelle : `test_error_translations.py` l'exige quand même, comme il exige déjà `extraction_error`. Sa phrase française : « La clé API n'a pas pu être enregistrée. ». Garder l'ordre des clés identique dans les deux fichiers : `translations.spec.ts` compare leurs clés.

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm test --run src/app/features/settings/settings-page.component.spec.ts src/app/core/translations.spec.ts`
Expected: PASS

- [ ] **Step 6: Gate qualité et contrôle visuel**

Run: `just test && just lint && just typecheck`
Expected: tout vert

Puis `just dev`, onglet Settings : comparer la section à la maquette `SettingsScreen.jsx` (section « API »), en FR et en EN, et vérifier qu'aucun libellé ne déborde à 1024 px de large.

- [ ] **Step 7: Commit**

```bash
git add src/app/features/settings/ public/i18n/fr.json public/i18n/en.json
git commit -m "feat(settings): saisir la cle API dans l'onglet Settings"
```

---

## Task 5: Documentation réalignée sur l'URL figée

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/adrs/012-securite-cle-api-keyring.md`, `docs/knowledges/techno-scraper.md`, `docs/knowledges/tauri.md`, `docs/DESIGN.md`, `docs/PRODUCTION.md`, `docs/BRAINSTORM.md`, `.claude/rules/keyring/secrets.md`

- [ ] **Step 1: ARCHITECTURE.md**

- § Arborescence, ligne de `settings/` : retirer `URL, ` de `# clé API, URL, langue, seuils, copie/déplacement,`.
- § Capacités Natives, ligne `store`, remplacer par :

```markdown
| `store` | Préférences : langue, seuils, mode copie / déplacement, signal sonore. L'URL de l'API n'y figure pas : c'est une constante du sidecar, seul à appeler techno-scraper (décision du 2026-09-19) |
```

- § API, table des commandes, remplacer la ligne `set_api_key` / `set_api_url` / `clear_cache` par :

```markdown
| `set_api_key` / `clear_cache` | administration depuis les Settings. `set_api_key` est le seul passage de la clé dans le protocole, sa réponse est l'événement `version`. Pas de `set_api_url` : l'URL est une constante du sidecar (décision du 2026-09-19) |
```

- [ ] **Step 2: ADR-012**

Remplacer la dernière phrase des Notes complémentaires (« L'URL de l'API est également configurable dans les Settings… ») par :

```markdown
L'URL de l'API n'est pas un secret : elle est publique et présente en clair dans le binaire distribué. Prévue d'abord configurable dans les Settings, elle est figée en constante du sidecar depuis le 2026-09-19, l'application n'ayant qu'une API à appeler.
```

- [ ] **Step 2b: Autres docs qui portent l'ancien état**

Dans `docs/knowledges/tauri.md`, table des plugins, ligne `store` : retirer « URL de l'API » de la liste des préférences. Dans les Points Importants, remplacer la puce « **L'URL de l'API est persistée dans le `store` mais transmise au sidecar par une commande** […] » par :

```markdown
- **Le `store` n'est pas lisible depuis Python** : une préférence que le sidecar doit connaître lui est transmise par une commande NDJSON, jamais lue dans le fichier. L'URL de l'API, elle, est une constante du sidecar (ADR-012, note du 2026-09-19)
```

Dans `.claude/rules/keyring/secrets.md` § À faire, remplacer la puce « Valider une clé par un appel à `/health` puis à une route authentifiée, jamais par sa forme : une clé bien formée peut être révoquée » par :

```markdown
- Ne jamais valider une clé par sa forme au-delà d'un contrôle de saisie : une clé bien formée peut être révoquée. La preuve vient de l'API, à l'usage (garde des trois 403 du pipeline), pas d'un appel à l'enregistrement (décision du 2026-09-19, spec de la clé API)
```

Dans `docs/ARCHITECTURE.md` § Ordre de développement, ligne de l'étape 5, remplacer « Onglet playlist, câblage i18n, **saisie et stockage keyring de la clé API** » par « Onglet playlist, câblage i18n » et, dans la colonne de droite, remplacer « La clé doit exister avant l'étape 6, qui ne peut pas tourner sans elle. » par « La clé API, prévue ici, a été livrée en tête de l'étape 6 (sub-project `cle-api` de la Feature 2), avant le pipeline qui ne peut pas tourner sans elle. ».

- [ ] **Step 3: knowledges/techno-scraper.md**

Remplacer la puce « Le sidecar est le seul composant à appeler l'API. L'URL est persistée côté Tauri… » par :

```markdown
- Le sidecar est le seul composant à appeler l'API. L'URL est une constante du sidecar (`API_BASE_URL` de `scraper_client.py`, décision du 2026-09-19) : la webview n'émet jamais de requête vers l'API et ne connaît pas son URL
```

- [ ] **Step 4: DESIGN.md, PRODUCTION.md, BRAINSTORM.md**

- DESIGN.md § Settings : supprimer la ligne « URL de l'API » du tableau.
- PRODUCTION.md § Variables d'Environnement, table des réglages, remplacer la ligne « URL de l'API, langue, seuils… » par :

```markdown
| Langue, seuils, mode copie / déplacement, signal sonore | Store Tauri (fichier local) | Réglages non sensibles. L'URL de l'API n'en fait plus partie : constante du sidecar depuis le 2026-09-19 |
```

- BRAINSTORM.md, Feature 7, après la note « Décidé autrement depuis » existante, ajouter :

```markdown
> ⚠️ **Décidé autrement depuis** : l'URL de l'API n'est pas un réglage. Elle est figée en constante du sidecar le 2026-09-19, et seule la clé se saisit dans les Settings, livrée avec la Feature 2.
```

- [ ] **Step 5: Vérifier qu'aucune mention ne subsiste**

Run: `grep -rn "set_api_url" docs/ sidecar/ src/ .claude/rules/`
Expected: aucune ligne, hors specs et plans de `docs/superpowers/`

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md docs/adrs/012-securite-cle-api-keyring.md docs/knowledges/techno-scraper.md docs/knowledges/tauri.md docs/DESIGN.md docs/PRODUCTION.md docs/BRAINSTORM.md .claude/rules/keyring/secrets.md
git commit -m "docs: figer l'URL de l'API dans le sidecar"
```
