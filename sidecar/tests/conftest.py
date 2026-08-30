"""Fixtures partagees des tests du sidecar.

Aucun test ne consomme le quota de techno-scraper ni ne pollue le projet Sentry :
le client HTTP se mocke par le `MockTransport` natif d'httpx2, `respx` et
`pytest-httpx` ne supportant pas ce fork (cf. VERSIONS.md § Conflits Potentiels).
"""

# TODO: implement — fixture de transport httpx2 mocke, fichiers audio des quatre
# formats, base vlc_media.db de test, playlists M3U8 d'exemple.
