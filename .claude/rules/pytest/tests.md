---
paths:
  - "sidecar/tests/**/*.py"
---

# pytest — Tests du sidecar

## À faire
- N'écrire un test que s'il vérifie une règle métier du projet : une régression de notre code doit le faire échouer
- Structurer en Arrange / Act / Assert séparés par une ligne vide, sans commentaire de section
- Mocker le client techno-scraper par le `MockTransport` natif d'httpx2, injecté via le paramètre `transport` du client
- Écrire dans `tmp_path`, jamais dans un chemin en dur ni dans le répertoire courant
- `monkeypatch` pour une valeur, un attribut ou une variable d'environnement (annulation automatique) ; `unittest.mock.patch(..., autospec=True)` quand un `Mock` complet est nécessaire
- Patcher le symbole là où il est utilisé, pas là où il est défini
- `@pytest.mark.parametrize(..., ids=[...])` pour les jeux de données, un cas par échec localisé
- `pytest.raises(MonErreur, match=...)`, et `excinfo.group_contains(...)` pour l'`ExceptionGroup` d'un `TaskGroup`
- Mettre les fixtures partagées dans `conftest.py`, avec teardown après `yield`

## À éviter
- Tester mutagen, rapidfuzz, httpx2 ou la stdlib : un test qui casse à la mise à jour d'une dépendance est un test à supprimer
- `respx` et `pytest-httpx` : ni l'un ni l'autre ne supporte httpx2, les PR de support sont ouvertes et non mergées
- Un appel réseau ou Sentry réel — les deux sont toujours mockés, aucun test ne consomme le quota
- Mocker sans `autospec` : un changement de signature passe alors inaperçu
- Élargir le `scope` d'une fixture qui porte de l'état mutable

## Gotchas
- pytest 9.0 : les `PytestRemovedIn9Warning` sont des erreurs, et le contournement `filterwarnings = ignore::...` ne fonctionne plus depuis 9.1
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
