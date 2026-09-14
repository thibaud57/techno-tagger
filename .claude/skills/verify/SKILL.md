---
name: verify
description: Recette de /verify pour techno-tagger. Pilote le sidecar Python par son protocole NDJSON sur stdin/stdout, sans interface, sur une arborescence de test isolée. Écrite et maintenue par /verify lui-même.
---

# verify - Recette de vérification runtime

## Surface

- **Sidecar** : process `python -m tagger`, commandes NDJSON sur `stdin`, événements sur `stdout`, logs sur `stderr`. Handle : `just dev-sidecar` (recette `[working-directory('sidecar')]`), alimenté par un pipe
- **Interface** (Angular + Tauri) : pas encore couverte par cette recette, à compléter au premier `/verify` qui touche `src/` ou `src-tauri/`

## Fixture isolée

Tout dans le scratchpad de session, jamais dans le dépôt ni dans une vraie bibliothèque. Le dump se bâtit par le helper de test, c'est de la mise en place et non une vérification :

```bash
cd sidecar && PYTHONIOENCODING=utf-8 uv run python - "$V" <<'EOF'
import sys
from pathlib import Path
sys.path.insert(0, "tests/helpers")
from vlc_dump import build_dump, TRACKS   # playlists "test playlist" (5) et "other playlist" (1)
root = Path(sys.argv[1])
build_dump(root / "vlc_media.db")
# + une bibliothèque avec un homonyme de taille différente, un .m3u8, un faux JPEG, un fichier "occupied"
EOF
```

## Pilotage

```bash
{ printf '{"command":"get_version"}\n'
  printf '{"command":"extract_playlist","source_folder":"%s","destination_folder":"%s","playlist_path":"%s","playlist_name":"test playlist"}\n' "$V/library" "$V/work" "$V/vlc_media.db"
} | just dev-sidecar > "$V/out" 2> "$V/err"; echo "EXIT=$?"
```

Relire `stdout` (chaque ligne doit se parser seule en objet JSON, sans indentation), `stderr` à part, puis l'état du disque (`work`, rapports, bibliothèque intacte).

## Flux qui valent le coup

- Nominal : `get_version`, `list_playlists` (dump puis M3U8), `extract_playlist` avec homonyme, rapport `.json` + `.md` présents
- Refus sans arrêt de la boucle : champ en trop, ligne non-JSON, commande inconnue (`params.command`), playlist inconnue, fichier non décodable, destination impossible à créer (chemin occupé par un fichier). Enchaîner un `get_version` après chacun
- Fin : `shutdown` suivi d'une commande (ignorée, sortie 0), `stdin` vide (sortie 0)
- État : relancer la même extraction dans la même destination (catégorie `already_present`, rapports suffixés `-2`, `-3` dans la même seconde)

## Gotchas

- `just` écrit la ligne de recette (`uv run python -m tagger`) sur `stderr` : ne pas la prendre pour une fuite du protocole
- Console Windows en cp1252 : un `print` non ASCII dans un script de fixture lève `UnicodeEncodeError`, poser `PYTHONIOENCODING=utf-8`
- Un octet non UTF-8 sur `stdin` fait tomber le process, et avec lui les commandes valides du même bloc lu : comportement documenté de `run_loop`, pas une régression
- Le logger du point d'entrée s'appelle `__main__` et non `tagger.__main__` sous `python -m`
- Mode `move` : ne le piloter que sur une copie de la bibliothèque de fixture
