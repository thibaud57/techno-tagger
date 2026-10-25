# Enregistreur du scénario de démo : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acter l'architecture de la démo dans ADR-023 et produire `src/demo/` (scénario et pochettes) en faisant jouer au vrai sidecar chaque branche du parcours, sur un catalogue fictif face à un faux techno-scraper, sous une garde CI stricte.

**Architecture:** Quatre helpers de test, chacun avec une responsabilité. `demo_catalogue` porte les données fictives et câble le faux techno-scraper. `demo_covers` génère les pochettes SVG. `demo_scenario` porte le modèle, la normalisation, l'assemblage et les valeurs figées, tout en fonctions pures. `demo_recording` pilote `run_loop` en process, session par session. `sidecar/record_demo.py` n'est qu'un CLI qui les appelle. La garde réenregistre et compare au contenu versionné.

**Tech Stack:** Python 3.14, pydantic 2 (`JsonValue`, modèles gelés), asyncio, pytest + pytest-asyncio (mode strict), httpx2 `MockTransport` via `tagging_api.FakeApi`, `unittest.mock.patch.object`. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/demo-web-publique/01-enregistreur-de-scenario-design.md`. Référence du catalogue et des pochettes : `docs/superpowers/specs/demo-web-publique/01-pochettes-options.html` (tableau « Catalogue fictif », fonctions `hash`, `rng` et `coverB`, objet `LABELS`).

## Global Constraints

- **Aucune modification de `sidecar/src/`.** Tout ce qui manque s'ajoute dans `sidecar/tests/helpers/`.
- **Catalogue** : les 13 morceaux et les 4 labels de `01-pochettes-options.html`, avec leurs noms, titres, labels, références et cas. Le label garde ses valeurs `bg`, `fg`, `hue` et `motif`. BPM, tonalité, genre, date de sortie et ISRC sont fictifs. Les ISRC prennent le code pays `ZZ`, jamais attribué.
- **Morceaux à décision et issues** : « Sub Rosa » {`first_beatport`, `second_beatport`, `refused`, `pending`}, « Тишина » {`first_beatport`, `bandcamp`, `refused`, `pending`}, « Lowlands » {`recovered_by_url`, `unresolved`}. Cela donne 32 combinaisons et 64 sessions (branches `retry_then_rollback` et `rollback_without_retry`).
- **Valeurs figées** : run passé `run_id = "de0001"` à `2026-08-24T20:00:00+00:00`, run du visiteur `run_id = "de0002"` à `2026-10-24T20:00:00+00:00`, `DEMO_VERSION = "demo"`, `DEMO_ROOT = C:\Users\Demo`. Toute session, extraction et démarrage compris, tourne sous `frozen_sources`.
- **Playlist** : une seule, `"Set du samedi"`. Le dossier du run passé s'appelle `"Set de la semaine dernière"`.
- **URLs fictives, toutes sur `.example`** : `https://beatport.example/track/<slug>/<id>`, `https://<artiste>.bandcamp.example/track/<slug>`, `https://artwork.example/<référence>.jpg`. Rattrapage de « Lowlands » seul : `https://arc-ventral.bandcamp.example/track/lowlands`, accepté parce que le harnais remplace `scraper_client._BANDCAMP_HOST` par `re.compile(r"[a-z0-9][a-z0-9-]*\.bandcamp\.example")` le temps de la session. Aucun domaine réel dans le dépôt.
- **Clé de commande** : nom de la commande plus ses champs identifiants aux clés triées, un champ absent valant `null`. La constante `KEY_FIELDS` de `demo_scenario.py` est écrite dans `Scenario.key_fields` : une source, lue par l'enregistreur et par le lot 3 : `list_playlists` (`playlist_path`), `extract_playlist` (`mode`, `playlist_name`), `start_tagging` (`folder`), `resolve_arbitration` (`track_id`, `source`, `candidate`), `switch_arbitration_source` (`track_id`, `source`), `resolve_by_url` (`track_id`, `url`), `commit_run`, `retry_write` et `load_run` (`run_id`), `rollback` (`run_id`, `track_id`), toute autre commande sans champ (noms relevés dans `protocol.ts` le 2026-10-25). Les chemins des clés sont ceux du scénario, que les sélecteurs de démo renvoient tels quels.
- **Phases** : `idle` au démarrage, `not_written` dès `start_tagging`, puis `write_failed`, `written`, `rolled_back_after_retry`, `rolled_back_without_retry`.
- **Rejeu sans calcul** : chaque réponse est cherchée par clé. Une réponse à une décision porte l'issue qu'elle produit. Le lot 3 ne déduit rien.
- **Hors scénario** : `cancel_run`, `clear_cache`, `rollback` d'un seul morceau, URL d'un morceau refusé, nouveau tagging après l'écriture.
- **Code et commentaires Python sans accents**, docstrings et commentaires en français, le pourquoi seulement. Les chaînes de données gardent leurs caractères (`Тишина`, `Dragović`, `Tonträger`), comme `demo.py`.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, jamais de réseau réel (`.claude/rules/pytest/tests.md`).
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`. Commits `type(scope): description`.

## Review Focus

- **Bump de release-please** : la version du sidecar change sur une PR que personne ne réenregistre, et la garde doit rester verte (Task 3, `test_replaces_the_sidecar_version_with_the_demo_version` ; Task 5, `test_the_scenario_never_carries_the_sidecar_version`).
- **Enregistrement sous un autre profil Windows** : aucun nom d'utilisateur ni racine temporaire dans le scénario (Task 4, `test_no_line_leaks_the_recording_root_or_the_os_user`).
- **Source de variation oubliée** (horloge, hasard, ordre des tâches) : l'enregistrement casse en nommant la clé, sans faire clignoter la garde (Task 3, `test_refuses_two_different_replies_for_the_same_key`).
- **Rattrapage de « Lowlands » avant les arbitrages** : la réponse existe pour les deux autres morceaux en attente (Task 4, `test_every_combination_has_its_post_commit_replies`, cas des issues `pending`).
- **Réglages ouverts au milieu des arbitrages** : les trois requêtes de la page ont leur réponse dans chaque état intermédiaire (Task 4, `test_every_intermediate_arbitration_state_answers_the_settings_queries`).
- **Catalogue retouché** : une pochette orpheline disparaît au réenregistrement au lieu de rester servie (Task 5, `test_rewrites_the_demo_folder_entirely`).
- **Montée de dépendance du sidecar par Dependabot** : la garde rougit sans régression de notre code, la procédure est écrite (Task 1, ADR-023 ; Task 5, Must-do du CLAUDE.md).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `docs/adrs/023-demo-web-par-rejeu.md` | Décision d'architecture de la démo |
| `sidecar/tests/helpers/demo_catalogue.py` | Données fictives, câblage de `FakeApi`, URL de rattrapage |
| `sidecar/tests/helpers/demo_covers.py` | SVG de style B, un par sortie |
| `sidecar/tests/helpers/demo_scenario.py` | Modèle du scénario, normalisation, assemblage, valeurs figées |
| `sidecar/tests/helpers/demo_recording.py` | Bibliothèque, sessions, enregistrement complet, écriture de `src/demo/` |
| `sidecar/tests/helpers/audio_samples.py` | `held_exclusively`, en plus de `held_open` |
| `sidecar/tests/helpers/vlc_dump.py` | `build_dump(..., playlists=...)` |
| `sidecar/record_demo.py` | CLI de `just record-demo` |
| `sidecar/tests/unit/test_demo_covers.py` | Pochettes |
| `sidecar/tests/unit/test_demo_normalization.py` | Fonctions pures de `demo_scenario` |
| `sidecar/tests/integration/test_demo_scenario.py` | Garde stricte et cohérence du scénario |
| `src/demo/scenario.json`, `src/demo/artworks/*.svg` | Générés, versionnés |

---

### Task 1: ADR-023

**Files:**
- Create: `docs/adrs/023-demo-web-par-rejeu.md`
- Modify: `docs/ARCHITECTURE.md` (table des ADRs, Évolutions Futures)
- Modify: `docs/BRAINSTORM.md` (Post-MVP Feature 1, ligne « > Faisabilité étudiée le 2026-10-25… »)

- [ ] **Step 1: Charger `Skill[architecture-doc]` et lire son template d'ADR et un ADR existant (`docs/adrs/021-visibilite-du-depot.md`)**

- [ ] **Step 2: Écrire ADR-023, statut `accepted`, daté du 2026-10-25**

Options :
- A, rejeu d'un run enregistré ;
- B, sidecar sur le serveur derrière un WebSocket ;
- C, sidecar dans le navigateur par Pyodide 314.0.7 ;
- D, `mockIPC` de Tauri.

Décision : A. Raisons, toutes dans `docs/BRAINSTORM.md` § Notes, décisions du 2026-10-25 :
- B exigerait la clé API et exposerait au public un proxy vers techno-scraper, sur un sidecar Windows only ;
- C : pas de wheel `rapidfuzz`, threads non fonctionnels alors que le sidecar repose sur `asyncio.to_thread` ;
- D est un outil de test, plus bas niveau que `SIDECAR_TRANSPORT`.

Conséquences :
- données fictives de bout en bout : les CGU de Beatport (relevé du 2026-10-25) rangent métadonnées et pochettes dans leur « Content », réservé à un usage personnel non commercial, d'où un catalogue inventé et des pochettes générées ;
- garde stricte, avec son exception voulue à la règle No-lib-test : une montée de rapidfuzz, mutagen ou pydantic qui change une réponse la rougit sans régression de notre code. Procédure : réenregistrer sous Windows (`just record-demo`), relire le diff de `src/demo/` et le commiter dans la PR de la montée ;
- aucun domaine réel dans le scénario (`.example`, `_BANDCAMP_HOST` remplacé par le harnais) ;
- Dokploy en Isolated Deployment, build CI au tag, rien de la démo dans l'installeur.

Renvois : ADR-005, ADR-014, ADR-021.

- [ ] **Step 3: Référencer l'ADR**

Ajouter la ligne ADR-023 à la table des ADRs d'ARCHITECTURE.md, et une puce « Démo web publique » aux Évolutions Futures, au format des autres. Dans le BRAINSTORM, chargé par `Skill[brainstorm-doc]`, remplacer la note « à acter par un ADR » par un renvoi `[ADR-023](adrs/023-demo-web-par-rejeu.md)`. Les compteurs de l'ADR (morceaux, combinaisons, sessions) sont datés du relevé, jamais écrits comme permanents.

- [ ] **Step 4: Vérifier les liens**

Run: `grep -n "023-demo-web-par-rejeu" docs/ARCHITECTURE.md docs/BRAINSTORM.md`
Expected: 3 lignes (ARCHITECTURE table, Évolutions Futures, BRAINSTORM).

- [ ] **Step 5: Commit**

```bash
git add docs/adrs/023-demo-web-par-rejeu.md docs/ARCHITECTURE.md docs/BRAINSTORM.md
git commit -m "docs(adr): ADR-023 demo web publique par rejeu d'un run enregistre"
```

### Task 2: Catalogue fictif et pochettes

**Files:**
- Create: `sidecar/tests/helpers/demo_catalogue.py`
- Create: `sidecar/tests/helpers/demo_covers.py`
- Modify: `sidecar/tests/helpers/audio_samples.py` (ajout de `held_exclusively`)
- Modify: `sidecar/tests/helpers/vlc_dump.py:build_dump` (paramètre `playlists`)
- Test: `sidecar/tests/unit/test_demo_covers.py`

**Interfaces:**
- Produces (`demo_catalogue`) :
  - `class Motif(StrEnum)` : `RINGS = "rings"`, `WAVES = "waves"`, `GRID = "grid"`, `DOTS = "dots"`
  - `@dataclass(frozen=True, slots=True) class Label` : `name: str`, `background: str`, `foreground: str`, `hue: int`, `motif: Motif`
  - `class ExtractionCase(StrEnum)` : `EXTRACTED`, `ALREADY_PRESENT`, `DUPLICATE`, `MISSING`, `FAILURE`
  - `class TaggingCase(StrEnum)` : `AUTO_BEATPORT`, `BANDCAMP_ONLY`, `TWO_BEATPORT_MIXES`, `WRONG_BEATPORT`, `NOT_FOUND`, `LOCKED_ON_WRITE`
  - `@dataclass(frozen=True, slots=True) class Release` : `label: Label`, `reference: str`, `tagging: TaggingCase` (les trois vont toujours ensemble)
  - `@dataclass(frozen=True, slots=True) class DemoTrack` : `artist: str`, `title: str`, `file_name: str`, `extraction: ExtractionCase`, `release: Release | None` (`None` pour le morceau absent et l'échec d'extraction)
  - Constantes : `LABELS: Final[tuple[Label, ...]]`, `TRACKS: Final[tuple[DemoTrack, ...]]`, `PAST_RUN_TRACKS: Final[tuple[DemoTrack, ...]]` (Nadia Kessler, Oblique Unit, Kaltwerk), `PLAYLIST_NAME: Final = "Set du samedi"`, `PAST_RUN_FOLDER: Final = "Set de la semaine dernière"`, `LOWLANDS_RECOVERY_URL: Final[str]`, `BANDCAMP_DEMO_HOST: Final = re.compile(r"[a-z0-9][a-z0-9-]*\.bandcamp\.example")`, `SUB_ROSA`, `TISHINA`, `LOWLANDS`, `GLASS_CORRIDOR`, `COLD_MERIDIAN: Final[DemoTrack]`
  - `def resolved_releases() -> tuple[tuple[DemoTrack, Release], ...]` : les morceaux porteurs d'une sortie, avec elle
  - `def register_replies(api: FakeApi) -> None` : réponses Beatport, Bandcamp et rattrapage, clés `q` égales à la requête que le sidecar construit des tags artiste et titre (même convention que `tagging_api.YOUR_MIND`) ; la page de `LOWLANDS_RECOVERY_URL` est enregistrée sur `BANDCAMP_TRACKS`
- Produces (`demo_covers`) : `def render_cover(release: Release, title: str) -> str`, `def render_covers(tracks: Sequence[DemoTrack]) -> dict[str, str]` (clé `"<référence>.svg"`, morceaux sans sortie ignorés)
- Produces (`audio_samples`) : `def held_exclusively(path: Path) -> Iterator[None]` (partage `0`, la copie échoue aussi), `held_open` inchangé, partie commune factorisée
- Produces (`vlc_dump`) : `build_dump(path, *, tracks=TRACKS, playlists: Mapping[str, Sequence[str]] | None = None, omit_table=None, omit_column=None)`. Avec `None`, les deux playlists actuelles sont créées et les tests existants passent inchangés.

- [ ] **Step 1: Write the failing tests** (`sidecar/tests/unit/test_demo_covers.py`)

```python
def test_renders_the_same_cover_twice_for_the_same_release() -> None:
    track, release = resolved_releases()[0]

    first, second = render_cover(release, track.title), render_cover(release, track.title)

    assert first == second


def test_names_one_cover_per_resolved_release_after_its_reference() -> None:
    covers = render_covers(TRACKS)

    assert set(covers) == {f"{release.reference}.svg" for _, release in resolved_releases()}


@pytest.mark.parametrize(
    ("motif", "element"),
    [(Motif.RINGS, "<circle"), (Motif.WAVES, "<path"), (Motif.GRID, "<line"), (Motif.DOTS, "<circle")],
    ids=["rings", "waves", "grid", "dots"],
)
def test_draws_every_release_of_a_label_with_that_labels_motif(motif: Motif, element: str) -> None:
    releases = [(t, r) for t, r in resolved_releases() if r.label.motif is motif]

    covers = [render_cover(r, t.title) for t, r in releases]

    assert releases
    assert all(element in cover for cover in covers)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sidecar && uv run pytest tests/unit/test_demo_covers.py -x -q`
Expected: FAIL, `ModuleNotFoundError: demo_covers`

- [ ] **Step 3: Implement `demo_catalogue.py`, then the two helper extensions**

Valeurs du catalogue recopiées de `01-pochettes-options.html`. Fichiers audio dans les quatre formats (`audio_samples.BLANK_WRITERS`), extension par morceau au choix, au moins une de chaque.

Les payloads, construits par `scraper_responses.track_payload` / `bandcamp_track_payload`, doivent amener chaque morceau dans son cas avec les seuils par défaut (`DEFAULT_THRESHOLDS`) :
- `TWO_BEATPORT_MIXES` : deux candidats Beatport en zone grise, rien sur Bandcamp ;
- `WRONG_BEATPORT` : un candidat Beatport faux, le bon sur Bandcamp ;
- `NOT_FOUND` : rien sur les deux sources, la page Bandcamp de `LOWLANDS_RECOVERY_URL` enregistrée sur `BANDCAMP_TRACKS`.

Le test de la Task 4 prouve que chaque morceau finit dans son cas.

- [ ] **Step 4: Implement `demo_covers.py`**

Port de `coverB` : FNV-1a 32 bits sur les points de code, `h = (h ^ cp) * 16777619 mod 2**32`, et mulberry32. Seed `hash(reference + title)`, mêmes formules par motif, référence en bas à droite. Couleurs `hsl(...)` du label. Nombres formatés à 2 décimales fixes pour un rendu stable.

- [ ] **Step 5: Run the tests**

Run: `cd sidecar && uv run pytest tests/unit/test_demo_covers.py -x -q`
Expected: PASS

- [ ] **Step 6: Vérifier les noms fictifs**

Chercher chaque artiste et chaque label sur Beatport et Discogs (WebSearch), et remplacer tout nom qui désigne un vrai artiste ou label. Consigner la date et le résultat de la vérification en commentaire en tête de `demo_catalogue.py`. Aucune URL à sonder : elles sont toutes sur `.example`.

- [ ] **Step 7: Gate and commit**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert, tests existants de `vlc_dump` et `audio_samples` inchangés.

```bash
git add sidecar/tests/helpers/demo_catalogue.py sidecar/tests/helpers/demo_covers.py sidecar/tests/helpers/audio_samples.py sidecar/tests/helpers/vlc_dump.py sidecar/tests/unit/test_demo_covers.py
git commit -m "feat(demo): catalogue fictif et pochettes generees de la demo"
```

### Task 3: Modèle du scénario, normalisation, valeurs figées

**Files:**
- Create: `sidecar/tests/helpers/demo_scenario.py`
- Test: `sidecar/tests/unit/test_demo_normalization.py`

**Interfaces:**
- Consumes : `demo_catalogue.DemoTrack`, `TRACKS`, `protocol_mirror.ts_discriminant_owners`
- Produces :
  - `type JsonObject = dict[str, JsonValue]` (`pydantic.JsonValue`, jamais `Any`)
  - `class Outcome(StrEnum)` : `PENDING = "pending"`, `FIRST_BEATPORT = "first_beatport"`, `SECOND_BEATPORT = "second_beatport"`, `BANDCAMP = "bandcamp"`, `REFUSED = "refused"`, `RECOVERED_BY_URL = "recovered_by_url"`, `UNRESOLVED = "unresolved"`
  - `class Phase(StrEnum)` : `IDLE`, `NOT_WRITTEN`, `WRITE_FAILED`, `WRITTEN`, `ROLLED_BACK_AFTER_RETRY`, `ROLLED_BACK_WITHOUT_RETRY` (valeurs en snake_case)
  - `KEY_FIELDS: Final[Mapping[str, tuple[str, ...]]]` : la table des Global Constraints, par nom de commande
  - Modèles gelés (`ConfigDict(frozen=True, extra="forbid")`, `Field(default_factory=dict)` pour les mappings vides, `.claude/rules/pydantic/modeles.md`) :
    - `DemoPaths(vlc_dump: str, library: str, destination: str)` ;
    - `StatelessReply(command: JsonObject, call: int = 1, sets: Mapping[str, Outcome], enters: Phase | None = None, lines: tuple[int, ...])` ;
    - `StatefulReply(command: JsonObject, outcomes: Mapping[str, Outcome], phase: Phase, sets: Mapping[str, Outcome], enters: Phase | None = None, lines: tuple[int, ...])` ;
    - `enters` est la phase que la réponse fait atteindre : `not_written` pour `start_tagging`, `write_failed` pour `commit_run`, `written` pour `retry_write`, `rolled_back_after_retry` ou `rolled_back_without_retry` pour `rollback`, `None` ailleurs. L'enregistreur la pose d'après la branche qu'il joue ;
    - `Scenario(schema_version: Literal[1], paths: DemoPaths, key_fields: Mapping[str, tuple[str, ...]], initial_outcomes: Mapping[str, Outcome], lines: tuple[JsonObject, ...], stateless: tuple[StatelessReply, ...], stateful: tuple[StatefulReply, ...])`. `initial_outcomes` donne l'issue de départ des trois morceaux à décision : `pending` pour « Sub Rosa » et « Тишина », `unresolved` pour « Lowlands ». Le rejeu n'écrit ainsi aucun `track_id` en dur ; la phase de départ est toujours `idle`.
    - `call` ne numérote que les réponses sans état, par session : une réponse avec état n'avance pas le rang.
    Les clés d'`outcomes` et de `sets` sont des `track_id`. `lines` indexe la table dédupliquée.
  - `@dataclass(frozen=True, slots=True) class ReplyState` : `outcomes: Mapping[str, Outcome]`, `phase: Phase`
  - `@dataclass(frozen=True, slots=True) class Exchange` : `command: JsonObject`, `lines: tuple[JsonObject, ...]`, `state: ReplyState | None` (`None` = sans état), `sets: Mapping[str, Outcome] = MappingProxyType({})`, `enters: Phase | None = None`
  - `DEMO_VERSION: Final = "demo"`, `DEMO_ROOT: Final = PureWindowsPath(r"C:\Users\Demo")`, `PAST_RUN_ID: Final = "de0001"`, `VISITOR_RUN_ID: Final = "de0002"`, `PAST_RUN_AT: Final`, `VISITOR_RUN_AT: Final` (valeurs des Global Constraints)
  - `def normalize(message: JsonObject, *, recording_root: Path, covers_by_track: Mapping[str, str]) -> JsonObject` : version, chemins, pochettes. S'applique aux commandes comme aux événements.
  - `def command_key(command: JsonObject) -> str` : nom de la commande et ses champs de `KEY_FIELDS`, JSON aux clés triées, champ absent écrit `null`
  - `def assemble(sessions: Iterable[Sequence[Exchange]], paths: DemoPaths) -> Scenario` : rangs d'appel par `command_key` sans état, repartant de 1 à chaque session, dédoublonnage des lignes et des réponses identiques. Lève `DemoRecordingError(key)` si une même clé reçoit deux réponses différentes.
  - `@contextmanager def frozen_sources(*, at: datetime, run_id: str) -> Iterator[None]` : `patch.object` de `tagger.run.tagging.secrets` (objet dont `token_hex` rend `run_id`) et de `datetime` dans `tagger.handlers` et `tagger.run.writing` (sous-classe dont `now()` rend `at`)
  - `class DemoRecordingError(Exception)`

- [ ] **Step 1: Write the failing tests**

```python
def test_replaces_the_sidecar_version_with_the_demo_version(tmp_path: Path) -> None:
    line = {"event": "version", "version": "9.9.9", "log_file": str(tmp_path / "x.log")}

    normalized = normalize(line, recording_root=tmp_path, covers_by_track={})

    assert normalized["version"] == DEMO_VERSION


@pytest.mark.parametrize(
    "value",
    ["Kaltwerk - Stahlregen.flac", "beatport", "https://beatport.example/track/a/1"],
    ids=["file-name", "source", "url"],
)
def test_leaves_strings_outside_the_recording_root_untouched(tmp_path: Path, value: str) -> None: ...
    # assert normalize({"event": "x", "v": value}, ...)["v"] == value


def test_rewrites_paths_under_the_recording_root_to_the_demo_prefix(tmp_path: Path) -> None: ...
    # str(tmp_path / "Musique" / "Extraction") -> str(DEMO_ROOT / "Musique" / "Extraction")


def test_maps_an_artwork_cache_path_to_its_cover_file(tmp_path: Path) -> None: ...
    # {"event": "track_resolved", "track_id": "t.mp3", "artwork_path": str(tmp_path / "c" / "ab12")}
    # with covers_by_track={"t.mp3": "artworks/CH012.svg"} -> artwork_path == "artworks/CH012.svg"


def test_keys_a_command_on_its_identifying_fields_only() -> None:
    recorded = {"command": "start_tagging", "folder": "C:\\Users\\Demo\\Musique\\Extraction"}
    sent = {**recorded, "thresholds": {"floor": 70, "ceiling": 90}}

    assert command_key(sent) == command_key(recorded)
    assert command_key({"command": "rollback", "run_id": "de0002"}) == command_key({"command": "rollback", "run_id": "de0002", "track_id": None})


def test_lists_every_protocol_command_in_the_key_fields_table() -> None:
    commands = set(ts_discriminant_owners("command"))

    assert set(KEY_FIELDS) == commands


def test_restarts_call_ranks_in_each_session() -> None:
    first = Exchange(START, (RUN_STARTED,), None)
    second = Exchange(START, (RUN_STARTED,), None)

    scenario = assemble([[first], [second]], PATHS)

    assert [reply.call for reply in scenario.stateless] == [1]


def test_refuses_two_different_replies_for_the_same_key() -> None:
    command = {"command": "get_version"}
    sessions = [[Exchange(command, ({"event": "version", "version": "a"},), None)],
                [Exchange(command, ({"event": "version", "version": "b"},), None)]]

    with pytest.raises(DemoRecordingError, match="get_version"):
        assemble(sessions, PATHS)


def test_freezes_the_run_id_and_the_clock_inside_a_session_only() -> None:
    with frozen_sources(at=VISITOR_RUN_AT, run_id=VISITOR_RUN_ID):
        inside = (tagging.secrets.token_hex(3), handlers.datetime.now(UTC))

    assert inside == (VISITOR_RUN_ID, VISITOR_RUN_AT)
    assert tagging.secrets.token_hex(3) != VISITOR_RUN_ID
```

Compléter les corps marqués `...` avec les valeurs indiquées en commentaire. Constantes du module de test : `PATHS = DemoPaths(vlc_dump="a", library="b", destination="c")`, `START = {"command": "start_tagging", "folder": "x"}`, `RUN_STARTED = {"event": "run_started", ...}` (champs minimaux du modèle). Imports : `from tagger import handlers`, `from tagger.run import tagging`, `from protocol_mirror import ts_discriminant_owners`. Le test de la table lit `protocol.ts` hors de `sidecar/`, comme `test_protocol_mirror.py`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd sidecar && uv run pytest tests/unit/test_demo_normalization.py -x -q`
Expected: FAIL, `ModuleNotFoundError: demo_scenario`

- [ ] **Step 3: Implement `demo_scenario.py`**

`normalize` parcourt le JSON récursivement. Une chaîne commençant par `str(recording_root)` voit ce préfixe remplacé par `str(DEMO_ROOT)` (préfixe `\\?\` compris s'il apparaît). Un `artwork_path` voisin d'un `track_id` connu de `covers_by_track` prend sa valeur. Le champ `version` d'un événement `version` prend `DEMO_VERSION`. `assemble` reçoit une séquence d'`Exchange` par session, numérote les `call` par `command_key` sans état en repartant de 1 à chaque session, puis fusionne : deux réponses de même clé (et même rang ou même état) doivent être identiques, sinon `DemoRecordingError(key)`.

- [ ] **Step 4: Run the tests**

Run: `cd sidecar && uv run pytest tests/unit/test_demo_normalization.py -x -q`
Expected: PASS

- [ ] **Step 5: Gate and commit**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`

```bash
git add sidecar/tests/helpers/demo_scenario.py sidecar/tests/unit/test_demo_normalization.py
git commit -m "feat(demo): modele du scenario, normalisation et valeurs figees"
```

### Task 4: Sessions d'enregistrement

**Files:**
- Create: `sidecar/tests/helpers/demo_recording.py`
- Modify: `sidecar/tests/helpers/cdn_doubles.py` (seulement si une gate sur `FakeCdn` s'avère nécessaire, Step 3)
- Test: `sidecar/tests/integration/test_demo_scenario.py`

**Interfaces:**
- Consumes : tout `demo_catalogue`, `demo_scenario` (`Exchange`, `ReplyState`, `assemble`, `normalize`, `frozen_sources`, constantes), `ndjson_loop.conversation` et `extraction_command`, `tagging_api.FakeApi` et `Gate`, `cdn_doubles.FakeCdn` et `public_resolver`, `memory_keyring.MemoryKeyring`, `audio_samples.tagged_audio`, `held_open` et `held_exclusively`, `vlc_dump.build_dump`, `tagger.handlers.TaggingTransports`, `tagger.resolution.scraper_client`.
- Produces :
  - `class Branch(StrEnum)` : `RETRY_THEN_ROLLBACK`, `ROLLBACK_WITHOUT_RETRY`
  - `type SubRosaOutcome = Literal[Outcome.FIRST_BEATPORT, Outcome.SECOND_BEATPORT, Outcome.REFUSED, Outcome.PENDING]`, `type TishinaOutcome = Literal[Outcome.FIRST_BEATPORT, Outcome.BANDCAMP, Outcome.REFUSED, Outcome.PENDING]`, `type LowlandsOutcome = Literal[Outcome.RECOVERED_BY_URL, Outcome.UNRESOLVED]`
  - `@dataclass(frozen=True, slots=True) class Combination` : `sub_rosa: SubRosaOutcome`, `tishina: TishinaOutcome`, `lowlands: LowlandsOutcome` (une issue impossible pour un morceau ne se construit pas)
  - `def combinations() -> tuple[Combination, ...]` : les 32 combinaisons, ordre stable
  - `def record_scenario(workspace: Path) -> Scenario` : synchrone, `asyncio.run` par session, lève `DemoRecordingError` hors Windows (`sys.platform != "win32"`)

Séquence d'une session :
1. Environnement isolé, à l'image de `tests/conftest.py` et `tests/integration/conftest.py` : `LOCALAPPDATA` sous la session, `keyring.set_keyring(MemoryKeyring())` avec une clé posée, `patch.object(handlers, "tagging_transports", ...)`, `patch.object(scraper_client, "_BANDCAMP_HOST", BANDCAMP_DEMO_HOST)`. Chaque remplacement est rétabli à la sortie. Toute session, y compris les étapes 2 et 3, tourne sous `frozen_sources` : `handlers` date le rapport d'extraction à la seconde, un enregistrement hors gel ferait varier `extraction_finished.report_path`.
2. Le run passé est enregistré une fois sous `frozen_sources(at=PAST_RUN_AT, run_id=PAST_RUN_ID)`, puis son dump est retiré de `dump_dir()`. Son `LOCALAPPDATA` sert de modèle, copié pour chaque session.
3. L'extraction est enregistrée une fois sous `frozen_sources(at=VISITOR_RUN_AT, run_id=VISITOR_RUN_ID)` : `list_playlists`, `extract_playlist` en copie deux fois (rangs 1 et 2), puis en déplacement sur une bibliothèque neuve. Chaque `extract_playlist` est `extraction_command(...) | {"mode": ...}` : le helper n'émet pas `mode`, que la clé de commande porte. `COLD_MERIDIAN` reste sous `held_exclusively` pendant ces trois extractions. Le dossier extrait sert de modèle.
4. Chaque session de combinaison tourne sous `frozen_sources(at=VISITOR_RUN_AT, run_id=VISITOR_RUN_ID)` et suit cet ordre :
   - **démarrage** : `get_version`, `get_interrupted_run` (sans état), puis `list_runs`, `get_rollback_target`, `get_cache_size` (avec état, issues initiales, phase `idle`) ;
   - `start_tagging` (`enters=NOT_WRITTEN`), gates relâchées morceau par morceau dans l'ordre de `TRACKS`, source après source, jusqu'à `run_finished` de phase `network`, puis les trois requêtes des Réglages ;
   - décisions de « Sub Rosa » puis de « Тишина », sur le modèle de `tests/integration/test_ndjson_arbitration.py`, les trois requêtes des Réglages après chaque décision. Une issue qui passe par un refus de Beatport refuse, revient à Beatport par `switch_arbitration_source`, puis refuse de nouveau avant de conclure. Le lien « Revenir à Beatport » de la modale est ainsi enregistré ;
   - rattrapage de « Lowlands » si l'issue le demande, puis les trois requêtes ;
   - `commit_run` sous `held_open(GLASS_CORRIDOR)` ;
   - requêtes de phase : `list_runs`, `load_run` du run du visiteur, `get_rollback_target`, `get_cache_size` ;
   - branche : relance puis restauration, ou restauration directe ;
   - requêtes de phase après chaque étape.
5. Les réponses sont toutes les lignes reçues entre une commande et la suivante, jusqu'à l'événement terminal attendu. `load_run` du run passé est sans état. Les `Exchange` d'une session forment une séquence, passée telle quelle à `assemble`.

- [ ] **Step 1: Write the failing tests**

Fixture de module `recorded` (`scope="module"`) : elle appelle `record_scenario(root)` avec `root = tmp_path_factory.mktemp("demo")` et rend `Recorded(scenario=..., root=root)`. `Recorded` est une dataclass gelée du module de test.

```python
def test_every_recorded_command_parses_and_every_line_validates(recorded: Recorded) -> None:
    models = event_models()  # classe par valeur du champ event, tiree des sous-classes d'Event

    for reply in (*recorded.scenario.stateless, *recorded.scenario.stateful):
        parse_command(json.dumps(reply.command))
        for index in reply.lines:
            line = recorded.scenario.lines[index]
            models[str(line["event"])].model_validate(line)


def test_no_line_leaks_the_recording_root_or_the_os_user(recorded: Recorded) -> None:
    text = recorded.scenario.model_dump_json()
    windows_paths = re.findall(r"[A-Z]:\\\\[^\"]*", text)

    assert str(recorded.root) not in text
    assert f"Users\\\\{getpass.getuser()}" not in text
    assert windows_paths and all(path.startswith(str(DEMO_ROOT).replace("\\", "\\\\")) for path in windows_paths)


def test_every_timestamp_and_run_id_is_one_of_the_frozen_values(recorded: Recorded) -> None:
    text = recorded.scenario.model_dump_json()

    instants = set(re.findall(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", text)) | set(re.findall(r"\d{8}T\d{6}", text))
    run_ids = {str(line["run_id"]) for line in walk(recorded.scenario.lines) if "run_id" in line}

    assert instants <= {PAST_RUN_AT.strftime("%Y-%m-%dT%H:%M:%S"), VISITOR_RUN_AT.strftime("%Y-%m-%dT%H:%M:%S"), PAST_RUN_AT.strftime("%Y%m%dT%H%M%S"), VISITOR_RUN_AT.strftime("%Y%m%dT%H%M%S")}
    assert run_ids == {PAST_RUN_ID, VISITOR_RUN_ID}


def test_every_url_is_on_a_reserved_domain(recorded: Recorded) -> None:
    hosts = {urlparse(url).hostname for url in re.findall(r"https?://[^\"\\s]+", recorded.scenario.model_dump_json())}

    assert hosts and all(host is not None and host.endswith(".example") for host in hosts)


def test_starts_with_the_past_run_listed_and_nothing_to_restore(recorded: Recorded) -> None: ...
    # StatelessReply call 1 de get_version et de get_interrupted_run (ligne sans run) ;
    # StatefulReply en IDLE avec initial_outcomes : list_runs ne porte que PAST_RUN_ID,
    # get_rollback_target sans cible, get_cache_size present


def test_every_combination_has_its_post_commit_replies(recorded: Recorded) -> None: ...
    # pour chaque Combination : StatefulReply commit_run en NOT_WRITTEN, puis
    # list_runs / load_run / get_rollback_target / get_cache_size dans chaque phase atteinte,
    # retry_write en WRITE_FAILED, rollback en WRITE_FAILED et en WRITTEN ;
    # resolve_by_url de LOWLANDS pour chacune des 16 issues des deux autres morceaux


def test_every_intermediate_arbitration_state_answers_the_settings_queries(recorded: Recorded) -> None: ...
    # pour chaque etat (a, b, c) atteignable en NOT_WRITTEN, a parmi les 4 issues de Sub Rosa,
    # b parmi les 4 de Tishina, c parmi les 2 de Lowlands :
    # list_runs, get_rollback_target et get_cache_size ont une StatefulReply


def test_every_catalogue_track_ends_as_its_case_announces(recorded: Recorded) -> None: ...
    # EXTRACTED : extraction_finished.extracted porte le fichier a la premiere extraction
    # ALREADY_PRESENT : extraction_finished.skipped porte le fichier a la seconde extraction (rang 2)
    # DUPLICATE : signale comme doublon ; MISSING : signale comme absent (champs de extraction_finished)
    # FAILURE : extraction_finished.failures porte le fichier en file_locked
    # AUTO_BEATPORT et LOCKED_ON_WRITE : track_resolved state resolved, resolution auto, source beatport
    # BANDCAMP_ONLY : resolution auto, source bandcamp
    # TWO_BEATPORT_MIXES : arbitration_required beatport a deux candidats
    # WRONG_BEATPORT : arbitration_required beatport, liste bandcamp apres refus
    # NOT_FOUND : unresolved, raison no_result
    # LOCKED_ON_WRITE : write_error file_locked au commit, written a la relance


def test_refuses_to_record_outside_windows(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "platform", "linux")

    with pytest.raises(DemoRecordingError, match="Windows"):
        record_scenario(tmp_path)
```

`event_models()` est un helper du test qui parcourt `Event.__subclasses__()` récursivement et lit le `Literal` du champ `event` : aucune table recopiée de `protocol.py`. `walk` rend chaque objet JSON imbriqué des lignes (défini ici, réutilisé par la Task 5). Les noms exacts des champs d'`extraction_finished` se lisent dans `protocol.py`. La fixture `recorded` est en `scope="module"` : les modèles sont gelés et leurs mappings ne sont jamais modifiés par un test.

- [ ] **Step 2: Run to verify they fail**

Run: `cd sidecar && uv run pytest tests/integration/test_demo_scenario.py -x -q`
Expected: FAIL, `ModuleNotFoundError: demo_recording`

- [ ] **Step 3: Implement `demo_recording.py`**

Signatures de l'Interfaces block. Pour relâcher une gate puis attendre, utiliser `Gate.release.set()` et `await talk.expect(...)` sur l'événement du morceau (`track_id` = nom de fichier, comme `tagging_api.ONE_TRACK`). Si l'ordre des pochettes varie encore, ajouter une gate à `FakeCdn` dans `cdn_doubles.py`, jamais dans `sidecar/src/`.

- [ ] **Step 4: Run the tests, measure the duration**

Run: `cd sidecar && uv run pytest tests/integration/test_demo_scenario.py -x -q --durations=3`
Expected: PASS. Consigner la durée de la fixture `recorded` en note à la fin de ce plan.

- [ ] **Step 5: Gate and commit**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`

```bash
git add sidecar/tests/helpers/demo_recording.py sidecar/tests/integration/test_demo_scenario.py
# plus sidecar/tests/helpers/cdn_doubles.py s'il a reçu une gate
git commit -m "feat(demo): enregistrement des sessions du scenario sur le vrai sidecar"
```

### Task 5: Dossier `src/demo/`, CLI et garde stricte

**Files:**
- Modify: `sidecar/tests/helpers/demo_recording.py` (ajout de `write_demo_folder` et `record_demo_folder`)
- Create: `sidecar/record_demo.py`
- Modify: `Justfile` (recette `record-demo` après `demo`, via `Skill[justfile-creator]`)
- Modify: `.prettierignore` (`src/demo/`)
- Modify: `sidecar/pyproject.toml` (`[tool.ruff.lint.per-file-ignores]` : `"record_demo.py" = ["T201"]`, commentaire existant « Scripts lances a la main » partagé)
- Modify: `docs/ARCHITECTURE.md` (arborescence : `src/demo/`, helpers `demo_*`, `sidecar/record_demo.py`)
- Modify: `.claude/skills/quality-check/SKILL.md` (piège de la garde du scénario et recette `record-demo`, via `Skill[skill-creator]`)
- Modify: `.claude/CLAUDE.md` (Must-do No-lib-test et table des commandes, via `Skill[claude-md-doc]`)
- Create: `src/demo/scenario.json`, `src/demo/artworks/*.svg` (générés)
- Test: `sidecar/tests/integration/test_demo_scenario.py` (ajouts)

**Interfaces:**
- Consumes : `record_scenario`, `render_covers`, `resolved_releases`, `TRACKS`, `Scenario`, `walk` (Task 4)
- Produces :
  - `def write_demo_folder(target: Path, scenario: Scenario, covers: Mapping[str, str]) -> None` : vide puis réécrit `target`, avec `scenario.json` en `json.dumps(..., ensure_ascii=False, sort_keys=True, indent=2)` suivi d'un `\n` et `artworks/<nom>.svg`, en UTF-8 (`.claude/rules/python/fichiers-io.md`)
  - `def record_demo_folder(target: Path) -> None` : enregistre dans un dossier temporaire, puis écrit `target`
  - `DEMO_FOLDER: Final = Path(__file__).resolve().parents[3] / "src" / "demo"`

- [ ] **Step 1: Write the failing tests**

```python
def test_re_recording_yields_the_committed_demo_folder(recorded: Recorded, tmp_path: Path) -> None:
    write_demo_folder(tmp_path, recorded.scenario, render_covers(TRACKS))

    differences = folder_differences(tmp_path, DEMO_FOLDER)

    assert not differences, f"scenario de demo perime, lance `just record-demo` puis commite : {differences}"


def test_rewrites_the_demo_folder_entirely(recorded: Recorded, tmp_path: Path) -> None:
    (tmp_path / "artworks").mkdir()
    (tmp_path / "artworks" / "ZZ999.svg").write_text("<svg/>", encoding="utf-8")

    write_demo_folder(tmp_path, recorded.scenario, render_covers(TRACKS))

    assert not (tmp_path / "artworks" / "ZZ999.svg").exists()


def test_every_resolved_release_has_a_cover_and_every_cover_belongs_to_a_release(recorded: Recorded) -> None:
    names = {path.name for path in (DEMO_FOLDER / "artworks").iterdir()}
    referenced = {PurePosixPath(str(line["artwork_path"])).name for line in walk(recorded.scenario.lines) if line.get("artwork_path")}

    assert names == {f"{release.reference}.svg" for _, release in resolved_releases()}
    assert referenced <= names


def test_the_scenario_never_carries_the_sidecar_version() -> None:
    text = (DEMO_FOLDER / "scenario.json").read_text(encoding="utf-8")

    assert f'"{tagger.__version__}"' not in text
```

`folder_differences` est un helper du test : il rend les chemins relatifs absents, en trop ou différents, et pour `scenario.json` les clés de commande (`command_key`, avec rang ou état) dont la réponse diffère. Il nomme ainsi la réponse en cause (scénario 2 du spec). `walk` (Task 4) atteint les `artwork_path` de `run_loaded.tracks`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd sidecar && uv run pytest tests/integration/test_demo_scenario.py -x -q`
Expected: FAIL, `ImportError: write_demo_folder`

- [ ] **Step 3: Implement `write_demo_folder`, `record_demo_folder`, then the CLI and the recipe**

`record_demo.py` suit le schéma de `demo.py` : `sys.path.insert` vers `tests/helpers`, `record_demo_folder(DEMO_FOLDER)`, une ligne de bilan imprimée (nombre de réponses et de pochettes). Recette `Justfile`, écrite après chargement de `Skill[justfile-creator]`, sur le modèle de `demo` :

```
[group('dev')]
[working-directory('sidecar')]
record-demo:
    uv run python record_demo.py
```

Dans `.prettierignore`, sous le bloc « Genere » : `src/demo/`, avec le pourquoi en commentaire (JSON écrit par Python, réécrit par `just record-demo`). Sans cette ligne, `just lint-ui` (`prettier --check .`) échoue sur `scenario.json`, vérifié le 2026-10-25 sur un JSON de `json.dumps(indent=2)`.

- [ ] **Step 4: Générer `src/demo/`**

Run: `just record-demo`, puis `just record-demo` une seconde fois, puis `git status --short src/demo && just lint-ui`
Expected: le premier lancement crée `src/demo/`, le second ne change rien (scénario 1 du spec), et Prettier ignore `src/demo/`.

- [ ] **Step 5: Run the tests**

Run: `cd sidecar && uv run pytest tests/integration/test_demo_scenario.py -x -q`
Expected: PASS

- [ ] **Step 6: Vérifier la garde à la main**

Modifier temporairement une valeur de `DEFAULT_THRESHOLDS` dans `sidecar/src/`, lancer le test de la Step 5, puis annuler la modification.
Expected: `test_re_recording_yields_the_committed_demo_folder` échoue en nommant au moins une commande et en citant `just record-demo` (scénario 2 du spec).

- [ ] **Step 7: Arborescence d'ARCHITECTURE.md**

Charger `Skill[architecture-doc]`. Ajouter `src/demo/` (scénario et pochettes générés, servis par le seul build `demo`), les helpers `demo_*` et `sidecar/record_demo.py` à l'arborescence, à côté de `demo.py`.

- [ ] **Step 8: Skill `quality-check`**

Par `Skill[skill-creator]`, ajouter au skill `quality-check` la recette `just record-demo` et un piège. Quand `test_re_recording_yields_the_committed_demo_folder` échoue, c'est qu'un changement du sidecar, ou une montée d'une de ses dépendances, a modifié une réponse enregistrée : lancer `just record-demo` sous Windows, relire le diff de `src/demo/`, puis le commiter avec le changement (dans la PR Dependabot elle-même, le cas échéant).

- [ ] **Step 9: Must-do du CLAUDE.md projet**

Par `Skill[claude-md-doc]`, dans `.claude/CLAUDE.md` : ajouter la garde `test_re_recording_yields_the_committed_demo_folder` aux exceptions voulues du Must-do No-lib-test, à côté de `data_collection`, avec le renvoi à ADR-023 et la procédure en une phrase ; ajouter `record-demo` à la ligne `quality-check` de la table des commandes.

- [ ] **Step 10: Gate and commit**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`

```bash
git add sidecar/tests/helpers/demo_recording.py sidecar/record_demo.py Justfile .prettierignore sidecar/pyproject.toml docs/ARCHITECTURE.md src/demo sidecar/tests/integration/test_demo_scenario.py .claude/skills/quality-check/SKILL.md .claude/CLAUDE.md
git commit -m "feat(demo): scenario et pochettes de la demo sous garde stricte"
```
