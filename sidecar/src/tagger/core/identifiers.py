"""Identifiants d'un run et d'un morceau."""

from typing import NewType

# Types nommes pour que mypy refuse une permutation : `stamped_name` et `find_by_run_id`
# prennent un `run_id` et un autre `str`, dans des ordres opposes.
RunId = NewType("RunId", str)
TrackId = NewType("TrackId", str)
