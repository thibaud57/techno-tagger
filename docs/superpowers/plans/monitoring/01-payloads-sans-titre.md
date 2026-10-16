# Payloads Sentry sans titre de morceau : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir qu'aucun titre de morceau, nom de fichier ni clé API n'atteint un payload Sentry, côté sidecar comme côté webview, prouvé par un test sur l'enveloppe réellement construite.

**Architecture:** Le sidecar passe à `data_collection` (chaque catégorie fermée), `_scrub` masque le message de toute exception hors d'une liste fermée de types et `_validate` construit un détail d'`ApiContractError` sans aucune valeur. Le motif de chemin devient sensible aux guillemets des deux côtés, `scrub.ts` s'aligne sur le sidecar et `sentry-options.ts` ferme les catégories de collecte encore ouvertes. Un test initialise le vrai SDK avec un transport factice et inspecte l'enveloppe.

**Tech Stack:** Python 3.14, sentry-sdk 2.71.0, pydantic 2.14, httpx2, pytest + pytest-asyncio (mode strict) ; Angular 22, @sentry/angular 11, Vitest.

**Spec:** `docs/superpowers/specs/monitoring/01-payloads-sans-titre-design.md`

## Global Constraints

- `sentry-sdk>=2.71.0,<3` (plancher de `sidecar/pyproject.toml`) : `data_collection` est une option de premier niveau depuis la 2.70.0
- Dès que `data_collection` est posé, le SDK ne lit plus `include_local_variables` et une catégorie omise est collectée : `stack_frame_variables` doit valoir `False` explicitement
- Liste fermée au départ : `tagger.resolution.scraper_client.ApiContractError`, rien d'autre
- Masques : `<message>` (`MESSAGE_MASK`), `<path>` (`PATH_MASK`), `<query>` (`QUERY_MASK`), `<user>` (`MASK`)
- Aucun test ne fait d'appel réseau ni ne consomme le quota Sentry : le test de l'enveloppe (Task 5) initialise le vrai SDK avec un transport factice, exception que la Task 7 inscrit dans `.claude/rules/pytest/tests.md`
- La liste fermée se juge sur `module` et `type` d'origine, avant `_mask_deep` : le masquage du compte de l'OS réécrit `module` quand le nom de compte en est une sous-chaîne
- Une valeur attendue dans l'enveloppe s'asserte sur le champ de l'événement (`exception.values`), jamais par sa présence dans le texte : le SDK joint cinq lignes de source autour de la frame du test, donc la littérale de l'assertion y figure
- Tests nommés en anglais, AAA séparés par une ligne vide, sans commentaire de section ; commentaires et docstrings en français, sans accents dans le code (convention du dépôt)
- Ruff `line-length = 100`, Mypy strict ; ESLint `func-style` : toute fonction TS en `const nom = (...) => ...`
- Aucun titre en dur à moins de cinq lignes d'une frame qui lève dans un test de l'enveloppe : le SDK joint cinq lignes de contexte source par frame, le test échouerait sur sa propre source. Les valeurs viennent des constantes de `tests/helpers/scraper_responses.py` ou d'une constante de module en tête de fichier
- Données de test : conventions fictives du dépôt (`Nova Pulse - Your Mind.mp3`, `jane`, `api.example`), fixtures existantes de `scraper_responses.py`

## Review Focus

- **Nom de fichier avec apostrophe dans un message** (« Don't Stop.mp3 ») : masqué en entier, nu, entre guillemets doubles et entre apostrophes (« Guns N' Roses.mp3 » compris : un chemin ouvert par `'` court jusqu'à la dernière apostrophe de la ligne). Le texte entre deux apostrophes après un chemin est avalé avec lui, sur-masquage accepté. Tests en Task 2 et Task 6
- **Nom de compte de l'OS sous-chaîne du module d'`ApiContractError`** : la liste fermée se juge avant le masquage, le message reste lisible. Test en Task 3
- **`ExceptionGroup` d'un `TaskGroup` qui remonte un `TagsWriteError`** : le groupe est levé, chaque entrée de `exception.values` sort en `<message>`, aucun fragment du nom. Test en Task 5
- **Montée de sentry-sdk qui ajoute une catégorie de collecte** (`mcp` annoncée) : le garde-fou échoue en la nommant. Test en Task 5
- **Client Sentry réel laissé actif après le test de l'enveloppe** : la suite suivante ne doit rien voir. La fixture ferme le client, remet un `NonRecordingClient` et le vérifie dans son teardown, en Task 5
- **Webview : catégories de `dataCollection` omises** : `sentry-options.ts` ferme les dix catégories connues au 2026-10-16 (`@sentry/core` 11.6.0). Aucun garde-fou d'exécution ne signale une catégorie ajoutée par une montée. Test en Task 6
- **Détail d'`ApiContractError` qui se mettrait à porter une valeur** : le test exige le message exact, sans valeur. Test en Task 1

---

### Task 1 : détail d'`ApiContractError` sans valeur

**Files:**
- Modify: `sidecar/src/tagger/resolution/scraper_client.py:395-402` (`_validate`)
- Test: `sidecar/tests/unit/resolution/test_scraper_client_errors.py`

**Interfaces:**
- Consumes : `ApiContractError(detail: str, *, request_id: str)`, message `f"api contract broken: {detail}"`
- Produces : `_contract_detail(model: type[BaseModel], error: ValidationError) -> str`, forme `"<Modele>: <loc> <type>; <loc> <type>"`, indices en `*`, doublons retirés, type seul quand l'erreur est à la racine. Task 5 lit `"api contract broken: TrackPage: items.*.bpm int_parsing"` dans l'entrée `ApiContractError` de `exception.values`

- [ ] **Step 1 : écrire le test qui échoue**

`track_payload`, `invalid_track_payload` et `page_payload` sont déjà importés. Ajouter après `test_raises_api_contract_error_on_a_response_that_does_not_validate` :

```python
async def test_names_each_failing_field_without_any_received_value(
    requests: list[httpx2.Request],
) -> None:
    """Ce message part vers Sentry : emplacement et type de chaque erreur, jamais la valeur."""
    items = (invalid_track_payload(), invalid_track_payload(), track_payload(bpm="fast"))
    response = httpx2.Response(200, json=page_payload(*items))

    async with make_client(recording(requests, response)) as client:
        with pytest.raises(ApiContractError) as error:
            await client.search(Source.BEATPORT, YOUR_MIND)

    assert str(error.value) == (
        "api contract broken: TrackPage: items.*.title missing; items.*.bpm int_parsing"
    )


async def test_names_only_the_type_of_an_error_at_the_root_of_the_response(
    requests: list[httpx2.Request],
) -> None:
    """Une réponse qui n'est pas un objet n'a pas d'emplacement à nommer."""
    response = httpx2.Response(200, json=[])

    async with make_client(recording(requests, response)) as client:
        with pytest.raises(ApiContractError) as error:
            await client.search(Source.BEATPORT, YOUR_MIND)

    assert str(error.value) == "api contract broken: TrackPage: model_type"
```

- [ ] **Step 2 : lancer les tests, ils échouent**

Run : `cd sidecar && uv run pytest tests/unit/resolution/test_scraper_client_errors.py -x -q -k "names_each_failing_field or names_only_the_type"`
Expected : FAIL, le message vaut `api contract broken: TrackPage`

- [ ] **Step 3 : implémenter**

Remplacer `_validate` par :

```python
def _validate[M: BaseModel](model: type[M], response: _ApiResponse) -> M:
    """Seul point de validation d'un corps de reponse."""
    try:
        return model.model_validate(response.payload)
    except ValidationError as exc:
        # `from exc` garde la cause dans le log local, qui a droit aux valeurs. Sentry, lui,
        # ne recoit que le detail : le message de la `ValidationError` y part en `<message>`.
        detail = _contract_detail(model, exc)
        raise ApiContractError(detail, request_id=response.request_id) from exc


def _contract_detail(model: type[BaseModel], error: ValidationError) -> str:
    """Modele, puis emplacement et type de chaque erreur, sans aucune valeur recue.

    Ce detail part vers Sentry (`ApiContractError` est dans la liste fermee de
    `core/observability`) : `input` y mettrait la reponse, donc artistes et titres. Indices
    remplaces par `*` et doublons retires, une derive sur cent items tient en une ligne. Un
    champ `dict` valide cle par cle mettrait une cle de la reponse dans `loc` : il ne
    s'ajoute a un modele qu'en sortant ses cles d'ici.
    """
    # Le souligne d'un modele interne n'apprend rien a qui lit le log.
    shape = model.__name__.removeprefix("_")
    errors = error.errors(include_input=False, include_url=False, include_context=False)
    # `lstrip` : une erreur a la racine a un emplacement vide, sans lui le type serait precede
    # d'une espace de trop.
    fields = dict.fromkeys(f"{_field(item['loc'])} {item['type']}".lstrip() for item in errors)
    return f"{shape}: {'; '.join(fields)}"


def _field(loc: tuple[int | str, ...]) -> str:
    return ".".join("*" if isinstance(part, int) else part for part in loc)
```

- [ ] **Step 4 : lancer les tests du module, ils passent**

Run : `cd sidecar && uv run pytest tests/unit/resolution/ -x -q`
Expected : PASS

- [ ] **Step 5 : commit**

```bash
git add sidecar/src/tagger/resolution/scraper_client.py sidecar/tests/unit/resolution/test_scraper_client_errors.py
git commit -m "fix(sidecar): nommer les champs d'une dérive de l'API sans aucune valeur reçue"
```

---

### Task 2 : motif de chemin sensible aux guillemets (sidecar)

**Files:**
- Modify: `sidecar/src/tagger/core/observability.py:33-45` (`_WINDOWS_PATH`)
- Test: `sidecar/tests/unit/core/test_observability.py`

**Interfaces:**
- Consumes : `_mask(text: str) -> str`, inchangé
- Produces : `_WINDOWS_PATH` qui masque en entier un chemin nu contenant une apostrophe, un chemin entre guillemets doubles et un chemin entre apostrophes dont le nom porte une apostrophe, avant une lettre ou avant une espace

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter au paramétrage de `test_scrubbing_stops_a_path_before_the_log_fields_without_leaking_the_name` six cas et leurs `ids` :

```python
        (
            r"cannot open D:\Music\Nova Pulse - Don't Stop.mp3: permission denied",
            f"cannot open {PATH_MASK}: permission denied",
        ),
        (
            r"""cannot open "D:\Music\Nova Pulse - Don't Stop.mp3": permission denied""",
            f'cannot open "{PATH_MASK}": permission denied',
        ),
        (
            str(OSError(2, "No such file or directory", r"D:\Music\Nova Pulse - Don't Stop.mp3")),
            f'[Errno 2] No such file or directory: "{PATH_MASK}"',
        ),
        (
            r"cannot open 'D:\Music\Nova Pulse - Don't Stop.mp3' failed",
            f"cannot open '{PATH_MASK}' failed",
        ),
        (
            r"cannot open 'D:\Music\Nova Pulse - Guns N' Roses.mp3' failed",
            f"cannot open '{PATH_MASK}' failed",
        ),
        (
            r"'D:\Music\Nova Pulse - Your Mind.mp3' from user's folder",
            f"'{PATH_MASK}'s folder",
        ),
```

ids ajoutés : `"apostrophe-in-bare-name"`, `"apostrophe-in-double-quoted-name"`, `"oserror-repr-with-apostrophe"`, `"apostrophe-in-single-quoted-name"`, `"word-final-apostrophe-in-single-quoted-name"`, `"text-between-apostrophes-after-a-quoted-path"` (ce dernier fixe le sur-masquage accepté : « s folder » reste, le texte intermédiaire est avalé).

Mettre à jour l'assertion de fuite du même test pour qu'elle couvre les nouveaux mots :

```python
    assert not {"Nova", "Pulse", "Your", "Mind", "Don't", "Stop.mp3", "Guns", "Roses.mp3"} & set(
        str(scrubbed).replace(",", " ").replace('"', " ").split()
    )
```

- [ ] **Step 2 : lancer, les cas à apostrophe échouent**

Run : `cd sidecar && uv run pytest tests/unit/core/test_observability.py -x -q -k stops_a_path`
Expected : FAIL sur `apostrophe-in-bare-name` (reste `'t Stop.mp3`) et sur les trois cas entre apostrophes

- [ ] **Step 3 : implémenter**

Remplacer le commentaire et la définition de `_WINDOWS_PATH` par :

```python
# Debut d'un chemin : lettre de lecteur (`D:\`, `D:/`) ou partage UNC (`\\serveur\`).
_PATH_START: Final = r"(?:[A-Za-z]:[\\/]|\\\\[^\s\\/'\"<>]+[\\/])"

# Le nom du fichier porte l'artiste et le titre, donc un morceau. Un chemin ouvert par un
# guillemet court jusqu'au guillemet suivant : `repr()` entoure de `"` un chemin qui contient
# une apostrophe (« Don't Stop.mp3 »), de `'` les autres. Un chemin ouvert par `'` court jusqu'a
# la derniere apostrophe de la ligne (glouton, avec lookahead) : une apostrophe du nom, qu'elle
# precede une lettre ou une espace (« Guns N' Roses »), ne le ferme donc pas. Sans apostrophe
# fermante, il court jusqu'a la fin de ligne. Le texte entre deux apostrophes apres le chemin
# (`'D:\x.mp3' from user's folder`) est avale avec lui, sur-masquage accepte. Un chemin nu garde
# ses espaces et ses apostrophes et s'arrete a `"`, `<>`, a la fin de ligne, avant un champ
# logfmt de la liste fermee des cles de log (voir `gestion-erreurs.md`) et avant `: `
# (Windows interdit `:` dans un nom de fichier). Pas de `, ` ni de cle generique `[a-z_]+=` :
# un nom de fichier peut en contenir (« Artist A, Artist B », « vol=2 ») et la fin du nom
# partirait alors vers Sentry. Une phrase qui suit sans separateur est avalee, sens de panne
# accepte. Un chemin nu ne suit ni un caractere de mot, sinon `http://` serait pris pour `p:/`,
# ni un guillemet, que les deux premieres branches traitent.
_WINDOWS_PATH: Final = re.compile(
    rf"(?<=\"){_PATH_START}[^\"\r\n]*"
    rf"|(?<='){_PATH_START}(?:[^\r\n]*(?=')|[^'\r\n]*)"
    rf"|(?<![\w'\"]){_PATH_START}"
    r"(?:(?!\s+(?:run|track|source|score|status|reason|request_id)=|:\s)[^\"<>\r\n])*"
)
```

- [ ] **Step 4 : lancer le module, tout passe**

Run : `cd sidecar && uv run pytest tests/unit/core/test_observability.py -x -q`
Expected : PASS, y compris `drive-backslash`, `unc`, `logfmt-fields`, `key-lookalike-in-name` et `test_scrubbing_does_not_take_a_url_scheme_for_a_drive`

- [ ] **Step 5 : commit**

```bash
git add sidecar/src/tagger/core/observability.py sidecar/tests/unit/core/test_observability.py
git commit -m "fix(sidecar): masquer en entier un chemin dont le nom porte une apostrophe"
```

---

### Task 3 : liste fermée des messages d'exception dans `_scrub`

**Files:**
- Modify: `sidecar/src/tagger/core/observability.py` (`MESSAGE_MASK`, `_SAFE_MESSAGE_TYPES`, `_keeps_message`, `_mask_message`, `_exception_entries`, `_scrub`)
- Test: `sidecar/tests/unit/core/test_observability.py`

**Interfaces:**
- Consumes : `_mask_deep(value: object) -> object`, inchangé
- Produces : `MESSAGE_MASK: Final = "<message>"` (importé par Task 5), `_SAFE_MESSAGE_TYPES: Final[frozenset[str]]` de noms qualifiés `module.Type`, jugés sur `module` et `type` d'origine avant `_mask_deep`

- [ ] **Step 1 : écrire les tests qui échouent et reprendre ceux que la règle change**

Importer `MESSAGE_MASK` dans l'import existant de `tagger.core.observability`. Ajouter en tête de module, après `SEARCH_URL` :

```python
CONTRACT_ERROR_MODULE: Final = ApiContractError.__module__


def _contract_entry(value: str) -> dict[str, object]:
    return {"type": ApiContractError.__name__, "module": CONTRACT_ERROR_MODULE, "value": value}
```

Nouveaux tests :

```python
@pytest.mark.parametrize(
    ("type_name", "module", "value"),
    [
        ("TagsWriteError", "tagger.tags.files", "tags not written: Nova Pulse - Your Mind.mp3"),
        ("KeyError", None, "'Albums/Nova Pulse - Your Mind.mp3'"),
        ("ValidationError", "pydantic_core._pydantic_core", "input_value='Your Mind'"),
    ],
    ids=["own-error-with-file-name", "key-error-on-track-id", "pydantic-input-value"],
)
def test_scrubbing_masks_the_message_of_an_exception_outside_the_closed_list(
    type_name: str, module: str | None, value: str
) -> None:
    """Le texte libre ne permet pas de reconnaitre un titre : seul un type declare sans
    donnee garde son message. Type, module et pile partent toujours. Le SDK pose `module` a
    `None` pour un builtin.
    """
    entry = {"type": type_name, "module": module, "value": value, "stacktrace": {"frames": []}}
    event = {"exception": {"values": [entry]}}

    scrubbed = _scrubbed(event)

    assert scrubbed == {"exception": {"values": [{**entry, "value": MESSAGE_MASK}]}}


@pytest.mark.usefixtures("jane_home")
def test_scrubbing_keeps_the_message_of_a_closed_list_type_with_paths_masked() -> None:
    event = {"exception": {"values": [_contract_entry(r"TrackPage under C:\Users\jane\x.json")]}}

    scrubbed = _scrubbed(event)

    assert scrubbed == {"exception": {"values": [_contract_entry(f"TrackPage under {PATH_MASK}")]}}


def test_scrubbing_masks_a_closed_list_name_raised_from_another_module() -> None:
    entry = {"type": ApiContractError.__name__, "module": "vendor.client", "value": "Your Mind"}
    event = {"exception": {"values": [entry]}}

    scrubbed = _scrubbed(event)

    assert scrubbed == {"exception": {"values": [{**entry, "value": MESSAGE_MASK}]}}


def test_scrubbing_keeps_a_closed_list_message_when_the_account_name_is_part_of_its_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Le masquage du compte de l'OS réécrit `module` : la liste se juge avant lui."""
    monkeypatch.setattr(obs, "_USERNAME", "client")
    entry = _contract_entry("api contract broken: TrackPage: items.*.bpm int_parsing")
    event = {"exception": {"values": [entry]}}

    scrubbed = _scrubbed(event)

    module = CONTRACT_ERROR_MODULE.removesuffix("client") + MASK
    assert scrubbed == {"exception": {"values": [{**entry, "module": module}]}}
```

Reprendre les tests existants qui posaient une valeur d'exception sans `module` (ils échoueraient sous la nouvelle règle pour une raison sans rapport avec ce qu'ils vérifient) :

1. `test_scrubbing_masks_the_username_at_any_depth` : remplacer l'entrée d'exception par `_contract_entry("cannot open C:/Users/jane/Music/set.flac")` augmentée de `"stacktrace": {"frames": [{"abs_path": r"C:\Users\jane\app\run.py"}]}` et l'attendu par `{**_contract_entry(f"cannot open {PATH_MASK}"), "stacktrace": {"frames": [{"abs_path": rf"{MASK}\app\run.py"}]}}`. `tags` et `extra` inchangés.

2. Remplacer `test_scrubbing_strips_the_search_query_a_chained_error_carries` par :

```python
def test_scrubbing_leaves_no_search_query_from_a_chained_http_error() -> None:
    """Le message d'httpx2 porte l'URL de la recherche, donc l'artiste et le titre : hors de
    la liste fermee, il part en `<message>`. Le detail d'`ApiContractError` reste lisible.
    """
    error = _chained_contract_error("Adam Beyer Your Mind")
    assert error.__cause__ is not None
    event = {
        "exception": {
            "values": [
                {"type": "HTTPStatusError", "module": "httpx2", "value": str(error.__cause__)},
                _contract_entry(str(error)),
            ]
        }
    }

    scrubbed = _scrubbed(event)

    rendered = str(scrubbed)
    # Par fragment d'un seul mot : l'URL encode les espaces, « Adam Beyer » n'y
    # apparaitrait de toute facon pas tel quel et l'assertion passerait a vide.
    assert "Beyer" not in rendered
    assert "Mind" not in rendered
    assert scrubbed == {
        "exception": {
            "values": [
                {"type": "HTTPStatusError", "module": "httpx2", "value": MESSAGE_MASK},
                _contract_entry("api contract broken: status 422"),
            ]
        }
    }
```

3. `test_scrubbing_strips_a_query_that_carries_a_second_question_mark` : poser le message dans un champ libre, `event = {"message": message}`, assertions inchangées.

4. `test_scrubbing_masks_a_drive_or_unc_path_outside_the_home` : `event = {"message": f"cannot open '{path}'"}`, attendu `{"message": f"cannot open '{PATH_MASK}'"}`.

5. `test_scrubbing_does_not_take_a_url_scheme_for_a_drive` : `event = {"message": message}`.

- [ ] **Step 2 : lancer, les nouveaux tests échouent**

Run : `cd sidecar && uv run pytest tests/unit/core/test_observability.py -x -q`
Expected : FAIL sur `test_scrubbing_masks_the_message_of_an_exception_outside_the_closed_list` (`MESSAGE_MASK` absent, ou valeur gardée)

- [ ] **Step 3 : implémenter**

Dans `observability.py`, après `PATH_MASK` :

```python
MESSAGE_MASK: Final = "<message>"

# Types dont le message ne porte aucune donnee de l'utilisateur, par nom qualifie : `core/`
# n'importe aucun package metier. Tout autre message part en `MESSAGE_MASK`, ceux du sidecar
# compris : ils portent `path.name` ou un `track_id`, chemin relatif du fichier qu'aucun motif
# de chemin absolu ne reconnait. Un type n'entre ici que si son message est construit sans
# chemin, sans nom de fichier et sans valeur recue de l'API (cf. ADR-014, mise a jour du
# 2026-10-15).
_SAFE_MESSAGE_TYPES: Final = frozenset({"tagger.resolution.scraper_client.ApiContractError"})
```

Ajouter `from collections.abc import Mapping` dans le bloc `if TYPE_CHECKING:` (au-dessus de l'import de `sentry_sdk.types`). Avant `_scrub` :

```python
def _keeps_message(entry: object) -> bool:
    """Vrai pour un type de `_SAFE_MESSAGE_TYPES`, juge sur `module` et `type` du SDK.

    A appeler avant `_mask_deep` : il remplace le nom de compte de l'OS jusque dans `module`,
    et un compte qui en est une sous-chaine (`client`) ferait perdre le message d'un type sur.
    """
    match entry:
        case {"module": str() as module, "type": str() as name}:
            return f"{module}.{name}" in _SAFE_MESSAGE_TYPES
        case _:
            return False


def _mask_message(entry: object) -> object:
    match entry:
        case {"value": _, **rest}:
            return {**rest, "value": MESSAGE_MASK}
        case _:
            return entry


def _exception_entries(event: Event) -> list[object]:
    match cast("Mapping[str, object]", event).get("exception"):
        case {"values": list() as values}:
            return values
        case _:
            return []
```

Remplacer `_scrub` par :

```python
def _scrub(event: Event, _hint: Hint) -> Event | None:
    """Masque ce qui designe un morceau ou le compte de l'OS : chemins de frames, tags,
    contextes, et le message de toute exception hors de la liste fermee. Le parcours est
    recursif et sans liste de champs, pour qu'un nouveau champ soit couvert d'office.

    La liste se juge sur les champs de l'evenement, pas sur l'exception du `hint` : la regle
    couvre de la meme facon `capture_unexpected`, le crash attrape par l'excepthook du SDK et
    chaque membre d'un `ExceptionGroup`. Type, module et pile restent, seule `value` part.
    """
    keeps = [_keeps_message(entry) for entry in _exception_entries(event)]
    masked = {
        key: value if key in _ENVELOPE_KEYS else _mask_deep(value) for key, value in event.items()
    }
    match masked.get("exception"):
        case {"values": list() as values, **rest}:
            masked["exception"] = {
                **rest,
                "values": [
                    entry if keep else _mask_message(entry)
                    for entry, keep in zip(values, keeps, strict=True)
                ],
            }
        case _:
            pass
    # Mypy ne reconstruit pas un TypedDict a cles dynamiques (`Event(**masked)` est refuse) :
    # le dict garde exactement les cles de `event`, seules les valeurs sont masquees.
    return cast("Event", masked)
```

- [ ] **Step 4 : lancer le module, tout passe, puis le typage**

Run : `cd sidecar && uv run pytest tests/unit/core/test_observability.py -x -q && uv run mypy src tests`
Expected : PASS, `Success: no issues found`

- [ ] **Step 5 : commit**

```bash
git add sidecar/src/tagger/core/observability.py sidecar/tests/unit/core/test_observability.py
git commit -m "fix(sidecar): masquer le message de toute exception hors d'une liste fermée de types sans donnée"
```

---

### Task 4 : `data_collection` fermé

**Files:**
- Modify: `sidecar/src/tagger/core/observability.py` (`init_sentry`, appel de `sentry_sdk.init`)
- Test: `sidecar/tests/unit/core/test_observability.py` (`test_a_set_dsn_applies_the_hardening_settings`)

**Interfaces:**
- Produces : `init_sentry(dsn: str, release: str) -> None` inchangé en signature, passe `data_collection` et plus `include_local_variables`. Task 5 l'appelle avec un `sentry_sdk.init` enveloppé

- [ ] **Step 1 : adapter le test, il échoue**

Dans `test_a_set_dsn_applies_the_hardening_settings`, remplacer `assert kwargs["include_local_variables"] is False` par :

```python
    assert "include_local_variables" not in kwargs
    assert kwargs["data_collection"]["stack_frame_variables"] is False
    assert kwargs["data_collection"]["user_info"] is False
```

- [ ] **Step 2 : lancer, il échoue**

Run : `cd sidecar && uv run pytest tests/unit/core/test_observability.py -x -q -k hardening`
Expected : FAIL, `include_local_variables` encore passé

- [ ] **Step 3 : implémenter**

Dans `sentry_sdk.init(...)`, retirer `include_local_variables=False` et son commentaire et ajouter à sa place :

```python
            # Chaque categorie fermee, `stack_frame_variables` compris : des que
            # `data_collection` est pose, le SDK ne lit plus `include_local_variables`, collecte
            # toute categorie omise et n'installe plus son `EventScrubber` (lu dans
            # `data_collection.py`, `utils.py` et `client.py` de 2.71.0, le 2026-10-16) : aucune
            # donnee sensible dans `set_extra`, `set_context` ni `set_tag`. Les variables d'une
            # frame porteraient chemins, titres, voire la cle API. `frame_context_lines` garde
            # son defaut : des lignes de ce depot, public. Une categorie ajoutee par une montee
            # du SDK fait echouer `test_sentry_payload.py` au lieu de partir ouverte.
            data_collection={
                "user_info": False,
                "cookies": {"mode": "off"},
                "http_headers": {"request": {"mode": "off"}},
                "http_bodies": [],
                "url_query_params": {"mode": "off"},
                "graphql": {"document": False, "variables": False},
                "gen_ai": {"inputs": False, "outputs": False},
                "database_query_data": False,
                "queues": False,
                "stack_frame_variables": False,
            },
```

Mettre à jour la docstring de module : remplacer « les reglages ci-dessous sont a tester comme du code metier » par « les reglages ci-dessous et `_scrub` sont a tester sur l'enveloppe reellement construite (`tests/unit/core/test_sentry_payload.py`) ».

- [ ] **Step 4 : lancer, puis typage**

Run : `cd sidecar && uv run pytest tests/unit/core/test_observability.py -x -q && uv run mypy src tests`
Expected : PASS, `Success: no issues found` (le dict est vérifié contre `DataCollectionUserOptions`)

- [ ] **Step 5 : commit**

```bash
git add sidecar/src/tagger/core/observability.py sidecar/tests/unit/core/test_observability.py
git commit -m "fix(sidecar): fermer chaque catégorie de data_collection, variables de frame comprises"
```

---

### Task 5 : test de sécurité sur l'enveloppe réelle et garde-fou de montée

**Files:**
- Create: `sidecar/tests/unit/core/test_sentry_payload.py`
- Modify: `sidecar/tests/conftest.py` (fixture `requests` remontée depuis `tests/unit/resolution/conftest.py`, import de `httpx2` sous `TYPE_CHECKING`)
- Delete: `sidecar/tests/unit/resolution/conftest.py` (la fixture `requests` en était l'unique contenu)

**Interfaces:**
- Consumes : `init_sentry(dsn, release)` (Task 4), `capture_unexpected(error)`, `MESSAGE_MASK` (Task 3), détail d'`ApiContractError` (Task 1), `make_client`, `recording`, `track_payload`, `YOUR_MIND` de `tests/helpers/scraper_responses.py`, `TagsWriteError(path: Path, reason: FileFailureReason)` de `tagger.tags.files`
- Produces : fixture `sent` locale au module (un seul fichier s'en sert, cf. `.claude/rules/pytest/tests.md`), fixture `requests` partagée dans `tests/conftest.py` (deux dossiers de tests s'en servent)

- [ ] **Step 1 : remonter la fixture `requests`, puis écrire le fichier**

D'abord la fixture. Dans `sidecar/tests/conftest.py`, ajouter `import httpx2` sous `if TYPE_CHECKING:` (à la suite de l'import d'`Iterator`) et la fixture en fin de fichier :

```python
@pytest.fixture
def requests() -> list[httpx2.Request]:
    """Journal des requetes emises, rempli par le handler du `MockTransport`.

    Une liste neuve par test : c'est la seule fenetre sur ce que le client a emis.
    """
    return []
```

Supprimer `sidecar/tests/unit/resolution/conftest.py` (`git rm`) : les tests de `resolution/` reçoivent la fixture du `conftest.py` parent.

Run : `cd sidecar && uv run pytest tests/unit/resolution -x -q`
Expected : PASS

Puis le fichier de test :

- [ ] **Step 1 : écrire le fichier**

```python
"""Ce que le SDK envoie reellement : la seule preuve que rien de personnel ne part (ADR-014).

Le vrai `sentry_sdk.init`, appele par `init_sentry`, avec un transport qui retient l'enveloppe
au lieu de l'envoyer : aucun reseau, aucun quota. Les valeurs sensibles viennent des
constantes ci-dessous ou des helpers : le SDK joint cinq lignes de source par frame, un titre
ecrit pres d'une frame qui leve ferait echouer le test sur sa propre source. Pour la meme
raison, une valeur attendue ne s'asserte jamais par sa presence dans le texte de l'enveloppe :
on lit le champ de l'evenement.
"""

import functools
from pathlib import Path
from typing import TYPE_CHECKING, Final, override

import httpx2
import pytest
import sentry_sdk
from pydantic import ValidationError
from scraper_responses import (
    YOUR_MIND,
    make_client,
    recording,
    track_payload,
)
from sentry_sdk.transport import Transport

from tagger import APP_NAME, RELEASE
from tagger.core.file_failures import FileFailureReason
from tagger.core.observability import MESSAGE_MASK, capture_unexpected, init_sentry
from tagger.resolution.scraper_client import ApiContractError, Source
from tagger.tags.files import TagsWriteError

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from sentry_sdk.envelope import Envelope
    from sentry_sdk.types import Event

DSN: Final = "https://key@o1.ingest.de.sentry.io/1"
API_KEY: Final = "tt-fake-0000-0000"
TRACK_ID: Final = "Albums/Nova Pulse - Your Mind.mp3"
TRACK_PATH: Final = Path(r"D:\Musique") / TRACK_ID
# Artiste, titre, label et nom de fichier des fixtures : aucun ne doit partir.
FRAGMENTS: Final = ("Beyer", "Your Mind", "Drumcode", "Nova Pulse", API_KEY)
# Categories dont la valeur resolue ne collecte rien de l'utilisateur.
NOT_COLLECTING: Final = frozenset({"provided_by_user", "frame_context_lines"})


class _RetainingTransport(Transport):
    """Retient chaque enveloppe au lieu de l'envoyer."""

    def __init__(self) -> None:
        super().__init__()
        self.envelopes: list[Envelope] = []

    @override
    def capture_envelope(self, envelope: Envelope) -> None:
        self.envelopes.append(envelope)


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[Envelope]]:
    transport = _RetainingTransport()
    monkeypatch.setattr(sentry_sdk, "init", functools.partial(sentry_sdk.init, transport=transport))
    init_sentry(DSN, RELEASE)

    yield transport.envelopes

    sentry_sdk.get_client().close()
    sentry_sdk.get_global_scope().set_client(None)
    assert not sentry_sdk.get_client().is_active()


def _rendered(envelopes: list[Envelope]) -> str:
    sentry_sdk.flush()
    return b"".join(envelope.serialize() for envelope in envelopes).decode("utf-8")


def _event(envelopes: list[Envelope]) -> Event:
    sentry_sdk.flush()
    event = envelopes[0].get_event()
    assert event is not None
    return event


def _entries(envelopes: list[Envelope]) -> dict[str, dict[str, object]]:
    """Entrees de `exception.values`, par nom de type."""
    return {entry["type"]: entry for entry in _event(envelopes)["exception"]["values"]}


def _frames(event: Event) -> list[dict[str, object]]:
    return [
        frame
        for entry in event["exception"]["values"]
        for frame in entry.get("stacktrace", {}).get("frames", [])
    ]


def _collects(value: object) -> bool:
    """Vrai si la valeur resolue d'une categorie laisse passer une donnee."""
    match value:
        case bool():
            return value
        case list():
            return bool(value)
        case {"mode": str() as mode}:
            return mode != "off"
        case dict():
            return any(_collects(item) for item in value.values())
        case _:
            return True


async def _broken_contract(requests: list[httpx2.Request], item: object) -> ApiContractError:
    response = httpx2.Response(200, json={"items": [item], "next_cursor": None})
    async with make_client(recording(requests, response)) as client:
        with pytest.raises(ApiContractError) as error:
            await client.search(Source.BEATPORT, YOUR_MIND)

    return error.value


def _write_failed() -> None:
    """Deux variables locales sensibles et inutilisees : elles ne doivent pas partir."""
    title = YOUR_MIND  # noqa: F841
    api_key = API_KEY  # noqa: F841
    raise TagsWriteError(TRACK_PATH, FileFailureReason.FILE_LOCKED)


def _unknown_track() -> None:
    track_id = TRACK_ID
    raise KeyError(track_id)


def _task_group_failed() -> None:
    raise ExceptionGroup(
        "unhandled errors in a TaskGroup",
        [TagsWriteError(TRACK_PATH, FileFailureReason.FILE_LOCKED)],
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "item",
    [
        track_payload(bpm=YOUR_MIND),
        track_payload(artists=[{"id": "1", "kind": YOUR_MIND}]),
        YOUR_MIND,
    ],
    ids=["field-of-wrong-type", "required-field-missing", "item-not-an-object"],
)
async def test_a_contract_break_sends_no_fragment_of_the_response(
    sent: list[Envelope], requests: list[httpx2.Request], item: object
) -> None:
    error = await _broken_contract(requests, item)

    capture_unexpected(error)

    rendered = _rendered(sent)
    assert not [fragment for fragment in FRAGMENTS if fragment in rendered]
    assert MESSAGE_MASK in rendered


@pytest.mark.asyncio
async def test_a_contract_break_keeps_the_failing_field_locations(
    sent: list[Envelope], requests: list[httpx2.Request]
) -> None:
    error = await _broken_contract(requests, track_payload(bpm=YOUR_MIND))

    capture_unexpected(error)

    contract = _entries(sent)[ApiContractError.__name__]
    assert contract["value"] == "api contract broken: TrackPage: items.*.bpm int_parsing"


@pytest.mark.asyncio
async def test_a_contract_break_keeps_the_type_module_and_stack_of_the_chained_error(
    sent: list[Envelope], requests: list[httpx2.Request]
) -> None:
    error = await _broken_contract(requests, track_payload(bpm=YOUR_MIND))

    capture_unexpected(error)

    chained = _entries(sent)[ValidationError.__name__]
    assert (chained["module"], chained["value"]) == (ValidationError.__module__, MESSAGE_MASK)
    assert chained["stacktrace"]


@pytest.mark.parametrize(
    ("raising", "error_type", "module"),
    [
        (_write_failed, TagsWriteError, TagsWriteError.__module__),
        (_unknown_track, KeyError, None),
    ],
    ids=["own-error-with-file-name", "key-error"],
)
def test_an_error_carrying_a_file_name_sends_its_shape_but_no_fragment(
    sent: list[Envelope],
    raising: Callable[[], None],
    error_type: type[Exception],
    module: str | None,
) -> None:
    with pytest.raises(error_type) as error:
        raising()

    capture_unexpected(error.value)

    rendered = _rendered(sent)
    entry = _entries(sent)[error_type.__name__]
    assert not [fragment for fragment in FRAGMENTS if fragment in rendered]
    assert (entry["module"], entry["value"]) == (module, MESSAGE_MASK)
    assert entry["stacktrace"]


def test_an_exception_group_sends_no_fragment_of_its_members(sent: list[Envelope]) -> None:
    with pytest.raises(ExceptionGroup) as error:
        _task_group_failed()

    capture_unexpected(error.value)

    rendered = _rendered(sent)
    values = [entry["value"] for entry in _event(sent)["exception"]["values"]]
    assert not [fragment for fragment in FRAGMENTS if fragment in rendered]
    assert values == [MESSAGE_MASK, MESSAGE_MASK]


def test_the_envelope_carries_no_frame_variable_and_a_fixed_server_name(
    sent: list[Envelope],
) -> None:
    with pytest.raises(TagsWriteError) as error:
        _write_failed()

    capture_unexpected(error.value)

    event = _event(sent)
    assert not [frame for frame in _frames(event) if "vars" in frame]
    assert event["server_name"] == APP_NAME


@pytest.mark.usefixtures("sent")
def test_the_resolved_data_collection_closes_every_category_but_source_context() -> None:
    """Sous `data_collection`, une categorie omise est collectee : une montee du SDK qui en
    ajoute une (`mcp` est annoncee dans getsentry/sentry-python#7750, ouverte au 2026-10-15)
    casse ce test au lieu de partir ouverte. La fermer dans `init_sentry`.
    """
    resolved = dict(sentry_sdk.get_client().options["data_collection"])

    opened = {
        name: value
        for name, value in resolved.items()
        if name not in NOT_COLLECTING and _collects(value)
    }

    assert opened == {}
```

Points d'attention à l'écriture :
- Le teardown de `sent` asserte que le client est inactif : un client réel laissé actif ferait échouer le test qui l'a utilisé, sans dépendre de l'ordre des tests du module
- `event["exception"]["values"]` et `entry.get(...)` passent Mypy sur le `TypedDict` `Event`. Si une montée de Mypy les refuse, passer par `cast("dict[str, object]", ...)` au plus près, jamais par `# type: ignore` nu
- `pytest.raises(ExceptionGroup)` lève le groupe pour de bon : un groupe seulement construit n'aurait ni pile ni `__traceback__`
- Le SDK pose `module` à `None` pour un builtin (`KeyError`, `ExceptionGroup`), d'où le `None` attendu du cas `key-error`

- [ ] **Step 2 : lancer le fichier, tout passe**

Run : `cd sidecar && uv run pytest tests/unit/core/test_sentry_payload.py -x -q`
Expected : PASS (Tasks 1 à 4 en place)

- [ ] **Step 3 : prouver que les tests mordent**

Chaque mutation se rétablit avant la suivante. Vérifiées le 2026-10-16 sur une copie du sidecar :
- Retirer `"stack_frame_variables": False` de `init_sentry` : échouent `test_the_envelope_carries_no_frame_variable_and_a_fixed_server_name` et `test_the_resolved_data_collection_closes_every_category_but_source_context`, avec les tests d'absence de fragment (les variables d'une frame portent le titre et la clé)
- Vider `_SAFE_MESSAGE_TYPES` (`frozenset()`) : échoue `test_a_contract_break_keeps_the_failing_field_locations` seul
- Faire de `_mask_message` un `return entry` : échouent les trois cas de `test_a_contract_break_sends_no_fragment_of_the_response`, `test_a_contract_break_keeps_the_type_module_and_stack_of_the_chained_error`, les deux cas de `test_an_error_carrying_a_file_name_sends_its_shape_but_no_fragment` et `test_an_exception_group_sends_no_fragment_of_its_members`
- Passer `include_input=True` dans `_contract_detail` et ajouter `item.get('input')` à chaque ligne du détail : échouent `test_names_each_failing_field_without_any_received_value`, `test_names_only_the_type_of_an_error_at_the_root_of_the_response`, `test_a_contract_break_keeps_the_failing_field_locations` et les trois cas de `test_a_contract_break_sends_no_fragment_of_the_response`

Run : `cd sidecar && uv run pytest tests/unit/core/test_sentry_payload.py tests/unit/resolution/test_scraper_client_errors.py -q`
Expected : FAIL sur les tests nommés pendant chaque mutation, PASS après rétablissement

- [ ] **Step 4 : suite du sidecar complète et typage**

Run : `cd sidecar && uv run pytest -x -q && uv run mypy src tests && uv run ruff check . && uv run ruff format --check .`
Expected : PASS, couverture au-dessus du seuil de 80 %

- [ ] **Step 5 : commit**

```bash
git add sidecar/tests/unit/core/test_sentry_payload.py sidecar/tests/conftest.py sidecar/tests/unit/resolution/conftest.py
git commit -m "test(sidecar): prouver sur l'enveloppe réelle qu'aucun titre, nom de fichier ni clé ne part vers Sentry"
```

---

### Task 6 : webview alignée sur le sidecar

**Files:**
- Modify: `src/app/core/observability/scrub.ts`, `src/app/core/observability/sentry-options.ts`
- Test: `src/app/core/observability/scrub.spec.ts`, `src/app/core/observability/sentry-options.spec.ts`

**Interfaces:**
- Produces : `MASK = "<user>"` (inchangé), `PATH_MASK = "<path>"`, `QUERY_MASK = "<query>"`, `scrub` (signature inchangée, `beforeSend`), `sentryOptions` (signature inchangée) dont `dataCollection` ferme aussi `graphQL`, `genAI`, `databaseQueryData` et `queues`

- [ ] **Step 1 : réécrire `scrub.spec.ts`, il échoue**

```typescript
import { MASK, PATH_MASK, QUERY_MASK, scrub } from "./scrub"

/**
 * Le masquage est la seule barriere cote webview : `Breadcrumbs` et `Replay` sont
 * retirees, mais un message d'erreur formate autour d'un morceau porte son chemin, donc
 * le nom du fichier, l'artiste et le titre.
 */
describe("scrub", () => {
  const scrubbed = (event: object): Record<string, unknown> =>
    scrub(event as never, {}) as unknown as Record<string, unknown>

  it.each([
    ["a drive path with backslashes", String.raw`D:\Musique\Nova Pulse - Your Mind.mp3`],
    ["a drive path with slashes", "D:/Musique/Nova Pulse - Your Mind.mp3"],
    ["a UNC path", String.raw`\\nas\partage\Nova Pulse - Your Mind.mp3`],
    ["a path under a home with a space", String.raw`C:\Users\Jean Dupont\Music\set.flac`],
    ["a path under a home with an apostrophe", String.raw`C:\Users\O'Brien\Music\set.flac`],
    ["a bare name with an apostrophe", String.raw`D:\Music\Nova Pulse - Don't Stop.mp3`],
  ])("masks %s whole", (_case, path) => {
    const event = { message: `cannot read ${path}: denied` }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`cannot read ${PATH_MASK}: denied`)
  })

  it("masks a double-quoted path that contains an apostrophe", () => {
    const event = { message: String.raw`cannot read "D:\Music\Nova Pulse - Don't Stop.mp3"` }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`cannot read "${PATH_MASK}"`)
  })

  it.each([
    ["before a letter", String.raw`D:\Music\Nova Pulse - Don't Stop.mp3`],
    ["before a space", String.raw`D:\Music\Nova Pulse - Guns N' Roses.mp3`],
  ])("masks a single-quoted path whose name has an apostrophe %s", (_case, path) => {
    const event = { message: `cannot read '${path}' failed` }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`cannot read '${PATH_MASK}' failed`)
  })

  it("swallows the text between two apostrophes that follows a single-quoted path", () => {
    const event = {
      message: String.raw`'D:\Music\Nova Pulse - Your Mind.mp3' from user's folder`,
    }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`'${PATH_MASK}'s folder`)
  })

  it("masks the query string of a URL but keeps its scheme, host and path", () => {
    const event = {
      message: "GET https://api.example/beatport/search?q=Beyer+Mind&next=http://cdn?w=1 failed",
    }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`GET https://api.example/beatport/search?${QUERY_MASK} failed`)
  })

  it("does not take a URL scheme for a drive letter", () => {
    const event = { message: "see https://api.example/beatport/tracks/42" }

    const result = scrubbed(event)

    expect(result["message"]).toBe("see https://api.example/beatport/tracks/42")
  })

  it("masks the username of the POSIX home folders", () => {
    const event = {
      extra: {
        posix: "/home/jane/Music/set.flac",
        macos: "/Users/jane/Music/set.flac",
        tracks: 42,
      },
    }

    const result = scrubbed(event)

    expect(result["extra"]).toEqual({
      posix: `/home/${MASK}/Music/set.flac`,
      macos: `/Users/${MASK}/Music/set.flac`,
      tracks: 42,
    })
  })

  it("masks a mapping key as well as its value", () => {
    const event = { extra: { [String.raw`D:\Musique\Nova Pulse - Your Mind.mp3`]: "locked" } }

    const result = scrubbed(event)

    expect(result["extra"]).toEqual({ [PATH_MASK]: "locked" })
  })

  it("masks every path in an array", () => {
    const event = {
      extra: { paths: [String.raw`D:\Musique\a.flac`, String.raw`D:\Musique\b.flac`] },
    }

    const result = scrubbed(event)

    expect(result["extra"]).toEqual({ paths: [PATH_MASK, PATH_MASK] })
  })
})
```

Run : `pnpm exec ng test --watch=false --include src/app/core/observability/scrub.spec.ts`
Expected : FAIL, `PATH_MASK` et `QUERY_MASK` non exportés

- [ ] **Step 2 : implémenter `scrub.ts`**

```typescript
import type { BrowserOptions } from "@sentry/angular"

/**
 * Pendant webview de `_scrub` du sidecar, memes motifs dans le meme ordre : query string
 * d'URL, chemin de lecteur ou UNC, puis dossier personnel restant. Le navigateur ne
 * connait pas le nom d'utilisateur de l'OS : le masquage se fait par motif seulement.
 *
 * Les chemins arrivent ici parce que le sidecar en envoie dans ses evenements NDJSON et
 * que l'interface les affiche : un message d'erreur formate autour d'un morceau porte son
 * chemin, donc le nom du fichier, l'artiste et le titre. Les messages JS restent envoyes :
 * ils sont le seul diagnostic de la webview.
 */

export const MASK = "<user>"
export const PATH_MASK = "<path>"
export const QUERY_MASK = "<query>"

// La query string d'une recherche porte l'artiste et le titre. `?` exclu du groupe de
// l'URL, sinon gourmand : il avalerait les `?` intermediaires et laisserait passer tout ce
// qui precede le dernier.
const URL_QUERY = /([a-z][\w+.-]*:\/\/[^\s'"<>?]*)\?[^\s'"<>]*/gi

// Lettre de lecteur (`D:\`, `D:/`) ou partage UNC (`\\serveur\`).
const PATH_START = String.raw`(?:[A-Za-z]:[\\/]|\\\\[^\s\\/'"<>]+[\\/])`

// Un chemin ouvert par un guillemet court jusqu'au guillemet suivant. Un chemin ouvert par
// `'` court jusqu'a la derniere apostrophe de la ligne (glouton, avec lookahead) : une
// apostrophe du nom, avant une lettre ou une espace (« Guns N' Roses »), ne le ferme pas.
// Sans apostrophe fermante, il court jusqu'a la fin de ligne. Le texte entre deux
// apostrophes apres le chemin est avale avec lui, sur-masquage accepte. Un chemin nu garde
// ses espaces et ses apostrophes et s'arrete a `"`, `<>`, a la fin de ligne et avant `: `
// (Windows interdit `:` dans un nom). Une phrase qui suit sans separateur est avalee, sens
// de panne accepte. Un chemin nu ne suit ni un caractere de mot, sinon `http://` serait pris
// pour `p:/`, ni un guillemet.
const WINDOWS_PATH = new RegExp(
  String.raw`(?<=")${PATH_START}[^"\r\n]*` +
    String.raw`|(?<=')${PATH_START}(?:[^\r\n]*(?=')|[^'\r\n]*)` +
    String.raw`|(?<![\w'"])${PATH_START}(?:(?!:\s)[^"<>\r\n])*`,
  "g",
)

// Dossier personnel restant (`/Users/nom`, `/home/nom`, `\Users\nom` sans lettre). Le groupe
// capture le separateur pour rendre la forme d'origine, seul le nom est remplace. Les bornes
// sont les caracteres qu'un nom de dossier Windows ne peut pas porter : tout le reste est
// legal dans un nom de compte, l'espace comme l'apostrophe.
const HOME = /((?:[A-Za-z]:)?[\\/](?:Users|home)[\\/])[^\\/:*?"<>|\n\r]+/gi

const mask = (text: string): string =>
  text
    .replace(URL_QUERY, `$1?${QUERY_MASK}`)
    .replace(WINDOWS_PATH, PATH_MASK)
    .replace(HOME, `$1${MASK}`)

const maskDeep = (value: unknown): unknown => {
  if (typeof value === "string") return mask(value)
  if (Array.isArray(value)) return value.map(maskDeep)
  if (value && typeof value === "object") {
    // `prepareEvent` normalise avant `beforeSend` : une Error y est deja
    // `{message, name, stack}`, une Date une chaine ISO. Ne pas poser
    // `normalizeDepth: 0`, qui desactiverait cette passe.
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [mask(k), maskDeep(v)]))
  }
  return value
}

/** Parcours recursif sans liste de champs : un champ ajoute plus tard est couvert,
 * cles comprises. Pas de cles d'enveloppe exclues comme cote sidecar : les motifs sont
 * ancres, ils ne peuvent matcher ni `release` ni `environment`.
 */
export const scrub: NonNullable<BrowserOptions["beforeSend"]> = (event) =>
  maskDeep(event) as typeof event
```

- [ ] **Step 3 : compléter `sentry-options.spec.ts`, puis fermer les catégories de `sentry-options.ts`**

Étendre `SentEvent` :

```typescript
interface SentEvent {
  sdk?: { settings?: { infer_ip?: string } }
  breadcrumbs?: { category?: string }[]
  exception?: { values?: { value?: string }[] }
}
```

Importer `PATH_MASK` de `./scrub`. Avant le `describe`, ajouter le helper et la liste des catégories connues :

```typescript
// Fermee : un booleen a faux, une liste vide ou un objet dont toutes les valeurs le sont.
const isClosed = (value: unknown): boolean => {
  if (typeof value === "boolean") return !value
  if (Array.isArray(value)) return value.length === 0
  if (value && typeof value === "object") return Object.values(value).every(isClosed)
  return false
}

// Categories de `DataCollection` dans `@sentry/core` 11.6.0 au 2026-10-16, `frameContextLines`
// exceptee (des lignes de ce depot, public). La webview n'a pas de garde-fou d'execution comme
// le sidecar : une categorie ajoutee par une montee du SDK reste a son defaut tant qu'elle
// n'est pas ajoutee ici et dans `sentry-options.ts`.
const KNOWN_CATEGORIES = [
  "cookies",
  "databaseQueryData",
  "genAI",
  "graphQL",
  "httpBodies",
  "httpHeaders",
  "queues",
  "stackFrameVariables",
  "urlQueryParams",
  "userInfo",
]
```

Puis ajouter dans le `describe` :

```typescript
  it("sends the drive path of an error message masked", async () => {
    Sentry.captureException(
      new Error(String.raw`cannot read D:\Musique\Nova Pulse - Your Mind.mp3`),
    )
    await Sentry.flush()

    expect(sent[0]?.exception?.values?.[0]?.value).toBe(`cannot read ${PATH_MASK}`)
  })

  it("closes every known data collection category", () => {
    const { dataCollection = {} } = sentryOptions(
      "https://key@o0.ingest.sentry.io/0",
      "techno-tagger@test",
      "test",
    )

    const opened = Object.entries(dataCollection)
      .filter(([, value]) => !isClosed(value))
      .map(([name]) => name)

    expect(opened).toEqual([])
    expect(Object.keys(dataCollection).sort()).toEqual(KNOWN_CATEGORIES)
  })
```

Run : `pnpm exec ng test --watch=false --include src/app/core/observability/sentry-options.spec.ts`
Expected : FAIL sur `closes every known data collection category` (`graphQL`, `genAI`, `databaseQueryData` et `queues` absents de `dataCollection`)

Dans `sentry-options.ts`, remplacer le commentaire et l'objet `dataCollection` par :

```typescript
  // Sentry 11 collecte tout par defaut quand `dataCollection` est absent, IP de
  // l'utilisateur comprise (`userInfo`) : chaque categorie est fermee explicitement, les dix
  // de `@sentry/core` 11.6.0 au 2026-10-16 (`frameContextLines` exceptee : des lignes de ce
  // depot, public). Une categorie ajoutee par une montee du SDK reste a son defaut jusqu'a
  // ce qu'on la ferme ici.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
```

- [ ] **Step 4 : lancer les deux specs, puis lint et typage de la webview**

Run : `pnpm exec ng test --watch=false --include src/app/core/observability/` puis `just lint` et `just typecheck`
Expected : PASS

- [ ] **Step 5 : commit**

```bash
git add src/app/core/observability/scrub.ts src/app/core/observability/scrub.spec.ts src/app/core/observability/sentry-options.ts src/app/core/observability/sentry-options.spec.ts
git commit -m "fix(ui): masquer tout chemin de lecteur ou UNC et toute query string dans les événements Sentry, fermer les catégories de collecte restantes"
```

---

### Task 7 : documentation, rules et fiche de connaissance

Chaque document gouverné par un skill se charge avant d'être écrit (template, exemples, conventions), même pour trois lignes : le skill est nommé devant le fichier qu'il gouverne.

**Files:**
- Modify: `docs/adrs/014-observabilite-sentry-et-rgpd.md` (via `Skill[architecture-doc]`)
- Modify: `docs/ARCHITECTURE.md:962` (via `Skill[architecture-doc]`)
- Modify: `docs/PRODUCTION.md:324`, `:589`, `:599`, `:728` (via `Skill[production-doc]`)
- Modify: `docs/VERSIONS.md` (§ 8. sentry-sdk, via `Skill[versions-doc]`)
- Modify: `.claude/rules/sentry/python.md`, `.claude/rules/sentry/angular.md`, `.claude/rules/pytest/tests.md` (via `Skill[rules-doc]`)
- Modify: `docs/knowledges/sentry.md` (via `Skill[knowledge-doc]`)

- [ ] **Step 1 : ADR-014 (`Skill[architecture-doc]`)**

Charger `Skill[architecture-doc]`, lire le format des ADR, puis ajouter après le paragraphe **Mise à jour 2026-10-11** :

```markdown
**Mise à jour 2026-10-15** : le durcissement du sidecar passe à `data_collection`, l'option que sentry-sdk documente depuis la 2.70.0 en remplacement de `send_default_pii` : chaque catégorie y est fermée, variables de frame comprises (`stack_frame_variables`), car dès qu'elle est posée le SDK ne lit plus `include_local_variables` et collecte toute catégorie omise. Le réglage `include_local_variables` du tableau « Durcissement, non négociable » est donc remplacé par `stack_frame_variables: False` et ce tableau garde la valeur d'origine à titre historique. Posée, l'option désactive aussi l'`EventScrubber` par défaut du SDK (constaté le 2026-10-16 dans `client.py` de sentry-sdk 2.71.0) : aucune donnée sensible ne passe par `set_extra`, `set_context` ni `set_tag`, que `before_send` ne saurait reconnaître. Un test lit la configuration résolue et casse sur une catégorie ajoutée par une montée du SDK. S'y ajoute une liste fermée des messages d'exception : tout message part en `<message>`, sauf ceux des types déclarés sans donnée (`ApiContractError`, dont le détail ne porte que les emplacements et types des erreurs de validation). Les messages du sidecar portent le nom du fichier ou le `track_id` et la `ValidationError` de pydantic la valeur reçue : aucun motif ne reconnaît un titre dans du texte libre. Le motif de chemin, des deux côtés, couvre un nom qui contient une apostrophe. Côté webview, `dataCollection` ferme aussi les catégories `graphQL`, `genAI`, `databaseQueryData` et `queues`. Le test de sécurité de la note complémentaire porte sur l'enveloppe réellement construite par le SDK (`sidecar/tests/unit/core/test_sentry_payload.py`). Source : `sidecar/src/tagger/core/observability.py`, `src/app/core/observability/scrub.ts`, `src/app/core/observability/sentry-options.ts`.
```

- [ ] **Step 2 : ARCHITECTURE.md § Monitoring (`Skill[architecture-doc]`)**

Remplacer la phrase « Les trois réglages non négociables du SDK (`include_local_variables`, `server_name`, `send_default_pii`) et le scrubbing des chemins sont fixés par [ADR-014](...) et testés comme du code métier. » par :

```markdown
Le durcissement du SDK (`data_collection` fermé catégorie par catégorie, `server_name` fixe, message d'exception masqué hors d'une liste fermée de types sans donnée) et le scrubbing des chemins sont fixés par [ADR-014](adrs/014-observabilite-sentry-et-rgpd.md) et testés sur l'enveloppe réellement construite.
```

La phrase suivante (« Côté sidecar, le scrubbing masque en `<path>` [...] ») devient :

```markdown
Des deux côtés, le scrubbing masque en `<path>` tout chemin de lecteur ou UNC, nom à apostrophe compris, pas seulement le dossier de l'utilisateur (`<user>`) : le nom d'un fichier porte l'artiste et le titre, donc un morceau.
```

- [ ] **Step 3 : PRODUCTION.md (`Skill[production-doc]`)**

Charger `Skill[production-doc]`, puis :

- l.324 : `- [ ] **Durcissement Sentry en place et testé** : `data_collection` fermé catégorie par catégorie (variables de frame comprises), `server_name` fixe, messages d'exception masqués hors liste fermée, scrubbing des chemins. Ces réglages sont **la seule protection** ([ADR-014](adrs/014-observabilite-sentry-et-rgpd.md))`
- l.589 : compléter la parenthèse par « ; hors d'une liste fermée de types sans donnée, le message d'une exception part en `<message>` depuis le 2026-10-15 »
- l.599 : remplacer la seconde phrase par « C'est ce que `data_collection` fermé (variables de frame) et la liste fermée des messages empêchent et ce qu'un type ajouté à cette liste sans examen de son message réintroduirait. »
- l.728 : `[Sentry : Options Python](...) : `data_collection`, `server_name`, `before_send``

- [ ] **Step 4 : VERSIONS.md § 8. sentry-sdk (`Skill[versions-doc]`)**

Charger `Skill[versions-doc]`, puis :

- Sous **Breaking Changes Majeurs**, ajouter : `- **2.70.0** : `data_collection` promue en option de premier niveau, successeur annoncé de `send_default_pii`. Dès qu'elle est posée, `include_local_variables` et `include_source_context` ne sont plus lus et une catégorie omise est collectée (lu dans `data_collection.py` et `utils.py` de 2.71.0 le 2026-10-15). Une catégorie `mcp` est en préparation (getsentry/sentry-python#7750, ouverte au 2026-10-15)`
- Sous **Breaking Changes Majeurs**, ajouter : `- **2.70.0** : `data_collection` posée, le SDK n'installe plus son `EventScrubber` par défaut (`client.py`, `_get_options`, lu en 2.71.0 le 2026-10-16) : le denylist (`api_key`, `secret`, `token`, `password`...) ne s'applique plus aux champs libres. Aucune donnée sensible dans `set_extra`, `set_context` ni `set_tag` et pas de rappel manuel de `EventScrubber` dans `_scrub``
- Dans le tableau des réglages, remplacer la ligne `include_local_variables` par : `| `data_collection` | `None` ; posée, toute catégorie omise vaut collecte, `stack_frame_variables` compris | `_resolve_explicit` : `d.get("stack_frame_variables", True)` |` et retitrer le tableau « Les réglages de durcissement d'[ARCHITECTURE.md § Monitoring](ARCHITECTURE.md#monitoring), vérifiés dans le code source du SDK »
- **Recommandation** : « ✅ Tester sur l'enveloppe réellement construite : variables de frame absentes, `server_name` fixe, `data_collection` résolu entièrement fermé (`sidecar/tests/unit/core/test_sentry_payload.py`). »

- [ ] **Step 5 : rules via `Skill[rules-doc]`**

Charger `Skill[rules-doc]`, lire template et conventions, puis :

`.claude/rules/sentry/python.md` :
- frontmatter `paths` : ajouter `"sidecar/src/tagger/core/observability.py"`
- À faire : remplacer la puce `include_local_variables=False` par « Poser `data_collection` avec chaque catégorie fermée, `stack_frame_variables: False` compris : posée, l'option fait ignorer `include_local_variables` et collecte toute catégorie omise » ; ajouter « Masquer tout message d'exception hors de `_SAFE_MESSAGE_TYPES` et n'y ajouter un type que si son message est construit sans chemin, nom de fichier, `track_id` ni valeur reçue de l'API » ; ajouter « Ne passer aucune donnée sensible à `set_extra`, `set_context` ni `set_tag` : sous `data_collection`, le SDK n'installe plus son `EventScrubber`, son denylist ne s'applique plus (`client.py` de 2.71.0, lu le 2026-10-16) » ; reformuler la dernière puce en « Tester sur l'enveloppe réellement construite (`test_sentry_payload.py`) : variables de frame, `server_name`, `data_collection` résolu »
- Gotchas : ajouter « 2.70.0 : `data_collection` passe en premier niveau ; une montée qui ajoute une catégorie la laisse ouverte, le garde-fou de `test_sentry_payload.py` la signale »
- Exemple : remplacer `include_local_variables=False` par le bloc `data_collection` de `init_sentry`

`.claude/rules/sentry/angular.md` :
- À faire : ajouter « Masquer dans `scrub.ts` tout chemin de lecteur ou UNC en `<path>` et toute query string en `<query>`, par les motifs du `_scrub` du sidecar : un nom de fichier porte l'artiste et le titre » ; compléter la puce des catégories de `dataCollection` par `graphQL`, `genAI`, `databaseQueryData` et `queues` (dix catégories de `@sentry/core` 11.6.0 au 2026-10-16, sans garde-fou d'exécution : une catégorie ajoutée par une montée s'ajoute à la main)
- Exemple : compléter le `dataCollection` avec les quatre catégories ajoutées

`.claude/rules/pytest/tests.md` :
- À éviter : ajouter à la puce « Un appel réseau ou Sentry réel » l'exception « sauf `test_sentry_payload.py`, qui initialise le vrai SDK par `init_sentry` avec un transport factice retenant l'enveloppe : aucun réseau, aucun quota » ; ajouter à la puce « Tester mutagen, rapidfuzz, httpx2 ou la stdlib » l'exception « sauf le garde-fou de `data_collection`, conçu pour casser à la montée du SDK qui ajoute une catégorie de collecte (ADR-014) »

- [ ] **Step 6 : fiche via `Skill[knowledge-doc]`**

Charger `Skill[knowledge-doc]`, puis dans `docs/knowledges/sentry.md` :
- § Les trois réglages non négociables (Python) : retitrer « Durcissement du SDK Python », exemple sur `data_collection` fermé, point important sur `include_local_variables` ignoré dès que `data_collection` est posé (2.70.0+, vérifié le 2026-10-15), point important sur l'`EventScrubber` non installé sous `data_collection` (`client.py` de 2.71.0, lu le 2026-10-16) : aucune donnée sensible dans `set_extra`, `set_context` ni `set_tag`
- § SDK Angular : exemple de `dataCollection` complété par `graphQL`, `genAI`, `databaseQueryData` et `queues`
- § Scrubbing par `before_send` : liste fermée des messages et motif sensible aux guillemets
- l.198 : « La clé API ne doit apparaître dans aucun event : `stack_frame_variables: False` le garantit en premier lieu »
- Anti-patterns : remplacer « Laisser `include_local_variables` à son défaut » par « Poser `data_collection` sans fermer `stack_frame_variables` : l'option rouvre alors les variables de frame, en silence »

- [ ] **Step 7 : vérifier qu'aucune doc ne recommande encore l'ancien réglage**

Run : Grep `include_local_variables` sur `docs/**/*.md` et `.claude/**/*.md`, hors `docs/superpowers/`
Expected : seules restent les mentions historiques (ADR-014 tableau d'origine annoté par la mise à jour datée, VERSIONS.md « Ce qui invalide les exemples en 1.x », `.claude/rules/sentry/python.md` Gotchas sur le renommage de `with_locals`, mise à jour datée)

- [ ] **Step 8 : commit**

```bash
git add docs/adrs/014-observabilite-sentry-et-rgpd.md docs/ARCHITECTURE.md docs/PRODUCTION.md docs/VERSIONS.md docs/knowledges/sentry.md .claude/rules/sentry/python.md .claude/rules/sentry/angular.md .claude/rules/pytest/tests.md
git commit -m "docs(sidecar): durcissement Sentry par data_collection et liste fermée des messages"
```

---

### Task 8 : gate qualité

- [ ] **Step 1 : lint, typage, tests des trois zones**

Run : `just lint && just typecheck && just test`
Expected : tout vert, couverture du sidecar au-dessus de 80 %

- [ ] **Step 2 : passer la spec en `implemented`**

Réservé à `/implement-subproject`, qui pose `status: "implemented"` dans `docs/superpowers/specs/monitoring/01-payloads-sans-titre-design.md` après la chaîne de revue.
