---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "requete-et-scoring"
goal: "Construire la requête d'un morceau puis classer les candidats d'une source en auto, zone grise ou vide selon les seuils de matching"
status: "draft"
complexity: "L"
tdd_scope: "full"
depends_on: ["02-client-techno-scraper-design.md"]
date: "2026-09-19"
---

# Construction de la requête et classement des candidats

## Scope

Couvre les deux fonctions pures du matching. La première construit la requête d'un morceau depuis ses tags artiste et titre, avec repli sur le nom de fichier. Elle nettoie la chaîne sous ses gardes de version et de collaboration, normalise les séparateurs d'artistes, reprend la valeur brute quand le nettoyage vide un tag et signale `empty_query` quand rien n'est exploitable. La seconde score les candidats d'une source (artiste et titre séparés, `ratio` ou `token_sort_ratio`), écarte les candidats sans remix quand la requête en porte un et classe le morceau en auto, zone grise ou vide selon le plancher et le seuil haut. Couvre aussi l'extension de la garde de version dans ARCHITECTURE.md.

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
  - le titre du candidat est comparé sous la forme « titre (mix_name) », sauf si le mix figure déjà dans le titre ;
  - le titre de la requête reçoit « (Original Mix) » s'il ne contient ni `remix` ni parenthèse, pour le scoring seulement : la requête envoyée à l'API reste le titre nettoyé ;
  - `token_sort_ratio` pour un artiste de requête qui contient `,` ou `&`, `ratio` sinon, `ratio` pour le titre ;
  - un candidat sans `remix` dans son titre complet est écarté quand le titre de la requête en contient un ;
  - plancher en ET sur les deux scores, score retenu égal à leur moyenne, égalité départagée par l'ordre rendu par l'API.
- **Titre nu, pour une requête sans version** (décision du 2026-09-19, écart assumé à la CLI) : quand le titre de la requête a reçu « (Original Mix) », il est aussi comparé, sans ce suffixe, au titre nu du candidat, et le meilleur des deux scores titre est retenu. Un candidat qui ne doit son score qu'au titre nu (`via_bare_title`) ne peut pas valider en auto, il reste en zone grise. Mesuré le 2026-09-19 : « Your Mind (Original Mix) » contre « Your Mind (Extended Mix) » donne 69,6, contre « Your Mind (Radio Edit) » 68,2, sous le plancher. La règle de la CLI seule écarterait une sortie publiée uniquement en Extended.
- **Suffixe et titre nu réservés aux candidats qui portent un `mix_name`** : Beatport sépare toujours la version du titre, Bandcamp jamais, ses artistes l'écrivant dans le titre lui-même (ADR-011). Un candidat sans `mix_name` se compare directement au titre de la requête, sans suffixe, et ne passe jamais par `via_bare_title`. Sans cette règle, relevée le 2026-09-19 en écrivant le pipeline, « Your Mind » contre un candidat Bandcamp « Your Mind » ne validerait jamais en auto.
- **Validation automatique désactivable** : `classify` accepte `allow_auto=False`, qui classe en zone grise tous les candidats en jeu, même au-dessus du seuil haut. Le pipeline s'en sert pour Bandcamp quand Beatport était injoignable (sub-project 06).
- **`processor=utils.default_process` sur tous les appels de scoring**, sans exception (`.claude/rules/rapidfuzz/matching.md`) : la CLI minusculait à la main sous fuzzywuzzy, rapidfuzz 3 ne préprocesse plus rien.
- **Normalisation des séparateurs d'artistes** côté requête, avant scoring (décision du 2026-09-19) : `;`, `/`, et entourés d'espaces `&`, `and`, `x`, `X`, `×`, `vs`, `vs.`, `feat.`, `ft.`, `featuring`, deviennent `", "`. Seules les formes entourées d'espaces comptent, sauf `;` et `/`, pour ne jamais couper un nom (« Jax Jones », « Jay-Z »). La virgule fait ensuite basculer sur `token_sort_ratio`, qui ignore l'ordre des artistes. Beatport traitant le featuring comme un artiste à part entière, « Adam Beyer feat. Roisin Murphy » devient « Adam Beyer, Roisin Murphy ». La normalisation ne touche que l'artiste : dans le titre, `feat.` reste protégé par la garde.
- **Nettoyage sur le contenu, pas sur le délimiteur** (ARCHITECTURE.md § Use-case 2), appliqué à la chaîne interrogée et jamais aux tags écrits. Les motifs sont compilés une fois au niveau du module, en raw strings (`.claude/rules/python/stdlib-donnees.md`) :
  - mentions de téléchargement, retirées où qu'elles soient : `free dl`, `free download` (espace, tiret ou tiret bas entre les deux) ;
  - marqueurs d'encodage, retirés comme mots entiers : `NNNkbps` (2 ou 3 chiffres), `320`, `flac`, `wav`, `mp3` ;
  - groupes libres : tout groupe `[...]` ou `(...)` qui ne contient aucun mot de garde est retiré, ce qui couvre les labels (`[Drumcode]`) et les genres (`[HARD TECHNO]`) sans en tenir la liste (décision du 2026-09-19) ;
  - espaces multiples réduits, séparateurs orphelins en bord de chaîne retirés.
- **Garde de version et de collaboration** : un groupe n'est jamais retiré s'il contient, comme mot entier et sans tenir compte de la casse, `mix`, `remix`, `edit`, `version`, `dub`, `extended`, `radio`, `rework`, `bootleg`, `vip`, `live`, `instrumental`, `acapella`, `reprise`, `re-edit`, `remaster`, ou `feat.`, `ft.`, `featuring`, `with`, `pres.`, `vs.`. La liste d'ARCHITECTURE.md est étendue de `rework` à `remaster` (décision du 2026-09-19) : sans eux, « Your Mind (Rework) » deviendrait « Your Mind » et validerait l'original.
- **Requête depuis les tags d'abord** : artiste normalisé puis nettoyé, titre nettoyé. Un champ que le nettoyage vide reprend sa valeur brute, une requête bruitée valant mieux qu'une requête vide (ARCHITECTURE.md § Requête vide après nettoyage, point 1). Les tags ne servent que si l'artiste et le titre contiennent chacun au moins une lettre.
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
  - `AUTO` : le meilleur candidat en jeu qui n'est pas `via_bare_title` atteint le seuil haut (`>=`, comme la rule rapidfuzz, là où la CLI exigeait `>`). Le candidat retenu est le seul rendu.
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
- **« Above & Beyond »** : normalisé en « Above, Beyond », il reste à 100 contre le candidat « Above & Beyond » par `token_sort_ratio`, `default_process` retirant l'esperluette.
- **Titre de tag fait de bruit seul** (« [FREE DL] ») avec un artiste exploitable : le titre reprend sa valeur brute, la requête part bruitée plutôt que vide.
- **Candidat sans artiste** : chaîne artiste vide, score artiste nul, écarté par le plancher.
- **Requête « Your Mind » face à l'Original et à l'Extended** : l'Original Mix atteint 100 par le titre complet et valide en auto. L'Extended ne l'atteint que par son titre nu et ne compte pas pour l'auto.
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
