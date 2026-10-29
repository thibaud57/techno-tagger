# Recette du monitoring : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vérifier sur l'application installée depuis une Release publiée que Sentry reçoit des deux côtés des événements sans rien de personnel et que l'issue de retour arrive labellisée, grâce à un self-test déclenché au lancement.

**Architecture:** `TECHNO_TAGGER_SENTRY_SELFTEST=1` au lancement : le sidecar remonte une `SentrySelfTestError` juste après `init_sentry` et le dit dans `version.sentry_selftest` ; la webview, par `SentrySelftestService` construit au démarrage, envoie un seul `captureException`. Les deux portent un faux chemin de morceau que le masquage doit effacer. La recette se joue ensuite sur la Release publiée, puis les cases de PRODUCTION.md se cochent.

**Tech Stack:** Python 3.14, sentry-sdk 2.71.0, pytest ; Angular 22, @sentry/angular 11, Vitest ; PowerShell, GitHub, Sentry.

**Spec:** `docs/superpowers/specs/monitoring/05-recette-monitoring-design.md`

## Global Constraints

- Prérequis : sub-projects 01 à 04 implémentés
- Variable `TECHNO_TAGGER_SENTRY_SELFTEST`, seule valeur active `1`, seule variable de configuration lue à l'exécution, relue à chaque appel ; jamais dans `.env.example`
- Faux chemin `D:\Musique\Nova Pulse - Your Mind.mp3`, déclaré en constante de module loin de toute frame qui lève : le SDK joint cinq lignes de source par frame, un littéral voisin partirait avec
- `SentrySelfTestError` est une `Exception`, pas une `TaggerError`
- Un seul événement webview par lancement
- Recette sur l'installeur de la Release publiée, jamais sur un build local ni l'artefact de CI
- Run de la recette de l'issue sur un dossier de travail dédié de quelques morceaux de catalogue public, jamais la bibliothèque personnelle : l'issue reste publique le temps de la recette
- Rejeu du self-test : l'issue Sentry précédente est résolue d'abord, sinon le même groupe ne produit aucun email
- Aucune action sur GitHub ou Sentry (création, suppression) sans confirmation explicite du propriétaire
- Cases de PRODUCTION.md cochées avec leur date, jamais sur une preuve indirecte

## Review Focus

- **Seconde instance lancée avec la variable** : le plugin `single-instance` réveille la fenêtre déjà ouverte, sans variable et rien ne part. La procédure ferme l'application d'abord. Écrit en Task 3
- **`version` reçu deux fois** (après `set_api_key`) : un seul événement webview. Test en Task 2
- **Variable à `true` ou `yes`** : rien ne part, seule `1` déclenche. Test en Task 1
- **Contexte source de la frame du self-test** : aucun fragment du faux titre dans l'enveloppe. Test en Task 1
- **Self-test sans DSN** : rien ne part et rien ne lève. Aucun test : le SDK sans DSN est inerte, comportement du SDK que no-lib-test exclut (dit explicitement en Task 2 pour la webview)
- **Rejeu et règle d'alerte** : un rejeu retombe dans le même groupe Sentry et ne produit aucun email et la règle d'alerte parle d'« exception non gérée » alors que le self-test passe par `capture_unexpected`. Procédure en Task 3, vérification en Task 5 step 3

---

### Task 1 : self-test du sidecar et champ de `version`

**Files:**
- Modify: `sidecar/src/tagger/core/observability.py`
- Modify: `sidecar/src/tagger/__main__.py` (`main`)
- Modify: `sidecar/src/tagger/protocol.py` (`Version`)
- Modify: `sidecar/src/tagger/handlers.py` (`handle_get_version`)
- Test: `sidecar/tests/unit/core/test_sentry_payload.py`, `sidecar/tests/unit/test_main.py`, `sidecar/tests/unit/test_protocol_models.py`, `sidecar/tests/integration/test_ndjson_settings.py`

**Interfaces:**
- Consumes : `capture_unexpected`, `MESSAGE_MASK`, fixture `sent` de `test_sentry_payload.py` (01)
- Produces : `SELFTEST_ENV: Final = "TECHNO_TAGGER_SENTRY_SELFTEST"`, `selftest_requested() -> bool`, `send_selftest() -> None`, `SentrySelfTestError(Exception)` ; `Version.sentry_selftest: bool`

- [ ] **Step 1 : écrire les tests qui échouent**

`test_sentry_payload.py`, importer `send_selftest` et ajouter :

```python
def test_the_self_test_event_carries_no_fragment_of_its_fake_track(sent: list[Envelope]) -> None:
    """Le self-test prouve le masquage sur le vrai pipeline : son faux morceau ne doit pas partir,
    ni par le message, ni par une variable, ni par les lignes de source jointes a la frame."""
    send_selftest()

    rendered = _rendered(sent)
    event = _event(sent)
    entry = event["exception"]["values"][0]
    assert len(sent) == 1
    assert (entry["type"], entry["value"]) == ("SentrySelfTestError", MESSAGE_MASK)
    assert not [fragment for fragment in ("Nova Pulse", "Your Mind") if fragment in rendered]
    assert not [frame for frame in _frames(event) if "vars" in frame]
```

Si Mypy refuse l'accès `event["exception"]["values"][0]`, passer par `cast("dict[str, object]", ...)` au plus près, comme en 01. Pas de test sans DSN : le SDK sans DSN est inerte, comportement du SDK que no-lib-test exclut.

`test_main.py`, importer `SELFTEST_ENV` de `tagger.core.observability` et ajouter la fixture autouse, puis le test :

```python
@pytest.fixture(autouse=True)
def _no_self_test(monkeypatch: pytest.MonkeyPatch) -> None:
    """Une variable posee dans le shell du developpeur ferait executer le vrai `send_selftest`
    par tous les tests qui appellent `main()`."""
    monkeypatch.delenv(SELFTEST_ENV, raising=False)


@pytest.mark.parametrize(
    ("value", "sent"),
    [("1", True), ("true", False), (None, False)],
    ids=["asked", "other-value", "absent"],
)
def test_the_startup_sends_the_self_test_only_when_asked(
    startup: _Startup, monkeypatch: pytest.MonkeyPatch, value: str | None, sent: bool
) -> None:
    if value is not None:
        monkeypatch.setenv(SELFTEST_ENV, value)

    with (
        patch.object(__main__, "send_selftest", autospec=True) as send_selftest,
        patch.object(__main__, "_purge_old_dumps", autospec=True),
        patch.object(__main__, "_purge_old_plans", autospec=True),
        patch.object(__main__, "_purge_old_feedback", autospec=True),
    ):
        __main__.main()

    assert send_selftest.called is sent
```

L'ordre « après `init_sentry` » : étendre `test_logging_and_sentry_are_armed_before_the_loop` en attachant `send_selftest` au `parent` et en posant `monkeypatch.setenv(SELFTEST_ENV, "1")` ; l'ordre attendu devient `setup_logging`, `init_sentry`, `send_selftest`, puis les purges et `run_loop`.

`test_protocol_models.py` : ajouter `sentry_selftest=False` au littéral `Version`.

`test_ndjson_settings.py`, importer `SELFTEST_ENV` et ajouter :

```python
@pytest.mark.usefixtures("app_data")
@pytest.mark.parametrize(
    ("value", "expected"), [("1", True), (None, False)], ids=["asked", "absent"]
)
def test_tells_the_interface_whether_to_send_its_self_test(
    monkeypatch: pytest.MonkeyPatch, value: str | None, expected: bool
) -> None:
    if value is None:
        monkeypatch.delenv(SELFTEST_ENV, raising=False)
    else:
        monkeypatch.setenv(SELFTEST_ENV, value)

    events = drive('{"command":"get_version"}\n')

    assert events[0]["sentry_selftest"] is expected
```

Run : `cd sidecar && uv run pytest tests/unit/core/test_sentry_payload.py tests/unit/test_main.py tests/unit/test_protocol_models.py tests/integration/test_ndjson_settings.py -x -q`
Expected : FAIL à l'import de `send_selftest`

- [ ] **Step 2 : implémenter**

`observability.py`, en tête de module, après `PATH_MASK` (loin de toute fonction qui lève : ses lignes ne doivent entrer dans aucun contexte de frame) :

```python
# Seule variable de configuration lue a l'execution (le DSN est grave au build) : lancee avec
# elle, l'application installee envoie un evenement de test par cote (PRODUCTION.md
# § Observabilite). Le DSN dit ou envoyer, elle dit d'envoyer maintenant.
SELFTEST_ENV: Final = "TECHNO_TAGGER_SENTRY_SELFTEST"
# Faux morceau du self-test, que le masquage doit effacer. Declare ici et non pres de la frame
# qui leve : le SDK joint cinq lignes de source par frame, un litteral voisin partirait avec.
_SELFTEST_PATH: Final = r"D:\Musique\Nova Pulse - Your Mind.mp3"
```

En fin de module :

```python
class SentrySelfTestError(Exception):
    """Evenement de test : pas une `TaggerError`, il n'atteint jamais l'interface."""


def selftest_requested() -> bool:
    """Seule la valeur `1` declenche : une autre, absente comprise, n'envoie rien."""
    return os.getenv(SELFTEST_ENV, "") == "1"


def send_selftest() -> None:
    """Remonte un evenement porteur de fausses donnees sensibles : son message doit arriver en
    `<message>`, sa frame sans variable. DSN vide : rien ne part, comme toute remontee."""
    try:
        _raise_selftest(_SELFTEST_PATH)
    except SentrySelfTestError as error:
        capture_unexpected(error)


def _raise_selftest(path: str) -> None:
    # `path` est la variable locale sensible de la frame : elle ne doit pas partir.
    raise SentrySelfTestError(f"sentry self test, must be masked: {path}")
```

`__main__.py` : importer `selftest_requested` et `send_selftest`, puis dans `main()` juste après `init_sentry(SENTRY_DSN, RELEASE)` :

```python
    if selftest_requested():
        send_selftest()
```

`protocol.py`, `Version` : ajouter `sentry_selftest: bool` et compléter la docstring par « `sentry_selftest` : seul le sidecar lit son environnement, l'interface y apprend qu'elle doit envoyer son evenement de test. »

`handlers.py`, `handle_get_version` : `sentry_selftest=selftest_requested(),` (import depuis `tagger.core.observability`).

- [ ] **Step 3 : lancer, tout passe, puis typage et lint**

Run : `cd sidecar && uv run pytest -x -q && uv run mypy src tests && uv run ruff format . && uv run ruff check .`
Expected : PASS

- [ ] **Step 4 : commit**

```bash
git add sidecar/src/tagger/core/observability.py sidecar/src/tagger/__main__.py sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/tests/
git commit -m "feat(sidecar): self-test Sentry au lancement par TECHNO_TAGGER_SENTRY_SELFTEST"
```

---

### Task 2 : self-test de la webview

**Files:**
- Modify: `src/app/core/sidecar/protocol.ts` (`VersionEvent`)
- Modify: `src/app/core/sidecar/sidecar.service.ts`
- Modify: `src/app/core/sidecar/sidecar.service.spec.ts`
- Modify: `src/fixtures/sidecar-stub.ts`
- Create: `src/app/core/observability/sentry-selftest.service.ts`
- Create: `src/app/core/observability/sentry-selftest.service.spec.ts`
- Modify: `src/app/app.config.ts`

**Interfaces:**
- Produces : `VersionEvent.sentry_selftest: boolean`, `SidecarService.sentrySelftest: Signal<boolean>`, `SentrySelftestService`, `SELFTEST_PATH`

- [ ] **Step 1 : écrire les tests qui échouent**

`sidecar.service.spec.ts` : ajouter `sentry_selftest: false,` au helper `versionEvent`, et :

```typescript
  it("tells whether the engine asks for the self-test", async () => {
    await service.start()

    transport.emit(versionEvent({ sentry_selftest: true }))

    expect(service.sentrySelftest()).toBe(true)
  })
```

`src/app/core/observability/sentry-selftest.service.spec.ts` :

```typescript
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import * as Sentry from "@sentry/angular"

import { sidecarStub } from "../../../fixtures/sidecar-stub"
import { SidecarService } from "../sidecar/sidecar.service"

import { SELFTEST_PATH, SentrySelftestService } from "./sentry-selftest.service"

vi.mock("@sentry/angular", () => ({ captureException: vi.fn() }))

const setUp = () => {
  const asked = signal(false)
  TestBed.configureTestingModule({
    providers: [{ provide: SidecarService, useValue: sidecarStub({ sentrySelftest: asked }) }],
  })
  TestBed.inject(SentrySelftestService)

  return asked
}

describe("SentrySelftestService", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("sends a single test event per launch, even when the engine asks again", () => {
    const asked = setUp()

    asked.set(true)
    TestBed.tick()
    asked.set(false)
    TestBed.tick()
    asked.set(true)
    TestBed.tick()

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(vi.mocked(Sentry.captureException).mock.calls[0]?.[0]).toEqual(
      new Error(`sentry self test, must be masked: ${SELFTEST_PATH}`),
    )
  })

  it("sends nothing when the engine does not ask", () => {
    setUp()

    TestBed.tick()

    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})
```

Pas de test côté webview pour le DSN vide : le SDK sans DSN est inerte, `captureException` est appelé mais rien ne part. C'est un comportement du SDK que no-lib-test exclut, ce choix est assumé.

Run : `pnpm exec ng test --watch=false --include src/app/core/observability/ --include src/app/core/sidecar/sidecar.service.spec.ts`
Expected : FAIL, `./sentry-selftest.service` introuvable

- [ ] **Step 2 : implémenter**

`protocol.ts`, `VersionEvent`, après `log_file` :

```typescript
  /** Lance avec `TECHNO_TAGGER_SENTRY_SELFTEST=1` : l'interface envoie son evenement de test. */
  readonly sentry_selftest: boolean
```

`sidecar.service.ts` : `private readonly _sentrySelftest = signal(false)` près de `_logFile`, l'accesseur `readonly sentrySelftest = this._sentrySelftest.asReadonly()` avec la docstring « Le moteur demande l'evenement de test de la webview (PRODUCTION.md § Observabilite). » et dans `case "version"` : `this._sentrySelftest.set(event.sentry_selftest)`.

`sidecar-stub.ts`, `defaults()` : `sentrySelftest: signal(false),`.

Les scripts `.claude/skills/verify/scripts/page/settings-audit.js`, `settings-admin-layout.js` et `settings-matching-layout.js` fabriquent des événements `version` sans `sentry_selftest` : inoffensif (champ absent, donc faux côté interface), non modifié ici, à compléter par `/verify` à sa prochaine exécution.

`src/app/core/observability/sentry-selftest.service.ts` :

```typescript
import { effect, inject, Service } from "@angular/core"
import * as Sentry from "@sentry/angular"

import { SidecarService } from "../sidecar/sidecar.service"

/** Faux morceau du self-test : `scrub` doit l'effacer en `<path>` de l'evenement envoye. */
export const SELFTEST_PATH = String.raw`D:\Musique\Nova Pulse - Your Mind.mp3`

/**
 * Lancee avec `TECHNO_TAGGER_SENTRY_SELFTEST=1`, l'application envoie un evenement de test de la
 * webview, une seule fois par lancement : `version` revient apres `set_api_key` et a chaque
 * relance du moteur. Seul le sidecar lit l'environnement, il le dit dans `version`.
 */
@Service()
export class SentrySelftestService {
  private readonly sidecar = inject(SidecarService)
  private sent = false

  constructor() {
    effect(() => {
      if (!this.sidecar.sentrySelftest() || this.sent) {
        return
      }
      this.sent = true
      Sentry.captureException(new Error(`sentry self test, must be masked: ${SELFTEST_PATH}`))
    })
  }
}
```

`app.config.ts`, dans l'initialiseur qui construit `CompletionSignalService` :

```typescript
    // Construits des le demarrage : une phase s'annonce quel que soit l'onglet, et le self-test
    // Sentry part sans attendre qu'un ecran l'injecte.
    provideAppInitializer(() => {
      inject(CompletionSignalService)
      inject(SentrySelftestService)
    }),
```

- [ ] **Step 3 : lancer, tout passe, puis lint et typage**

Run : `pnpm exec ng test --watch=false && just lint && just typecheck`
Expected : PASS

- [ ] **Step 4 : commit**

```bash
git add src/app/core/sidecar/ src/app/core/observability/ src/app/app.config.ts src/fixtures/sidecar-stub.ts
git commit -m "feat(ui): self-test Sentry de la webview sur demande du moteur"
```

---

### Task 3 : procédure et contrat dans la doc

**Files:**
- Modify: `docs/PRODUCTION.md`
- Modify: `docs/ARCHITECTURE.md` (§ API, ligne de `version`)
- Modify: `.claude/rules/sentry/python.md` (via `Skill[rules-doc]`)
- Modify: `docs/knowledges/sentry.md` (via `Skill[knowledge-doc]`)

- [ ] **Step 1 : PRODUCTION.md**

- § Variables d'Environnement : une ligne pour `TECHNO_TAGGER_SENTRY_SELFTEST`, « seule variable de configuration lue à l'exécution, diagnostic ; `1` envoie un événement de test par côté, toute autre valeur rien ». Corriger la phrase « **aucune variable d'environnement** » (l.237 au 2026-10-16) en « aucune variable de configuration, hormis `TECHNO_TAGGER_SENTRY_SELFTEST` réservée au diagnostic » et sa reprise l.739 (« faute de serveur et de variables d'environnement au runtime ») de la même façon
- § Observabilité, après la stack monitoring, une sous-section « Vérifier la remontée depuis l'application installée » :

```markdown
1. Fermer l'application : le plugin `single-instance` réveillerait la fenêtre ouverte, qui n'a pas la variable.
2. Dans Sentry (organisation `<org>`), résoudre les issues de self-test d'un rejeu précédent : `SentrySelfTestError` dans `techno-tagger-sidecar`, `Error` « sentry self test » dans `techno-tagger-ui`. Un rejeu retombe dans le même groupe et, sans nouvelle issue, aucun email ne part.
3. Dans PowerShell : `$env:TECHNO_TAGGER_SENTRY_SELFTEST = "1"`, puis `& "$env:LOCALAPPDATA\techno-tagger\techno-tagger.exe"` (dossier par défaut d'une installation NSIS en `currentUser`, à confirmer par la cible du raccourci du menu Démarrer), puis `Remove-Item Env:TECHNO_TAGGER_SENTRY_SELFTEST` : sinon la variable reste posée dans la session et chaque lancement suivant enverrait ses événements.
4. Dans Sentry, Issues de chaque projet : une issue `SentrySelfTestError` dans `techno-tagger-sidecar`, une issue `Error` dans `techno-tagger-ui`, chacune avec son email à l'adresse d'alerte du propriétaire.
5. Ouvrir l'événement, puis la vue JSON (lien en tête de l'événement) et y rechercher `Nova`, `Mind`, le nom de compte Windows (`$env:USERNAME`), le nom de la machine (`$env:COMPUTERNAME`) et `vars` : aucune occurrence.
6. Payload attendu : `release` identique des deux côtés, `environment: production` des deux côtés, `server_name` égal au nom de l'application sur l'événement du sidecar seulement (le SDK navigateur n'en pose pas), aucune variable de frame, aucun nom de compte ni chemin, aucun fragment du faux morceau ; message du sidecar en `<message>`, chemin de la webview en `<path>`.
```

- Checklist Post-MEP, après « Release Sentry créée au tag » :

```markdown
- [ ] **Issue de retour vérifiée en réel** : depuis l'application installée, « Envoyer ce rapport » sur un run réel ouvre l'Issue Form `matching-report.yml` pré-rempli sans troncature et l'Explorateur sur l'export ; envoyée depuis un compte non collaborateur, export glissé, l'issue porte le label `matching-report`
```

- [ ] **Step 2 : ARCHITECTURE.md § API**

Ajouter `sentry_selftest` à la liste des champs de `version`, avec « vrai quand le sidecar est lancé avec `TECHNO_TAGGER_SENTRY_SELFTEST=1` : l'interface envoie son événement de test (PRODUCTION.md § Observabilité) ».

- [ ] **Step 3 : rule Sentry Python, via `Skill[rules-doc]`**

Charger le skill, puis remplacer la puce « Provoquer une exception de test **depuis le binaire empaqueté** [...] » par « Provoquer l'événement de test depuis l'application installée par `TECHNO_TAGGER_SENTRY_SELFTEST=1` (PRODUCTION.md § Observabilité) et confirmer son arrivée dans Sentry avant de considérer l'observabilité en place ».

- [ ] **Step 4 : fiche Sentry, via `Skill[knowledge-doc]`**

Charger le skill, lire template et conventions, puis dans `docs/knowledges/sentry.md` remplacer les puces des l.171 (« Vérifier la remontée depuis le binaire empaqueté… ») et l.239 (« Provoquer une erreur de test depuis le binaire empaqueté… »), relevées le 2026-10-16, par « Vérifier la remontée depuis l'application installée par `TECHNO_TAGGER_SENTRY_SELFTEST=1` (PRODUCTION.md § Observabilité) avant de considérer l'observabilité en place ».

- [ ] **Step 5 : commit**

```bash
git add docs/PRODUCTION.md docs/ARCHITECTURE.md .claude/rules/sentry/python.md docs/knowledges/sentry.md
git commit -m "docs(sidecar): procedure du self-test Sentry et issue de retour en post-MEP"
```

---

### Task 4 : gate qualité, avant la release

- [ ] **Step 1**

Run : `just lint && just typecheck && just test`
Expected : tout vert. La Feature 9 suit ensuite sa chaîne d'intégration (`/finalize-feature`) jusqu'à la Release ; la recette commence une fois la Release publiée.

---

### Task 5 : recette sur la Release publiée

Manuelle. Chaque étape cochée note sa date ; une étape qui échoue ouvre un `hotfix/*` (PRODUCTION.md § Rollback) et la recette reprend sur le PATCH.

- [ ] **Step 1 : releases et source maps** (2026-10-19 : purge non prouvée)

Dans Sentry (organisation `<org>`), page Releases de `techno-tagger-sidecar` puis de `techno-tagger-ui` : la version publiée existe, onglet Commits renseigné.

Source maps : ouvrir le log du job de build de la Release. Il énumère les `.map` envoyés par `sentry-cli` et n'en montre plus après la purge. Le script npm `sourcemaps` supprime sans rien afficher : si le log ne montre pas la purge, la case reste ouverte et un `chore(ci)` ajoute un `find dist -name '*.map'` après la purge. Aucun contrôle sur l'installeur ni sur le dossier installé : `tauri-codegen` embarque `frontendDist` dans le binaire (PRODUCTION.md l.316), un `.map` oublié n'y serait pas un fichier et la recherche rendrait toujours vide. La seconde preuve est la pile lisible en TypeScript, relevée au step 3.

- [x] **Step 2 : label** (2026-10-19)

`gh label list --search matching-report`. S'il manque, demander la confirmation du propriétaire puis `gh label create matching-report --description "Matching report sent from the app" --color 0e8a16`.

- [x] **Step 3 : self-test** (2026-10-19)

Suivre la procédure de PRODUCTION.md § Observabilité (« Vérifier la remontée depuis l'application installée ») sur l'application installée depuis la Release : résoudre d'abord les issues de self-test précédentes, lancer avec la variable, la retirer de la session. Dans Sentry (organisation `<org>`) :
1. Issues de `techno-tagger-sidecar` : issue `SentrySelfTestError`. Issues de `techno-tagger-ui` : issue `Error` « sentry self test ». Un email pour chacune, dans la boîte de l'adresse d'alerte du propriétaire.
2. Pour chaque événement : vue JSON (lien en tête de l'événement), recherche de `Nova`, `Mind`, du nom de compte Windows, du nom de la machine et de `vars` : aucune occurrence. Puis le payload attendu point par point (`server_name` sur l'événement du sidecar seulement).
3. Pile de l'événement webview lisible en TypeScript (source maps résolues par Debug ID).
4. Première recette seulement : ouvrir la règle d'alerte de chaque projet et vérifier qu'elle couvre une exception capturée par `capture_unexpected`, PRODUCTION.md § Alertes parlant d'« exception non gérée ». Si elle ne la couvre pas, corriger la règle ou PRODUCTION.md et laisser « Chaîne d'alerte Sentry » ouverte jusqu'au rejeu suivant.

- [ ] **Step 4 : issue de retour** (2026-10-19 : label non vérifié depuis un non-collaborateur)

Sur un run réel écrit depuis l'application installée, dans un dossier de travail dédié qui contient quelques morceaux de catalogue public, jamais la bibliothèque personnelle : l'issue reste publique le temps de la recette et porte les noms de fichiers du run.
1. « Envoyer ce rapport » : le navigateur s'ouvre sur l'Issue Form, version, résumé et consigne pré-remplis, résumé entier ou terminé par la ligne « more » ; l'Explorateur s'ouvre sur l'export.
2. Glisser l'export dans le champ `export`.
3. Envoyer depuis un compte non collaborateur du dépôt (utilisateur réel, ou second compte) : le label `matching-report` est posé, le fichier joint s'ouvre.
4. Après confirmation du propriétaire, supprimer l'issue de test (elle porte de vrais titres), sauf s'il décide de la garder.

Compte non collaborateur indisponible : cette case reste ouverte, le reste se coche.

- [x] **Step 5 : cases de PRODUCTION.md** (2026-10-19, trois cases restent ouvertes)

Cocher avec la date de la recette, chacune sur sa preuve directe :
- Checklist Pré-MEP : « Durcissement Sentry en place et testé »
- Checklist Pré-MEP > Bootstrap technique : « Releases Sentry créées dans les deux projets », « Source maps de la webview uploadées puis purgées » (preuve du step 1 et du step 3)
- Validation technique finale : « Test de sécurité vert » ne se coche que si les parties logs, rapports et clé API sont aussi prouvées (le payload Sentry seul ne suffit pas), sinon elle reste ouverte
- Checklist Post-MEP : « Chaîne d'alerte Sentry », « Payload Sentry inspecté en vrai », « Release Sentry créée au tag », « Issue de retour vérifiée en réel »

Mettre à jour la note « Déjà vérifié sur build local au bootstrap » : ce qu'elle laissait à couvrir (email, titre dans un payload, application installée) est couvert à cette date.

- [x] **Step 6 : ARCHITECTURE.md, ordre de développement** (2026-10-19)

Étape 8 : noter le monitoring livré, avec la version de la Release.

- [ ] **Step 7 : commit**

```bash
git add docs/PRODUCTION.md docs/ARCHITECTURE.md
git commit -m "docs: recette du monitoring sur la release, cases sentry et issue de retour cochees"
```
