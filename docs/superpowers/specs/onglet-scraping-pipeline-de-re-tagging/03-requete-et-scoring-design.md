---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "requete-et-scoring"
goal: "Construire la requête d'un morceau puis classer les candidats d'une source en auto, zone grise ou vide selon les seuils de matching"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: ["02-client-techno-scraper-design.md"]
date: "2026-09-19"
---

# Construction de la requête et classement des candidats

## Scope

Couvre les deux fonctions pures du matching. La première construit la requête d'un morceau depuis ses tags artiste et titre, avec repli sur le nom de fichier. Elle nettoie la chaîne sous ses gardes de version et de collaboration, normalise les séparateurs d'artistes, reprend la valeur brute quand le nettoyage vide un tag et signale `empty_query` quand rien n'est exploitable. La seconde score les candidats d'une source sur trois axes distincts (artiste, titre nu, version), écarte les candidats sans remix quand la requête en porte un et classe le morceau en auto, zone grise ou vide selon le plancher et le seuil haut. Couvre aussi l'extension de la garde de version dans ARCHITECTURE.md.

Exclut l'appel réseau (sub-project 02), l'enchaînement Beatport puis Bandcamp et la traduction en `failure_reason` (sub-project 06), le réglage des seuils dans les Settings (Feature 7) et leur recalibrage sur les premiers runs réels (ADR-008).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer une suite qui construit la requête de noms de tags et de fichiers représentatifs (bruit de téléchargement, label entre crochets, numéro de piste, groupe de remix ou de featuring préservé, fichier réduit à du bruit), normalise les séparateurs d'artistes, puis classe un jeu de candidats dans chacun des trois états avec les seuils par défaut.

## Dependencies

- `02-client-techno-scraper-design.md` (statut: draft) : fournit `TrackCandidate` et `Credit`, les candidats que ce module score.

## Files touched

- **À modifier** : `sidecar/src/tagger/matching.py` (remplace le placeholder : nettoyage, requête, seuils, scoring, classement)
- **À créer** : `sidecar/tests/unit/test_matching_query.py` (nettoyage, gardes, séparateurs, repli, `empty_query`)
- **À créer** : `sidecar/tests/unit/test_matching_scoring.py` (chaînes comparées, scorers, garde remix, seuils, classement)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Use-case 2 : garde de version étendue, liste de départ des motifs de nettoyage renvoyée à ce spec)

## Architecture approach

- **Deux fonctions pures sans IO** dans `matching.py` : `build_query` et `classify`. Elles ne connaissent ni le réseau, ni les fichiers, ni le protocole : `build_query` reçoit des chaînes, `classify` reçoit des `TrackCandidate`. Tout se teste en unitaire, sans fixture (`.claude/rules/pytest/tests.md`).
- **Règles reprises de la CLI d'origine** (dépôt `BeatportScrapper-TrackTagger`, `scrappers/track_matcher.py`, `utils/utils.py`, `managers/metadata_manager.py`, lus le 2026-09-19) :
  - un `;` dans l'artiste devient `", "` ;
  - l'artiste du candidat est `artists[]` joint par `", "`, remixeurs exclus ;
  - ~~le titre du candidat est comparé sous la forme « titre (mix_name) »~~ et ~~le titre de la requête reçoit « (Original Mix) » s'il n'en porte pas~~ : ces deux règles de la CLI sont **abandonnées le 2026-09-20**, titre et version étant désormais scorés séparément (voir plus bas). La requête envoyée à l'API reste le titre nettoyé, comme avant ;
  - `ratio` pour le titre, la règle de choix du scorer artiste ayant été remplacée le 2026-09-20 (voir plus bas) ;
  - un candidat sans `remix` dans son titre complet est écarté quand le titre de la requête en contient un ;
  - plancher en ET sur les deux scores, score retenu égal à leur moyenne, égalité départagée par l'ordre rendu par l'API.
- **Titre et version scorés séparément, jamais concaténés** (décision du 2026-09-20, remplace la règle du suffixe « (Original Mix) » héritée de la CLI). Des deux côtés, le titre est séparé de sa mention de version : Beatport la porte dans `mix_name`, Bandcamp l'écrit dans le titre et ne rend jamais de `mix_name` (ADR-011), la séparation traite donc les deux. Le score titre compare les titres nus, la version se compare à part.
  - **Pourquoi la concaténation a été abandonnée** : mesuré sur l'API en production le 2026-09-20, coller « (Original Mix) » des deux côtés fait passer « Your Mind » contre « Waypoint » de 47,1 à 80,0. Douze caractères identiques offerts pèsent d'autant plus que le titre est court. Le candidat franchissait alors le plancher, et avec un artiste identique à 100 la moyenne tombait sur exactement 90,0 : « Waypoint » était validé en automatique pour « Your Mind », au rang 85 de la page de résultats. Une écriture de tags faux et silencieuse, ce que ce spec place au-dessus de tout échec. Mêmes ordres de grandeur sur « Basiel » contre « Sirius » (33,3 → 80,0) et « Daydream » contre « Nightmare » (35,3 → 75,6).
  - **`version_mismatch`** remplace `via_bare_title` et porte la même règle sur un mécanisme plus simple : un candidat dont la version diffère de celle demandée, ou qui en porte une quand la requête est muette, reste en jeu mais ne peut pas valider en auto. « Original Mix » vaut absence de version, un tag l'omettant presque toujours. Une sortie publiée en Extended seul part donc en zone grise, où l'utilisateur confirme, ce que la décision du 2026-09-19 visait déjà.
  - **Deux libellés de version se comparent par `ratio` avec leur propre plancher** (`_VERSION_MATCH_FLOOR`, 70), distinct des seuils de matching : « Extended Mix » doit reconnaître « Extended », mais pas « Radio Edit ».
- **Score artiste par inclusion, et non par comparaison de deux listes jointes** (décision du 2026-09-20). Chaque artiste de la requête est comparé à tous les crédits du candidat, on garde son meilleur score, et le score artiste est le plus faible de ces meilleurs scores : un artiste demandé qui manque au candidat est un désaccord que la présence des autres ne rachète pas.
  - **Pourquoi la comparaison des listes jointes a été abandonnée** : mesuré sur l'API le 2026-09-20, « Adam Beyer » contre « Adam Beyer, Bart Skils, HNTR » rend 52,6 en `ratio` et 55,6 en `token_sort_ratio`, sous le plancher dans les deux cas. « Your Mind (HNTR Remix) », dont le titre matchait pourtant à 100, partait en « rien trouvé ». Un tag ne nomme souvent qu'un artiste là où la source les crédite tous, et la différence de longueur écrasait le score.
  - **Le choix entre `ratio` et `token_sort_ratio` disparaît** : comparer les artistes un à un rend l'ordre des crédits sans effet, ce que `token_sort_ratio` servait à obtenir.
- **Validation automatique désactivable** : `classify` accepte `allow_auto=False`, qui classe en zone grise tous les candidats en jeu, même au-dessus du seuil haut. Le pipeline s'en sert pour Bandcamp quand Beatport était injoignable (sub-project 06).
- **`processor=utils.default_process` sur tous les appels de scoring**, sans exception (`.claude/rules/rapidfuzz/matching.md`) : la CLI minusculait à la main sous fuzzywuzzy, rapidfuzz 3 ne préprocesse plus rien.
- **Normalisation des séparateurs d'artistes** côté requête, avant scoring (décision du 2026-09-19, **corrigée le 2026-09-20**) : `;`, `/`, et entourés d'espaces `and`, `x`, `X`, `×`, `vs`, `vs.`, `feat.`, `ft.`, `featuring`, deviennent `", "`. Seules les formes entourées d'espaces comptent, sauf `;` et `/`, pour ne jamais couper un nom (« Jax Jones », « Jay-Z »). **`&` n'est pas un séparateur** : il appartient au nom du duo, « Pig & Dan » et « Hicky & Kalo » ne sont jamais « Pig, Dan » ni « Hicky, Kalo ». Beatport ne joint d'ailleurs jamais deux crédits par une esperluette, il les liste dans `artists[]`. La liste du 2026-09-19 incluait `&` à tort, relevé le 2026-09-20 quand « Hernan Cattaneo, Hicky & Kalo » a fait rater son morceau. La virgule sépare ensuite les artistes que le score compare un à un, ce qui rend leur ordre sans effet. Beatport traitant le featuring comme un artiste à part entière, « Adam Beyer feat. Roisin Murphy » devient « Adam Beyer, Roisin Murphy ». La normalisation ne touche que l'artiste : dans le titre, `feat.` reste protégé par la garde.
- **Nettoyage sur le contenu, pas sur le délimiteur** (ARCHITECTURE.md § Use-case 2), appliqué à la chaîne interrogée et jamais aux tags écrits. Les motifs sont compilés une fois au niveau du module, en raw strings (`.claude/rules/python/stdlib-donnees.md`) :
  - mentions de téléchargement, retirées où qu'elles soient : `free dl`, `free download` (espace, tiret ou tiret bas entre les deux) ;
  - marqueurs d'encodage, retirés comme mots entiers : `NNNkbps` (2 ou 3 chiffres), `320`, `flac`, `wav`, `mp3` ;
  - groupes libres : tout groupe `[...]` ou `(...)` qui ne contient aucun mot de garde est retiré, ce qui couvre les labels (`[Drumcode]`) et les genres (`[HARD TECHNO]`) sans en tenir la liste (décision du 2026-09-19) ;
  - espaces multiples réduits, séparateurs orphelins en bord de chaîne retirés.
- **Garde de version et de collaboration** : un groupe n'est jamais retiré s'il contient, comme mot entier et sans tenir compte de la casse, `mix`, `remix`, `edit`, `version`, `dub`, `extended`, `radio`, `rework`, `bootleg`, `vip`, `live`, `instrumental`, `acapella`, `reprise`, `re-edit`, `remaster`, `tool`, `loop`, `intro`, `outro`, ou `feat.`, `ft.`, `featuring`, `with`, `pres.`, `vs.`. La liste d'ARCHITECTURE.md est étendue de `rework` à `remaster` (décision du 2026-09-19) : sans eux, « Your Mind (Rework) » deviendrait « Your Mind » et validerait l'original. Étendue une seconde fois le 2026-09-20 de `tool` à `outro`, et aux formes suffixées en `-ed` et `-s` des seules mentions de version (décision suivante).
- **Un mot de garde soudé par un trait d'union reste reconnu** : la frontière du motif traite le tiret comme une limite de mot, `vip` et `mix` sont donc tous deux vus dans « (VIP-Mix) ». Relevé par la revue de fin d'implémentation, qui a mesuré le 2026-09-20 que « Your Mind (VIP-Mix) » perdait sa version au nettoyage puis validait l'Original Mix en auto à 100.
- **Un titre dont la version est entre crochets porte bien une version** : `_lacks_version` regarde les deux familles de délimiteurs, sans quoi « Your Mind [Extended Mix] » recevait le suffixe « (Original Mix) » et tombait en zone grise au lieu de valider. Après nettoyage, un groupe qui a survécu contient forcément une mention gardée, quel que soit son délimiteur.
- **Le `mix_name` d'un candidat se cherche dans son titre sans tenir compte de la casse** : une source qui écrit « (extended mix) » dans le titre et « Extended Mix » dans le champ se verrait sinon coller la version une seconde fois, ce qui dégrade le score d'un candidat pourtant juste.
- **Requête depuis les tags d'abord** : artiste seulement normalisé, titre nettoyé. **Le nom d'artiste n'est jamais nettoyé** (décision du 2026-09-20) : un groupe y désigne l'artiste au lieu de le polluer, « SOSA (UK) » et « Doriann (IL) » étant leurs noms complets, ceux que la source crédite. Le nettoyage aurait fallu l'appliquer des deux côtés pour rester symétrique, alors que ne pas nettoyer du tout donne le même résultat sans code. Un champ que le nettoyage vide reprend sa valeur brute, une requête bruitée valant mieux qu'une requête vide (ARCHITECTURE.md § Requête vide après nettoyage, point 1). Les tags ne servent que si l'artiste et le titre contiennent chacun au moins une lettre.
- **Repli sur le nom de fichier**, dans cet ordre :
  1. extension retirée ;
  2. `_` remplacés par des espaces quand le nom n'en contient aucun (CLI) ;
  3. numéro de piste en tête retiré : 1 ou 2 chiffres non suivis d'un chiffre, puis un séparateur (`01 - `, `05 `, `10-`), ce qui laisse intacts « 999999999 » et « 808 State » ;
  4. nettoyage ;
  5. découpe sur le premier « - » entouré d'espaces en artiste et titre (décision du 2026-09-19). Sans ce séparateur, tout part en titre et l'artiste reste vide.
- **`empty_query`** : un nom de fichier qui ne contient plus aucune lettre après nettoyage donne `None`, sans appel réseau (point 2 du même paragraphe). C'est le seul chemin vers un non résolu sans interrogation de source.
- **Requête sans artiste** : l'artiste n'est pas scoré, plancher et seuil haut portent sur le seul score titre.
- **Pas de `score_cutoff` ni d'`extractOne`** (écart assumé à `.claude/rules/rapidfuzz/matching.md`) : ces outils comparent une chaîne à une liste sur un seul axe. Ici chaque candidat porte deux scores, artiste et titre, et le plancher s'applique en ET sur les deux, ce que la même rule illustre par ailleurs. Le filtrage se fait donc après calcul, sur une liste de quelques dizaines de candidats au plus, sans coût mesurable.
- **Classement** : chaque candidat qui passe la garde remix est scoré. Ceux dont les deux scores atteignent le plancher sont « en jeu ».
  - `AUTO` : le meilleur candidat en jeu qui n'est pas `version_mismatch` atteint le seuil haut (`>=`, comme la rule rapidfuzz, là où la CLI exigeait `>`). Le candidat retenu est le seul rendu.
  - `GREY_ZONE` : des candidats en jeu, aucun ne validant en auto, tous rendus du meilleur au moins bon, l'ordre de l'API départageant les égalités. La Feature 3 les affiche tels quels.
  - `EMPTY` : aucun candidat en jeu.
  - `Classification.scored` garde le score de chaque candidat scoré, pour le rapport et le recalibrage des seuils. Le pipeline en déduit `no_result` (aucun candidat reçu) ou `below_threshold` (des candidats, aucun en jeu).
- **Seuils** : `MatchingThresholds(floor=70, ceiling=90)`, seule source des défauts, avec l'invariant `0 <= floor <= ceiling <= 100` vérifié à la construction. Les défauts viennent de la CLI et sont à recalibrer (ADR-008). Les seuils arrivent par `start_tagging` (sub-project 07) et seront réglables dans les Settings (Feature 7).
- **Scores en flottants**, tels que rapidfuzz les rend : l'arrondi pour l'affichage (« A 96 · T 92 ») relève du protocole et de l'interface.
- **Modèles internes en dataclasses gelées, `StrEnum` annotés `@verify(UNIQUE)`** : `QueryOrigin` (`tags`, `filename`), `TrackQuery`, `MatchingThresholds`, `ScoredCandidate`, `Outcome` (`auto`, `grey_zone`, `empty`), `Classification` (`.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/type-hints.md`). Le traitement de l'issue par le pipeline se ferme par `assert_never` (`.claude/rules/python/pattern-matching.md`).

## Acceptance criteria

### Scénario 1 : Requête depuis des tags propres
**GIVEN** un fichier tagué « Adam Beyer » / « Your Mind »
**WHEN** sa requête est construite
**THEN** elle vaut « Adam Beyer Your Mind », d'origine `tags`

### Scénario 2 : Bruit retiré, version préservée
**GIVEN** un titre « Your Mind (Bart Skils Remix) [FREE DL] [Drumcode] (320kbps) »
**WHEN** sa requête est construite
**THEN** le titre devient « Your Mind (Bart Skils Remix) »

### Scénario 3 : Garde étendue
**GIVEN** un titre « Your Mind (Rework) [Techno] »
**WHEN** sa requête est construite
**THEN** le titre devient « Your Mind (Rework) »

### Scénario 4 : Séparateurs d'artistes normalisés
**GIVEN** un artiste « Farrago x Amelie Lens »
**WHEN** il est scoré contre le candidat « Amelie Lens, Farrago »
**THEN** l'artiste de la requête vaut « Farrago, Amelie Lens »
**AND** le score artiste vaut 100

### Scénario 5 : Repli sur le nom de fichier
**GIVEN** un fichier sans tags nommé `05 reinier zonneveld - move your body (320kbps).mp3`
**WHEN** sa requête est construite
**THEN** l'artiste vaut « reinier zonneveld », le titre « move your body », d'origine `filename`

### Scénario 6 : Fichier réduit à du bruit
**GIVEN** un fichier sans tags nommé `01 - [FREE DL].mp3`
**WHEN** sa requête est construite
**THEN** aucune requête n'est rendue

### Scénario 7 : Validation automatique
**GIVEN** la requête « Adam Beyer » / « Your Mind » et le candidat « Adam Beyer » / « Your Mind » / « Original Mix »
**WHEN** les candidats sont classés avec les seuils par défaut
**THEN** l'issue est `AUTO` et ce candidat est retenu

### Scénario 8 : Zone grise
**GIVEN** la requête « Adam Beyer » / « Your Mind » et les seuls candidats « Your Mind (Extended Mix) » et « Your Mind (Radio Edit) » d'Adam Beyer
**WHEN** les candidats sont classés
**THEN** l'issue est `GREY_ZONE`, les deux candidats sont en jeu par leur titre nu
**AND** aucun n'est validé en auto malgré un score de 100

### Scénario 9 : Rien au-dessus du plancher
**GIVEN** la requête « Adam Beyer » / « Your Mind » et un candidat d'un autre artiste au titre voisin
**WHEN** les candidats sont classés
**THEN** l'issue est `EMPTY`
**AND** le candidat figure dans `scored` avec ses deux scores

### Scénario 10 : Garde remix
**GIVEN** la requête « Your Mind (Bart Skils Remix) » et un candidat sans remix au score parfait sur l'artiste
**WHEN** les candidats sont classés
**THEN** ce candidat est écarté avant scoring

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_matching_query.py` :
  - builds the query from clean tags
  - removes download mentions whatever their delimiter (paramétré : `[FREE DL]`, `(Free Download)`, `free_dl` en fin de chaîne)
  - removes encoding markers as whole words (paramétré)
  - removes a free group such as a label or a genre
  - keeps a group holding a version mention (paramétré sur chaque mot de garde)
  - keeps a group holding a collaboration mention (paramétré)
  - normalises artist separators to a comma (paramétré sur chaque forme)
  - never splits a name that contains a separator without spaces (`Jay-Z`, `Jax Jones`)
  - falls back on the raw tag when cleaning empties it
  - falls back on the file name when a tag has no letter
  - replaces underscores in a file name without spaces
  - strips a leading track number but not a numeric artist
  - splits the file name on the first spaced dash
  - puts the whole file name in the title without a spaced dash
  - returns no query for a file name reduced to noise
- `sidecar/tests/unit/test_matching_scoring.py` :
  - compares the candidate title with its mix name
  - adds original mix to a query title without version
  - keeps a candidate matched on its bare title in the grey zone
  - validates the original mix automatically when an extended mix is also offered
  - compares a candidate without mix name to the query title without suffix
  - never validates automatically when auto is not allowed
  - joins candidate artists without remixers
  - uses token sort ratio for several artists and ratio otherwise
  - drops a candidate without remix when the query holds one
  - rejects a candidate below the floor on either score
  - validates automatically at the ceiling and not below it
  - returns grey zone candidates sorted by score
  - keeps the first candidate on a tie
  - scores the title only for a query without artist
  - records every scored candidate
  - rejects inconsistent thresholds

Aucun test ne vérifie rapidfuzz lui-même : les scores attendus sont des bornes (100, sous le plancher, au-dessus du seuil) qui échouent contre une régression de nos chaînes comparées, de notre choix de scorer ou de nos seuils.

## Edge cases

- **Artiste numérique d'un ou deux chiffres en tête d'un nom de fichier** (« 2 Unlimited - No Limit ») : le « 2 » est pris pour un numéro de piste et retiré. Cas accepté, les tags couvrent ces morceaux dans l'immense majorité des cas.
- **« Above & Beyond »**, comme « Pig & Dan » ou « Hicky & Kalo » : reste un seul artiste, comparé tel quel au crédit de la source, qui l'écrit pareil.
- **Titre de tag fait de bruit seul** (« [FREE DL] ») avec un artiste exploitable : le titre reprend sa valeur brute, la requête part bruitée plutôt que vide.
- **Candidat sans artiste** : chaîne artiste vide, score artiste nul, écarté par le plancher.
- **Requête « Your Mind » face à l'Original et à l'Extended** : l'Original Mix atteint 100 par le titre complet et valide en auto. L'Extended ne l'atteint que par son titre nu et ne compte pas pour l'auto.
- **Candidat Bandcamp dont le titre contient déjà l'artiste** : mesuré sur l'API en production le 2026-09-20, Bandcamp rend « Charlotte de Witte - Sgadi Li Mi (Andreo Edit) » comme `title` d'un candidat dont le seul artiste est « Andreo », et « Adam Beyer & Bart Skils - Your Mind (Golpe ReWork) » pour l'artiste « Golpe ». Ce sont des edits non officiels réuploadés. Le titre de la requête se compare au titre brut du candidat, donc ces candidats tombent sous le plancher : c'est le comportement voulu, l'edit d'un tiers n'étant pas le morceau cherché.
- **Pertinence de la source utile en tête, insuffisante pour présélectionner** : mesuré le 2026-09-20 sur six recherches, Beatport place le bon morceau dans ses trois premiers résultats cinq fois sur six, mais « Amelie Lens Basiel » y place « David Temessi - Lens Of Amelie » en deuxième, et surtout « Adam Beyer Your Mind (Bart Skils Remix) » ne rend le remix cherché dans aucun des trois premiers. Le classement de la source oriente donc, sans suffire : le scoring reste ce qui décide, et le rang du candidat retenu dans la page est à mesurer avant d'envisager de tronquer celle-ci (sujet du sub-project 06, pas de celui-ci).
- **Esperluette lue dans les deux sens** : « A & B » désigne un duo (« Pig & Dan ») ou deux artistes joints par un logiciel de tag, et la chaîne seule ne le dit pas. Les deux lectures sont donc présentées au candidat, la comparaison nom par nom portant la première et la comparaison des listes entières la seconde, le meilleur score l'emportant. C'est la façon dont la source crédite qui tranche, jamais une règle devinée. Mesuré le 2026-09-20 : « Pig & Dan » contre un crédit unique rend 100, « Adam Beyer & Bart Skils » contre deux crédits séparés rend 97,8.
- **Artistes joints par une esperluette ET dans l'ordre inverse** (« Bart Skils & Adam Beyer » face à des crédits « Adam Beyer, Bart Skils ») : les deux lectures échouent, 44,4 mesuré, et le morceau part en arbitrage. `token_sort_ratio` le rattraperait, au prix de faire passer « Beyer Adam » pour « Adam Beyer », un nom aux mots intervertis restant un nom différent. Cas accepté, il cumule deux écarts au même endroit.
- **Le nom d'artiste garde ses parenthèses, perd ses crochets et son bruit** : mesuré le 2026-09-20 sur 963 crédits Beatport, les 22 noms à parenthèses portent tous un code pays ou de genre (« SOSA (UK) », « Aeon (PSY) »), jamais un marqueur d'encodage. Une parenthèse désigne donc l'artiste et reste, tandis que les crochets et les motifs de bruit partent, un tag mal fait pouvant porter « Adam Beyer (320kbps) ».
- **Le featuring que la source écrit dans le titre est ignoré à la comparaison** : Beatport rend « Biome feat. BCCO » tout en créditant BCCO dans `artists[]`, là où un tag de fichier ne le met qu'au champ artiste. Le titre se coupe donc à sa mention d'invité, des deux côtés, ce que l'axe artiste score déjà ne devant ni aider ni pénaliser l'axe titre. La coupe ne vaut que pour la comparaison : la requête envoyée à l'API et les tags écrits gardent le titre entier.
- **Version écrite sans délimiteur** (« Track Name Extended Mix ») : non extraite, la séparation ne lisant que les groupes entre parenthèses ou crochets. Le titre se compare alors entier et peut tomber sous le plancher. La traiter demanderait de décider qu'un mot de garde en fin de titre est une version, ce qui couperait « Live Your Life ». Cas accepté, à reprendre sur des tags réels (sub-project 06).
- **Collaborateur absent des crédits** (« Charlotte de Witte & Amelie Lens » face à un candidat qui ne crédite que la première) : le score artiste atteint 72 par similarité brute, au-dessus du plancher, et le morceau part en zone grise au lieu d'être écarté. Retenu tel quel : la situation est ambiguë, et rejeter un morceau dont l'artiste principal correspond coûterait plus qu'un arbitrage.
- **Groupe imbriqué ou non fermé** (« Your Mind (Extended Mix »), « [Label (2023)] ») : seuls les groupes fermés et non imbriqués sont examinés, le reste de la chaîne est laissé tel quel.

## Architectural decisions

### Décision : Nettoyage des groupes entre crochets ou parenthèses

**Options envisagées :**
- **A. Retirer tout groupe sans mot de garde** : couvre labels et genres sans en tenir la liste, au prix d'une garde qui doit connaître toutes les mentions de version.
- **B. Ne retirer que des motifs de contenu listés** : aucun risque de retirer une version inconnue, mais un label entre crochets pollue la requête jusqu'au premier run réel.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19. Les noms de labels sont impossibles à énumérer.
- Le risque de A est porté par la garde, étendue pour la même raison (décision suivante).

### Décision : Extension de la garde de version

**Options envisagées :**
- **A. Étendre la liste d'ARCHITECTURE.md** de `rework`, `bootleg`, `vip`, `live`, `instrumental`, `acapella`, `reprise`, `re-edit`, `remaster`.
- **B. Garder la liste d'origine** : un « (Rework) » est retiré et la requête valide l'original.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19, rendue nécessaire par le retrait des groupes libres.
- Une version retirée de la requête produit une validation fausse qui ne se voit pas, pire qu'un échec.

### Décision : Seconde extension de la garde, aux outils de DJ et aux formes suffixées

**Options envisagées :**
- **A. Ajouter `tool`, `loop`, `intro`, `outro`, et accepter les suffixes `-ed` et `-s`** sur les seules mentions de version.
- **B. N'ajouter que `tool`**, le seul cas dont une source contemporaine atteste.
- **C. Ne rien ajouter** et recalibrer la liste au premier run réel, comme les seuils.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-20, après recherche sur sources primaires plutôt que sur intuition.
- `tool` est le trou le plus concret : « The Techno Code (DJ Tool) » d'Enrico Sangiuliano (NINETOZERO, 2025), et Beatport tient une catégorie « DJ Tools / Acapellas » entière. Aucun de ces titres ne contient `mix` ni `edit` : la garde d'avant les vidait, et un outil de DJ validait alors l'Original Mix.
- **Vérifié en interrogeant l'API en production le 2026-09-20**, et non par la seule documentation : une recherche « Enrico Sangiuliano The Techno Code » rend « The Techno Code (DJ Tool) » en troisième position sur Beatport et en deuxième sur Bandcamp, et une recherche « Charlotte de Witte Sgadi Li Mi » rend « Sgadi Li Mi (Intro) » en deuxième position sur Beatport. `tool` et `intro` sont donc des mentions vivantes du catalogue cible, pas des cas de bord théoriques. La même campagne a relevé « Your Mind (Golpe ReWork) » sur Bandcamp, qui confirme `rework`.
- Les formes suffixées sont rares mais gratuites. La recherche du 2026-09-20 les a trouvées presque toujours en composé déjà gardé (« Remastered Original Mix », « Slipmatt Remix Remastered », « Reworked Mix », « Edited Version »), et isolées seulement sur des rééditions de catalogue ancien (STL, John B sur Metalheadz, Coil). « Remixed » n'existe pas comme `mix_name` de piste, uniquement comme titre de compilation. MusicBrainz, Discogs et le guide de livraison Beatport imposent tous la forme nominale.
- L'erreur est asymétrique, et c'est ce qui tranche : un mot de garde en trop laisse passer un groupe, donc une requête bruitée qui se score quand même ; un mot manquant fait écrire les mauvais tags sans aucun signal.
- Les suffixes ne s'appliquent qu'aux mentions de version, jamais aux mentions de collaboration : « feated » n'existe pas.

### Décision : Découpe artiste et titre d'un nom de fichier

**Options envisagées :**
- **A. Premier « - » entouré d'espaces, sinon tout en titre** : « Jay-Z - Title » reste juste, et un nom sans séparateur ne plante plus.
- **B. Premier « - » quel qu'il soit, comme la CLI** : couvre « artiste-titre » collé, mais coupe « Jay-Z », et la CLI plantait sans tiret.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19.
- Un nom collé « artiste-titre » part en titre seul et se score sur le titre, ce qui reste un chemin de résolution.

### Décision : Requête sans version face à un candidat qui en porte une

**Options envisagées :**
- **A. Comparer aussi le titre nu, sans auto sur ce chemin** : un Extended seul part en zone grise, l'utilisateur confirme la version.
- **B. Comparer aussi le titre nu, auto autorisé** : un Extended seul est validé sans confirmation, l'Original préféré à égalité.
- **C. Garder la règle de la CLI** : un Extended seul tombe sous le plancher et part en « rien trouvé ».

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19, après mesure : la règle de la CLI place Extended et Radio Edit sous le plancher.
- Le fichier ne dit pas quelle version il contient : seule une validation humaine peut la trancher, une validation automatique pourrait écrire la mauvaise.

### Décision : Frontière du seuil haut

**Options envisagées :**
- **A. `>=` seuil haut** : conforme à la rule rapidfuzz et à `knowledges/rapidfuzz.md`.
- **B. `>` seuil haut, comme la CLI** : un score de 90 exactement part en zone grise.

**Choix : A**

**Rationale :**
- Les docs du projet sont la référence de ses décisions, la CLI n'est que l'origine des valeurs.
- L'écart ne porte que sur un score exactement égal au seuil, et le seuil lui-même est à recalibrer.
