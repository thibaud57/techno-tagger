---
feature: "Feature 4 — Rattrapage par URL manuelle"
subproject: "rattrapage-url-sidecar"
goal: "Résoudre dans le sidecar, à partir d'une URL collée, un morceau resté sans correspondance à la fin d'un run, et le faire passer en résolu par URL"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: ["01-client-resolution-url-design.md"]
date: "2026-10-02"
---

# Rattrapage par URL dans le run vivant

## Scope

Couvre le geste de rattrapage sur le run vivant (`LiveRun`) : éligibilité du morceau, un seul geste en vol par morceau, résolution de l'URL par le client et la garde des 403 du run, pochette, passage en `resolved · url` sans score, et le décompte « rattrapés sur à rattraper » de la phase `url_recovery`. Un échec laisse le morceau tel qu'il était.

Exclut la commande `resolve_by_url`, son câblage dans `CurrentRun`, le refus d'un geste pendant la phase réseau et le moment où la progression est émise (sub-project 03), toute interface (sub-projects 04 et 05) et la persistance de la décision dans le plan de run (Feature 6).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer une suite qui, sur un run ouvert après sa phase réseau avec l'API simulée, fait passer un morceau non résolu en `resolved · url` avec sa pochette, remplace une URL déjà collée, refuse un morceau résolu autrement, en arbitrage ou non traité, refuse un second geste en vol, laisse le morceau intact quand l'URL échoue, et rend la progression « rattrapés sur à rattraper » à chaque étape.

## Dependencies

- `01-client-resolution-url-design.md` (statut: draft) : `TechnoScraperClient.fetch_by_url`, `UnsupportedTrackUrlError` et les formes d'URL acceptées.

## Files touched

- **À créer** : `sidecar/src/tagger/url_recovery.py` (`UrlRecovery`, `UrlProgress`, `UrlRecoveryEvent`, erreurs `UrlRecovery*`)
- **À modifier** : `sidecar/src/tagger/sources.py` (`RunSources.from_url`)
- **À modifier** : `sidecar/src/tagger/tagging.py` (`TrackRecord.resolved` accepte `scored=None` et efface le motif d'échec)
- **À créer** : `sidecar/tests/unit/test_url_recovery.py` (gestes, éligibilité, échecs, progression)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.url_recovery_error`, `errors.url_recovery_not_eligible`, `errors.url_recovery_busy`, exigés par `test_error_translations.py`)
- **À modifier** : `docs/ARCHITECTURE.md` (use-case 4 : morceaux éligibles et progression ; § Concurrence : un geste URL en vol par morceau)

## Architecture approach

- **Une unité par famille de gestes**, sur le patron d'`arbitration.py` (spec `arbitrage-utilisateur/01-file-arbitrage-sidecar-design.md`, décision « Organisation du code ») : `url_recovery.py` dépend de `tagging.py` et de `sources.py`, jamais l'inverse. `UrlRecovery(live, sources, on_event)` reçoit le run vivant, l'accès aux sources du run et le rappel d'événements. Le sub-project 03 l'instancie à côté d'`Arbitration` dans `CurrentRun`.
- **Surface publique** :
  - `async resolve(track_id, url)` : résout le morceau ou lève une erreur, sans jamais modifier le morceau en cas d'échec ;
  - `progress() -> UrlProgress` : décompte pur, calculé sur l'état courant du run, que le sub-project 03 émet à l'ouverture de la phase.
- **Éligibilité** (décision du propriétaire, 2026-10-02), vérifiée avant tout appel réseau : un morceau `unresolved`, ou déjà `resolved · url` (recoller remplace l'URL précédente). Un morceau inconnu du run, résolu en `auto` ou `arbitration`, en attente d'arbitrage (`arbitration` non nul) ou non traité d'un run interrompu (`state` nul) lève `UrlRecoveryNotEligibleError`. Un morceau qui devient `unresolved` après l'ouverture de la phase, par un refus d'arbitrage, devient éligible sans traitement particulier : l'éligibilité se lit au moment du geste.
- **Un seul geste en vol par morceau** : un second lève `UrlRecoveryBusyError`, jamais mis en file. Garde synchrone par ensemble de `track_id` et context manager libéré en `finally`, annulation comprise (`.claude/rules/python/asyncio.md`). La garde est propre à `UrlRecovery` : un morceau éligible n'est jamais en arbitrage, les deux gestes ne se disputent donc jamais le même morceau.
- **Erreurs** (`.claude/rules/python/gestion-erreurs.md`) : base `UrlRecoveryError(TaggerError)`, code `url_recovery_error`, feuilles `UrlRecoveryNotEligibleError` (`url_recovery_not_eligible`) et `UrlRecoveryBusyError` (`url_recovery_busy`), chacune avec `track_id` en `params`, comme les erreurs `Arbitration*`. Les erreurs du client remontent sans changement : `unsupported_url`, `track_not_found`, `source_unavailable`, `api_key_rejected`, `api_contract_error`. C'est le sub-project 03 qui leur joint le `track_id` de la commande.
- **Accès réseau par `RunSources.from_url(position, url)`**, qui rend le candidat et sa pochette. L'appel `fetch_by_url` passe par `_call`, donc par la garde des 403 partagée du run et par la remontée Sentry d'un contrat cassé, comme la recherche et le refetch (`.claude/rules/techno-scraper/contrat.md`). Un `UnsupportedTrackUrlError` traverse `_call` sans toucher la garde : aucune requête n'est partie. La pochette passe par `_artwork` : son échec est logué et ne fait jamais échouer le morceau (ARCHITECTURE.md § Concurrence).
- **Morceau résolu par URL** : `TrackRecord.resolved(Resolution.URL, candidate.source, candidate, None, artwork)`. Le candidat n'a traversé aucun scoring : `resolved` accepte `scored=None`, que `handlers` traduit déjà en `scores` absent sur `track_resolved`. `resolved` efface aussi `failure_reason` : jusqu'ici seul un morceau en attente d'arbitrage, sans motif, passait en résolu, alors qu'un non résolu rattrapé garderait sinon son `no_result` à côté de `state: resolved`. L'état passe par `LiveRun.update` puis `TrackResolved` sur le rappel, comme `Arbitration._settle`.
- **Progression** (décision du propriétaire, 2026-10-02) : `UrlProgress(processed, total)`, calculé sur l'état du run, `total` = morceaux `unresolved` + morceaux `resolved · url`, `processed` = morceaux `resolved · url`. Un geste réussi émet `TrackResolved` puis `UrlProgress`. Un échec n'émet rien : la barre ne bouge que quand un morceau est rattrapé, une correction ne compte pas deux fois, un refus d'arbitrage tardif grossit le total au prochain calcul.
- **Événements** : `type UrlRecoveryEvent = TrackResolved | UrlProgress`, sur le modèle d'`ArbitrationEvent`. `UrlProgress` est une dataclass interne figée (`.claude/rules/python/modeles-donnees.md`), que le sub-project 03 traduit en `progress` de phase `url_recovery`.
- **Logs** en logfmt, clés fixes (`.claude/rules/python/gestion-erreurs.md`) : INFO sur un succès (`run`, `track` en position, `source`), WARNING sur un échec (`run`, `track`, `reason` = code de l'erreur, `request_id` quand l'API a répondu). Jamais l'URL ni le titre (ARCHITECTURE.md § Sécurité).
- **Rien n'est persisté** : la décision vit dans le run vivant jusqu'au run suivant, comme l'arbitrage. Le plan de run de la Feature 6 la reprendra (ADR-010).
- **Docs** : ARCHITECTURE.md se modifie avec le skill `architecture-doc`.
- **Qualité** : Ruff, Mypy strict (`.claude/rules/ruff/lint-format.md`, `.claude/rules/mypy/strict.md`), types selon `.claude/rules/python/type-hints.md`, tests selon `.claude/rules/pytest/tests.md`.

## Acceptance criteria

### Scénario 1 : Rattrapage d'un morceau non résolu
**GIVEN** un run terminé dont un morceau est `unresolved` (`no_result`) et une API qui rend un `Track` Bandcamp avec pochette pour l'URL collée
**WHEN** l'utilisateur rattrape ce morceau avec cette URL
**THEN** le morceau passe en `resolved`, `resolution` à `url`, `source` à `bandcamp`, sans score ni motif d'échec, avec sa pochette
**AND** le rappel reçoit `TrackResolved` puis `UrlProgress(processed=1, total=1)`

### Scénario 2 : Correction d'une URL déjà collée
**GIVEN** un morceau déjà `resolved · url` sur Bandcamp
**WHEN** l'utilisateur colle une URL Beatport sur ce morceau
**THEN** le morceau reste `resolved · url`, sur le candidat Beatport
**AND** la progression reste à 1 sur 1

### Scénario 3 : Morceau non éligible
**GIVEN** un run dont un morceau est résolu en `auto`, un autre en attente d'arbitrage et un troisième non traité
**WHEN** l'utilisateur tente un rattrapage sur chacun
**THEN** chaque geste lève `UrlRecoveryNotEligibleError` portant le `track_id`
**AND** aucune requête n'a été émise

### Scénario 4 : Second geste en vol
**GIVEN** un rattrapage en cours sur un morceau, son appel retenu par l'API
**WHEN** un second rattrapage arrive sur le même morceau
**THEN** il lève `UrlRecoveryBusyError`
**AND** le premier aboutit normalement une fois l'API libérée

### Scénario 5 : URL en échec
**GIVEN** un morceau `unresolved` (`no_result`) et une API qui rend `404` pour l'URL collée
**WHEN** l'utilisateur rattrape ce morceau
**THEN** `TrackNotFoundError` remonte
**AND** le morceau reste `unresolved`, motif `no_result`, et le rappel ne reçoit rien

### Scénario 6 : Progression qui suit le run
**GIVEN** un run terminé avec deux morceaux `unresolved` et un morceau en attente d'arbitrage
**WHEN** l'utilisateur rattrape un morceau, puis refuse l'arbitrage restant jusqu'au non-résolu, puis lit la progression
**THEN** la progression vaut 1 sur 2 après le rattrapage, puis 1 sur 3 après le refus

### Scénario 7 : Garde des 403 partagée
**GIVEN** une API qui rend `403` à chaque appel
**WHEN** trois rattrapages se suivent sur trois morceaux
**THEN** les deux premiers lèvent `ApiKeyRejectedError`, le troisième `ApiKeyRejectedRunError`, tous de code `api_key_rejected`

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_url_recovery.py` :
  - resolves an unresolved track by url with the fetched candidate and its artwork
  - emits the resolved track then the url progress
  - replaces a track already resolved by url
  - refuses a track that is not eligible without any request (paramétré : `auto`, `arbitration`, en attente d'arbitrage, non traité, inconnu ; `ids` en anglais)
  - refuses a second gesture in flight on the same track
  - keeps the track untouched and emits nothing when the url fails (paramétré : `unsupported_url`, `track_not_found`, `source_unavailable`)
  - keeps the previous url when a correction fails
  - resolves the track without artwork when the artwork download fails
  - counts recovered tracks over tracks to recover, a late arbitration refusal included
  - stops on the third consecutive api key rejection across gestures
  - releases the track when the gesture is cancelled
  - never logs the pasted url

`test_error_translations.py` couvre sans ajout les trois nouveaux codes. Aucun test ne vérifie httpx2, pydantic ni le client lui-même (sub-project 01) : chacun échoue contre une régression de notre éligibilité, de notre garde, de notre transition d'état ou de notre décompte.

## Edge cases

- **Même URL collée sur deux morceaux** : acceptée, chacun est rattrapé. Deux fichiers résolus vers le même morceau relèvent des doublons de l'écriture (ADR-020), pas du rattrapage.
- **Correction qui échoue** : le morceau garde sa résolution par URL précédente, la progression ne bouge pas.
- **Run remplacé pendant un geste** : le geste est annulé par la fermeture du run (sub-project 03), la garde libère le morceau, aucun événement ne sort.
- **Lien vers un profil SoundCloud** : `unsupported_url` venu du client, morceau intact.
- **Run sans morceau à rattraper** : `progress()` rend 0 sur 0, que l'interface présente comme une phase vide (sub-project 05).

## Architectural decisions

### Décision : Morceaux éligibles au rattrapage

**Options envisagées :**
- **A. Non résolus et résolus par URL** : recoller une URL corrige un mauvais lien avant l'écriture.
- **B. Non résolus seulement** : une URL collée par erreur ne se corrige plus.
- **C. A, plus les non traités d'un run interrompu** : l'URL devient une voie de saisie complète, y compris pour des morceaux jamais cherchés.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-10-02.
- Les morceaux résolus automatiquement ou par arbitrage ont une correspondance validée : les rouvrir ferait du rattrapage une édition générale, que le Post-MVP prévoit sous une autre forme (« Édition manuelle des tags »).

### Décision : Mesure de la progression

**Options envisagées :**
- **A. Rattrapés sur à rattraper**, calculé sur l'état du run : la barre dit combien de morceaux ont trouvé une source.
- **B. Tentés sur à rattraper** : un échec fait avancer la barre sans que le morceau soit rattrapé.
- **C. Pas de compteur de phase** : chaque ligne montre son chargement, écart à ARCHITECTURE.md qui prévoit un `progress` pour cette phase.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-10-02.
- Calculé et non compté : une correction ne compte pas deux fois, un refus d'arbitrage tardif entre dans le total sans compteur à tenir en phase avec l'arbitrage.

### Décision : Score d'un morceau résolu par URL

**Options envisagées :**
- **A. Aucun score** : `TrackRecord.resolved` accepte `scored=None`, `track_resolved` part sans `scores`.
- **B. Score fabriqué** (0 ou 100) : garde la signature de `resolved`, mais affiche un chiffre qu'aucune comparaison n'a produit.

**Choix : A**

**Rationale :**
- L'utilisateur a désigné le morceau lui-même : aucun score ne mesure cette décision, et un chiffre inventé fausserait la colonne Score comme le rapport.
- `handlers` traduit déjà un `scored` nul en `scores` absent : la seule modification est l'annotation de `resolved`.
