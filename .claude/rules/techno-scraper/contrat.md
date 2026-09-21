---
paths:
  - "sidecar/src/tagger/scraper_client.py"
---

# Contrat techno-scraper — Règles

## À faire
- Isoler dans `scraper_client.py` tout ce qui vient de l'API : URLs, codes HTTP, noms de champs. Un changement d'API ne doit toucher qu'un fichier
- Mapper vers des modèles internes à la frontière : un champ ajouté côté API reste ignoré tant que le mapping ne le lit pas
- Traiter `200` + `items: []` comme « ce morceau n'existe pas sur cette source » et enchaîner le fallback ; réserver l'échec aux `502`, `503` et `504`
- Refetch par id (`GET /beatport/tracks/{id}`) avant d'écrire des tags : les objets rendus par `search` sont parfois abrégés
- Renvoyer `next_cursor` tel quel, sans le lire, **sous le nom qu'attend la route** : `cursor` sur `/beatport/search` et `/soundcloud/users/{id}/likes`, mais `tracks_cursor` sur `/soundcloud/resolve` et `/soundcloud/users/{id}`, dont c'est une seconde collection
- Garder `limit` strictement identique pendant toute l'itération d'une route paginée, et ne jamais rejouer un curseur sur une autre requête (`q`, `type`, id ou filtre de date différents) : les deux rendent `400` (`cursor_limit_mismatch` / `cursor_scope_mismatch`)
- Traiter un champ nul comme « champ non écrit », jamais comme « champ à vider » : Bandcamp ne rend ni `bpm`, ni `key`, ni `genre`, ni `label` (cf. [ADR-011](../../../docs/adrs/011-politique-ecriture-tags.md))
- Décider explicitement si `remixers[]` entre dans la chaîne artiste : ils sont exclus d'`artists[]` par convention, l'API ne tranche pas
- Consigner le `source` de chaque morceau résolu dans le rapport, et vérifier `/health` (sans clé) avant d'incriminer la clé API

## À éviter
- Retryer un `504` : la file de l'API est déjà saturée, le retry l'allonge. Retryer un `403` : la clé ne redeviendra pas valide seule
- Décoder ou fabriquer un curseur : il est opaque, forward-only, et son encodage change avec la source
- Appeler Bandcamp spéculativement : source bornée à 2, l'appel n'a de sens qu'après un échec Beatport
- Laisser un code HTTP de l'API remonter dans le code métier : la couche anti-corruption perd son intérêt dès la première fuite
- Mapper `/soundcloud/resolve` comme un `Track` : il rend une enveloppe `UserProfile` (`{ profile, tracks }`)
- Compter les téléchargements de pochettes dans le pool de l'API : `artwork_url` pointe le CDN de la source

## Gotchas
- Clé absente et clé invalide rendent toutes deux `403`, jamais `401` : c'est une action utilisateur dans les Settings, pas une panne
- `/soundcloud/search` n'accepte **pas** de `type` (SoundCloud ne cherche que des profils, la route rend `Page[Profile]`). Les modèles de paramètres de l'API sont en `extra="forbid"` : un paramètre inconnu y rend `422`, jamais un résultat dégradé. Sans Parameter Model (`/beatport/tracks/{id}`, `/bandcamp/tracks`), un paramètre en trop est ignoré en silence, pas rejeté
- Le corps d'une erreur est `{code, provider, request_id}` sur 404, 502 et 503, sans `provider` sur 400 et 504, et le `{"detail": ...}` par défaut de FastAPI sur 403, jamais de message ni de trace : le diagnostic passe par le `request_id`, à lire dans l'en-tête `X-Request-ID`, présent sur **toutes** les réponses. Le reporter dans les logs, c'est lui qui relie un incident à sa ligne côté API
- Le `504` prime sur le `503` quand les deux sont possibles, et se traite pareil : source indisponible, seul le code diffère. `502 parse_error` n'est pas actionnable côté application, mais le rapport doit le distinguer d'un « rien trouvé »
- Beatport plafonne sa fenêtre de recherche à 10 000 résultats cumulés, au-delà `400 cursor_out_of_range`. Le `429` Bandcamp est constaté dès 3-4 requêtes simultanées côté API
- `/openapi.json`, `/docs` et `/redoc` sont désactivés en production : la référence de contrat est le dépôt techno-scraper
- L'API n'est figée par aucun lockfile : elle peut évoluer entre deux runs sans qu'aucune dépendance ne bouge, la validation des réponses est une protection contre l'API elle-même

> Les bornes de concurrence et le timeout client vivent dans [ARCHITECTURE.md § Concurrence](../../../docs/ARCHITECTURE.md#concurrence), la mécanique du client dans [client.md](../httpx2/client.md).

## Exemples
```python
# ✅ le mapping des codes HTTP ne sort pas de ce module
# `source` restreint au type : `type=tracks` n'existe pas sur /soundcloud/search (→ 422)
async def search_tracks(
    self, source: Literal[Source.BEATPORT, Source.BANDCAMP], query: str
) -> list[TrackCandidate]:
    response = await self._client.get(f"/{source}/search", params={"q": query, "type": "tracks"})
    response.raise_for_status()
    return [TrackCandidate.from_api(item) for item in response.json()["items"]]

# ✅ liste vide et erreur sont deux chemins distincts
if not candidates:
    return next_source()          # rien trouvé
raise SourceUnavailableError()    # 502 / 503 / 504

# ❌ un statut de l'API lu depuis le code métier
if response.status_code == 503:
    ...
```
