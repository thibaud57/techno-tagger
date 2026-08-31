---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python Stdlib Données (re, collections, itertools) — Règles

## À faire
- `re.compile()` hors boucle, motifs en raw strings, groupes nommés `(?P<nom>...)` relus par `groupdict()`
- `re.fullmatch` pour valider un format complet, `re.finditer` pour parcourir un gros texte
- Se replier sur la chaîne d'origine quand le nettoyage d'une requête la vide : une requête inexploitable est un motif d'échec distinct de « rien trouvé » (ce que le nettoyage doit préserver est dans [matching.md](../rapidfuzz/matching.md))
- `Counter` pour les compteurs du récapitulatif, `defaultdict(list)` pour regrouper, les doublons de noms de fichiers notamment (cf. [ADR-020](../../../docs/adrs/020-doublons-noms-de-fichiers.md))
- Trier sur la clé de groupe avant `itertools.groupby`, et matérialiser chaque sous-itérateur avant d'avancer
- `itertools.batched(it, n)` pour découper un flux en lots

## À éviter
- `re.match` pour valider : il n'ancre qu'au début, `re.match(r"\d+", "12abc")` matche
- Un `.*` greedy là où une classe négée (`[^>]*`) dit la même chose, plus clairement et plus vite
- Lire une clé d'un `defaultdict` sans intention de la créer : la lecture crée l'entrée et fausse un `in` ultérieur
- Ré-itérer un itérateur `itertools` déjà consommé — il est vide, sans erreur

## Gotchas
- `groupby` sur des données non triées par la clé de groupe scinde les groupes sans rien lever : la même clé réapparaît plus loin
- Un motif non compilé repose sur le cache interne de `re`, qui est borné et peut évincer : sur un run de plusieurs centaines de morceaux, la compilation explicite se voit

## Exemples
```python
# ✅ compilé une fois, groupes nommés, repli sur l'original
VERSION = re.compile(r"\((?P<label>original mix|extended mix|radio edit)\)", re.I)

def clean(title: str) -> str:
    cleaned = NOISE.sub("", title).strip()
    return cleaned or title      # ne jamais renvoyer une requête vide

# ❌ compile à chaque appel, ne valide qu'un préfixe
def is_year(value: str) -> bool:
    return bool(re.match(r"\d{4}", value))
```
