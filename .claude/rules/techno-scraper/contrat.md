---
paths:
  - "sidecar/src/tagger/scraper_client.py"
  - "sidecar/src/tagger/matching.py"
---

# Contrat techno-scraper — Règles

## À faire
- Isoler dans `scraper_client.py` tout ce qui vient de l'API : URLs, codes HTTP, noms de champs. Un changement d'API ne doit toucher qu'un fichier
- Mapper vers des modèles internes à la frontière : un champ ajouté côté API reste ignoré tant que le mapping ne le lit pas
- Traiter `200` + `items: []` comme « ce morceau n'existe pas sur cette source » et enchaîner le fallback ; réserver l'échec aux `5xx`, `500` compris (un `500` est une panne de l'API, déjà dans son Sentry, pas un contrat cassé)
- Refetch avant d'écrire des tags : par id sur Beatport (`GET /beatport/tracks/{id}`, seul `track_number` manque en recherche), par URL sur Bandcamp (`GET /bandcamp/tracks?url=`, ni date, ni label, ni ISRC, ni numéro de piste en recherche)
- Renvoyer `next_cursor` tel quel sous le nom qu'attend la route : `cursor`, ou `tracks_cursor` sur `/soundcloud/resolve` et `/soundcloud/users/{id}`
- Garder `limit` identique pendant toute l'itération et ne jamais rejouer un curseur sur une autre requête : `400 cursor_limit_mismatch` / `cursor_scope_mismatch`
- Traiter un champ nul comme « non écrit », jamais « à vider » : Bandcamp ne rend ni `bpm`, ni `key`, ni `genre` et ne rend `label` que depuis un compte de label
- Décider explicitement si `remixers[]` entre dans la chaîne artiste : ils sont exclus d'`artists[]` par convention, l'API ne tranche pas
- Consigner le `source` de chaque morceau résolu dans le rapport
- Incriminer la clé API sur un `403` sans repasser par `/health` : le gotcha ci-dessous rend ce statut non ambigu
- Compter les `403` consécutifs plutôt que les interpréter un par un : une clé révoquée en produit autant que de morceaux
- Lire `title`, `artists`, `mix_name`, `remixers`, `label` tels que techno-scraper les rend : ils sont déjà normalisés, ne les redécouper ni avant écriture ni avant scoring. Seul le sous-titre gardé par la gateway sort du titre comparé, comme de la requête ; le nettoyage de requête reste réservé à la chaîne interrogée
- Normaliser une URL collée avant de l'envoyer (query, fragment et `/` final retirés, `https`, hôte en minuscules, `www.` et `m.` SoundCloud réécrits) et refuser sans appel ce qui n'est pas un morceau, en `unsupported_url`

## À éviter
- Retryer un `504` : la file de l'API est déjà saturée, le retry l'allonge. Retryer un `403` : la clé ne redeviendra pas valide seule
- Décoder ou fabriquer un curseur : il est opaque, forward-only, et son encodage change avec la source
- Appeler Bandcamp spéculativement : source bornée à 2, l'appel n'a de sens qu'après un échec Beatport
- Laisser un code HTTP de l'API remonter dans le code métier : la couche anti-corruption perd son intérêt dès la première fuite
- Mapper une réponse de `/soundcloud/resolve` sans regarder la clé `profile` : la route rend `UserProfile | Track` selon l'URL
- Compter les téléchargements de pochettes dans le pool de l'API : `artwork_url` pointe le CDN de la source

## Gotchas
- Clé absente et clé invalide rendent toutes deux `403`, jamais `401` : c'est une action utilisateur dans les Settings, pas une panne
- `/soundcloud/search` n'accepte pas de `type` : un paramètre inconnu rend `422` là où l'API a un modèle de paramètres, et passe en silence ailleurs (`/beatport/tracks/{id}`, `/bandcamp/tracks`)
- `/bandcamp/tracks?url=` n'accepte que `https://<compte>.bandcamp.com/track/<slug>`, sans query string ni `/album/` : une URL collée telle quelle rend `422`. `/soundcloud/resolve` n'impose rien sur l'URL et rend `404 not_found` sur une playlist ou une URL inconnue. SoundCloud rend aussi `404` sur `www.`, `m.` et un `/` final
- Une erreur n'a ni message ni trace : le diagnostic passe par l'en-tête `X-Request-ID`, présent sur toutes les réponses, à reporter dans les logs
- `504` et `503` se traitent pareil (source indisponible). `502 parse_error` se distingue d'un « rien trouvé » dans le rapport
- Bandcamp a un quota d'environ 185 appels par 3 minutes : un `503 source_unavailable` peut être ce quota, ne pas relancer le morceau avant 3 minutes
- `/openapi.json` et `/docs` sont désactivés en production : la référence de contrat est le dépôt techno-scraper
- L'API peut changer entre deux runs sans qu'aucune dépendance ne bouge : valider ses réponses

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
raise SourceUnavailableError()    # 5xx, 500 compris

# ❌ un statut de l'API lu depuis le code métier
if response.status_code == 503:
    ...
```
