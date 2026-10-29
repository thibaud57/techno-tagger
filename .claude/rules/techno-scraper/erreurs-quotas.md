---
paths:
  - "sidecar/src/tagger/resolution/scraper_client.py"
  - "sidecar/src/tagger/resolution/matching.py"
  - "sidecar/src/tagger/resolution/sources.py"
  - "sidecar/src/tagger/run/url_recovery.py"
---

# techno-scraper : erreurs, quotas et limites

## À faire
- Traiter `200` + `items: []` comme « ce morceau n'existe pas sur cette source » et enchaîner le fallback ; réserver l'échec aux `5xx`, `500` compris (un `500` est une panne de l'API, déjà dans son Sentry, pas un contrat cassé)
- Incriminer la clé API sur un `403` sans repasser par `/health` : le gotcha ci-dessous rend ce statut non ambigu
- Compter les `403` consécutifs plutôt que les interpréter un par un : une clé révoquée en produit autant que de morceaux

## À éviter
- Retryer immédiatement un `504` : la file de l'API est déjà saturée, le retry l'allonge, le morceau part en erreur (cf. [ADR-017](../../../docs/adrs/017-taille-pool-concurrence.md)). Retryer un `403` : la clé ne redeviendra pas valide seule
- Appeler Bandcamp spéculativement : source bornée à 2, l'appel n'a de sens qu'après un échec Beatport
- Compter les téléchargements de pochettes dans le pool de l'API : `artwork_url` pointe le CDN de la source

## Gotchas
- Clé absente et clé invalide rendent toutes deux `403`, jamais `401` : c'est une action utilisateur dans les Settings, pas une panne
- Une erreur n'a ni message ni trace : le diagnostic passe par l'en-tête `X-Request-ID`, présent sur toutes les réponses, à reporter dans les logs
- `504` et `503` se traitent pareil (source indisponible). `502 parse_error` se distingue d'un « rien trouvé » dans le rapport
- Bandcamp a un quota d'environ 185 appels par 3 minutes (mesuré côté API le 2026-09-22) : un `503 source_unavailable` peut être ce quota, ne pas relancer le morceau avant 3 minutes

> Les bornes de concurrence et le timeout client vivent dans [ARCHITECTURE.md § Concurrence](../../../docs/ARCHITECTURE.md#concurrence), la mécanique du client dans [httpx2/client.md](../httpx2/client.md).

## Exemples
```python
# ✅ liste vide et erreur sont deux chemins distincts
if not candidates:
    return next_source()          # rien trouvé
raise SourceUnavailableError()    # 5xx, 500 compris
```
