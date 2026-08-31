"""Modeles Pydantic des commandes et des evenements du protocole NDJSON.

Seule interface publique du sidecar : tout le reste est appele depuis la boucle
de `__main__.py`. Les types TypeScript de `src/app/core/models/` sont maintenus
a la main en miroir de ce fichier.
"""

# TODO: implement, commandes (get_version, list_playlists, extract_playlist,
# start_tagging, resolve_arbitration, ...) et evenements (version, progress,
# track_resolved, arbitration_required, run_finished, error, ...).
