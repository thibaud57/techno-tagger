---
paths:
  - "sidecar/tests/**/*.py"
---

# pytest : tests du sidecar

## À faire
- Asserter le comportement observable (événements émis, fichier écrit), pas les appels internes : sur-mocker couple le test à l'implémentation
- `test_main.py` porte la garde de cohérence des valeurs recopiées entre manifestes : nom, identifiant, binaire, versions et filtres des lockfiles de release-please (cf. « Une valeur, une source » du `CLAUDE.md` projet) : quand la dérivation est impossible, la copie est gardée par un test de cohérence, jamais laissée à la vigilance, ces divergences étant muettes jusqu'à l'exécution du bundle
- Typer un remplaçant de test sous n'importe quelle signature par le Protocol `Replacement` de `tests/helpers/stubs.py`, jamais par `Callable[..., T]`
- Mocker le client techno-scraper par le `MockTransport` natif d'httpx2, injecté via le paramètre `transport` du client : `respx` et `pytest-httpx` ne supportent pas httpx2 (cf. [httpx2/client.md](../httpx2/client.md))
- `monkeypatch` pour une valeur, un attribut ou une variable d'environnement (annulation automatique) ; `unittest.mock.patch(..., autospec=True)` quand un `Mock` complet est nécessaire : sans `autospec`, un changement de signature passe inaperçu
- `@pytest.mark.parametrize(..., ids=[...])` pour les jeux de données, `ids` en anglais comme les noms de tests, un cas par échec localisé
- `pytest.raises(MonErreur, match=...)` et `excinfo.group_contains(...)` pour l'`ExceptionGroup` d'un `TaskGroup`
- Chercher dans `sidecar/tests/helpers/` le fake ou le pilote avant d'en écrire un ; un helper y entre dès qu'un deuxième test en a besoin et un double unitaire (HTTP, audio, enregistrements) n'importe jamais le harnais de run (`tagging_api`). `conftest.py` ne garde que les fixtures

## À éviter
- Un appel réseau ou Sentry réel : les deux sont toujours mockés, aucun test ne consomme le quota, sauf `test_sentry_payload.py`, qui initialise le vrai SDK par `init_sentry` avec un transport factice retenant l'enveloppe : aucun réseau, aucun quota
- Élargir le `scope` d'une fixture qui porte de l'état mutable

## Gotchas
- Deux exceptions voulues au No-lib-test : `test_sentry_payload.py` (garde `data_collection`) échoue quand une montée de sentry-sdk ajoute une catégorie de collecte (cf. [sentry/python.md](../sentry/python.md)) ; `test_re_recording_yields_the_committed_demo_folder` (`tests/integration/test_demo_scenario.py`) échoue quand un changement du sidecar ou une montée de rapidfuzz, mutagen ou pydantic modifie une réponse enregistrée, ce qui se répare par `just record-demo` sous Windows puis le commit du diff de `src/demo/` (cf. [ADR-023](../../../docs/adrs/023-demo-web-par-rejeu.md))
- Ne pas tester que mutagen sait écrire un `TPE1` ni qu'un `@if` masque un div : tester que notre table de correspondance envoie le bon champ au bon tag
- pytest-asyncio 1.0 : fixture `event_loop` supprimée, remplacée par `loop_scope` de `@pytest.mark.asyncio` ; `event_loop_policy` dépréciée en 1.4
- Le seuil de couverture du sidecar est bloquant en CI (cf. [ARCHITECTURE.md § Coverage](../../../docs/ARCHITECTURE.md#coverage)) : il localise les zones non testées, il ne prouve rien sur la qualité des assertions
- Le protocole NDJSON se teste de bout en bout en injectant des commandes sur `stdin` et en lisant `stdout`, sans lancer l'interface
- Un test de sécurité dédié vérifie que la clé API n'apparaît ni dans les logs, ni dans les rapports, ni dans les payloads Sentry

## Exemples
```python
# ✅ règle métier + AAA + MockTransport
def test_below_threshold_never_reaches_arbitration():
    client = ScraperClient(transport=MockTransport(lambda r: Response(200, json=LOW_SCORE)))

    result = resolve(track, client, thresholds=DEFAULT)

    assert result.failure_reason == "below_threshold"

# ❌ teste la lib, pas notre code
def test_mutagen_writes_tpe1(tmp_path):
    ...
```
