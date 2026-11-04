---
paths:
  - "sidecar/src/tagger/resolution/scraper_client.py"
  - "sidecar/src/tagger/resolution/matching.py"
  - "sidecar/src/tagger/resolution/sources.py"
  - "sidecar/src/tagger/run/url_recovery.py"
---

# techno-scraper : contrat d'API

## À faire
- Isoler dans `scraper_client.py` tout ce qui vient de l'API : URLs, codes HTTP, noms de champs. Un changement d'API ne doit toucher qu'un fichier et un code HTTP qui fuit dans le code métier fait perdre son intérêt à la couche anti-corruption
- Refetch avant d'écrire des tags : par id sur Beatport (`GET /beatport/tracks/{id}`, seul `track_number` manque en recherche), par URL sur Bandcamp (`GET /bandcamp/tracks?url=`, ni date, ni label, ni ISRC, ni numéro de piste en recherche)
- Renvoyer `next_cursor` tel quel sous le nom qu'attend la route : `cursor`, ou `tracks_cursor` sur `/soundcloud/resolve` et `/soundcloud/users/{id}`
- Garder `limit` identique pendant toute l'itération et ne jamais rejouer un curseur sur une autre requête : `400 cursor_limit_mismatch` / `cursor_scope_mismatch`
- Traiter un champ nul comme « non écrit », jamais « à vider » : Bandcamp ne rend ni `bpm`, ni `key`, ni `genre` et ne rend `label` que depuis le compte hôte non crédité (`None` quand le compte est l'artiste)
- Décider explicitement si `remixers[]` entre dans la chaîne artiste : ils sont exclus d'`artists[]` par convention, l'API ne tranche pas
- Consigner le `source` de chaque morceau résolu dans le rapport
- Lire `title`, `artists`, `mix_name`, `remixers`, `label` tels que techno-scraper les rend : ils sont déjà normalisés, ne les redécouper ni avant écriture ni avant scoring. Seul le sous-titre gardé par la gateway sort du titre comparé, comme de la requête ; le nettoyage de requête reste réservé à la chaîne interrogée
- Normaliser une URL collée avant de l'envoyer (query, fragment et `/` final retirés, `https`, hôte en minuscules, `www.` et `m.` SoundCloud réécrits, segment de langue Beatport `/fr` ou `/pt-br` ignoré) et refuser sans appel ce qui n'est pas un morceau, en `unsupported_url`

## À éviter
- Décoder ou fabriquer un curseur : il est opaque, forward-only et son encodage change avec la source
- Mapper une réponse de `/soundcloud/resolve` sans regarder la clé `profile` : la route rend `UserProfile | Track` selon l'URL

## Gotchas
- `/soundcloud/search` n'accepte pas de `type` : un paramètre inconnu rend `422` là où l'API a un modèle de paramètres et passe en silence ailleurs (`/beatport/tracks/{id}`, `/bandcamp/tracks`)
- `/bandcamp/tracks?url=` n'accepte que `https://<compte>.bandcamp.com/track/<slug>`, sans query string ni `/album/` : une URL collée telle quelle rend `422`. `/soundcloud/resolve` n'impose rien sur l'URL et rend `404 not_found` sur une playlist ou une URL inconnue. SoundCloud rend aussi `404` sur `www.`, `m.` et un `/` final
- `/openapi.json` et `/docs` sont désactivés en production : la référence de contrat est le dépôt techno-scraper
- L'API peut changer entre deux runs sans qu'aucune dépendance ne bouge : valider ses réponses

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

# ❌ un statut de l'API lu depuis le code métier
if response.status_code == 503:
    ...
```
