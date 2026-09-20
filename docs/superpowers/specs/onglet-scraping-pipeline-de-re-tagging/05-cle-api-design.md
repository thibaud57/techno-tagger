---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "cle-api"
goal: "Permettre à chaque utilisateur d'enregistrer une fois la clé API qui lui a été remise, rangée dans le trousseau Windows côté sidecar, pour que le pipeline puisse appeler techno-scraper"
status: "draft"
complexity: "M"
tdd_scope: "partial"
depends_on: []
date: "2026-09-19"
---

# Clé API : trousseau, commande `set_api_key` et section API des Settings

## Scope

Couvre le stockage de la clé `X-API-Key` dans le trousseau Windows côté sidecar (backend forcé `WinVaultKeyring`), la commande NDJSON `set_api_key` avec contrôle de format, un `api_key_configured` réel dans l'événement `version`, le miroir TypeScript, l'état de la clé dans le service sidecar et la section « API » de l'onglet Settings, réduite au champ de la clé. Couvre aussi le réalignement de la documentation sur l'URL de l'API figée en constante du sidecar (décision du 2026-09-19).

Exclut tout champ d'URL, les autres réglages (seuils, langue, signal sonore, cache, logs, rollback : Feature 7), la suppression de la clé, la vérification de la clé auprès de l'API (décision du 2026-09-19 : la garde des 403 du sub-project 06 s'en charge) et la lecture de la clé par le client techno-scraper (sub-project 06).

### État livré

À la fin de ce sub-project, on peut : saisir une clé dans l'onglet Settings de la fenêtre Tauri, voir l'état passer à « Clé enregistrée », relancer l'application et retrouver cet état, et lancer `just test` pour voir passer un test qui envoie `set_api_key` par la boucle NDJSON puis vérifie que la clé n'apparaît ni sur stdout ni dans les logs.

## Dependencies

Aucune : ce sub-project est autoporté.

## Références de design

- **Maquette** : `ui_kits/techno-tagger/SettingsScreen.jsx`, composant `SettingsScreen`, section « API », rangée « Clé X-API-Key » (champ, bouton « Enregistrer », texte d'aide). La rangée « URL de l'API » n'est pas reprise (URL figée, décision du 2026-09-19). Les autres sections (Matching, Interface, Administration) relèvent de la Feature 7.
- **Design system** : `components/forms/Password.prompt.md`, `components/forms/Button.prompt.md`, `components/feedback/Message.prompt.md`
- Règle de lecture : `.claude/rules/design/claude-design.md`, arbitrages dans `.design-sync/NOTES.md` § Reste ouvert (container unique `px-16 py-8` porté par le shell, page qui ne défile jamais : la maquette pose encore son propre padding et un `max-width` de formulaire, ils ne sont pas repris)

## Files touched

- **À créer** : `sidecar/src/tagger/api_key.py` (lecture et écriture de la clé dans le trousseau, erreurs)
- **À modifier** : `sidecar/src/tagger/protocol.py` (commande `SetApiKey`, unions)
- **À modifier** : `sidecar/src/tagger/handlers.py` (`handle_get_version` lit le trousseau, `handle_set_api_key`)
- **À modifier** : `sidecar/src/tagger/__main__.py` (`keyring.set_keyring(WinVaultKeyring())` à la place du TODO, `case SetApiKey` dans `_dispatch`)
- **À créer** : `sidecar/tests/helpers/memory_keyring.py` (backend keyring en mémoire pour les tests)
- **À créer** : `sidecar/tests/unit/test_api_key.py`
- **À modifier** : `sidecar/tests/unit/test_handlers.py` (version et `set_api_key`)
- **À modifier** : `sidecar/tests/integration/test_ndjson_loop.py` (test de sécurité de bout en bout)
- **À modifier** : `sidecar/tests/conftest.py` (fixture de trousseau en mémoire)
- **À modifier** : `src/app/core/models/protocol.ts` (`SetApiKeyCommand`)
- **À modifier** : `src/app/core/sidecar.service.ts` et `sidecar.service.spec.ts` (signal `apiKeyConfigured`, méthode `setApiKey`)
- **À modifier** : `src/app/features/settings/settings-page.component.ts`, `.html`, **à créer** : `settings-page.component.spec.ts`
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`settings.api.*`, `errors.api_key_error`, `errors.api_key_not_stored`, `errors.keyring_unavailable` : `test_error_translations.py` exige aussi la classe de base, comme `extraction_error`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Capacités Natives `store`, § API commandes)
- **À modifier** : `docs/adrs/012-securite-cle-api-keyring.md` (note sur l'URL)
- **À modifier** : `docs/knowledges/techno-scraper.md` (§ Authentification, URL)
- **À modifier** : `docs/DESIGN.md` (§ Settings, ligne « URL de l'API » retirée)
- **À modifier** : `docs/PRODUCTION.md` (§ Variables d'Environnement, table des réglages)
- **À modifier** : `docs/BRAINSTORM.md` (Feature 7, note « Décidé autrement depuis »)
- **À modifier** : `docs/knowledges/tauri.md` (table des plugins et Points Importants : l'URL de l'API ne vit plus dans le `store`)
- **À modifier** : `.claude/rules/keyring/secrets.md` (la puce « Valider une clé par un appel à `/health` » contredit la décision de ne pas vérifier la clé à l'enregistrement)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Ordre de développement, étape 5 : la clé API n'a pas été livrée avec l'onglet Playlist, elle arrive ici)

Le `.spec` PyInstaller embarque déjà le backend (`copy_metadata("keyring")`, hidden imports `win32ctypes.pywin32.win32cred` et `win32ctypes.pywin32.pywintypes`) : rien à y changer.

## Architecture approach

- **Module `tagger/api_key.py`**, seul à toucher le trousseau (ADR-012, `.claude/rules/keyring/secrets.md`). Le nom `secrets.py` est écarté : il masquerait le module de la bibliothèque standard à la lecture. Service `APP_NAME`, identifiant constant `x-api-key`.
  - `read_api_key() -> str | None` : `None` est un état normal (premier lancement). Une `KeyringError` à la lecture est loguée en WARNING avec `reason` et traitée comme une absence de clé : l'application reste utilisable, l'onglet Tagging dira qu'il manque la clé.
  - `store_api_key(key)` : `PasswordSetError` devient `ApiKeyNotStoredError` (`api_key_not_stored`), `NoKeyringError` devient `KeyringUnavailableError` (`keyring_unavailable`), deux messages différents côté interface. Aucune des deux ne porte la clé dans ses `params` ni dans son message.
- **Backend forcé au démarrage** : `keyring.set_keyring(WinVaultKeyring())` dans `main()`, après Sentry et avant la boucle, à la place du TODO existant. La découverte par entry points échoue dans le binaire figé, et seulement là (`.claude/rules/keyring/secrets.md`).
- **Commande `set_api_key`** : `SetApiKey(command="set_api_key", api_key: str)`, `extra="forbid"`, `strict=True` comme toute commande (ADR-022). Le champ n'accepte que de l'ASCII imprimable sans espace, de 1 à 2560 caractères. Ce n'est pas une validation de la clé : c'est la contrainte du décodage latin-1 des en-têtes côté API (PRODUCTION.md § Règles) et le plafond du Credential Manager (`CRED_MAX_CREDENTIAL_BLOB_SIZE`). Une clé hors format produit l'erreur `malformed_command` existante, dont `error_from_validation` ne garde que `loc` et `type` : la valeur saisie ne revient jamais vers la webview.
- **Pas de vérification auprès de l'API** (décision du 2026-09-19) : l'API n'expose aucune route authentifiée qui n'interroge pas une source. Une clé fausse arrête le run après trois 403 consécutifs, avec un message qui la nomme (sub-project 06, ARCHITECTURE.md § Clé API invalide ou révoquée).
- **Réponse par l'événement `version`**, réémis avec `api_key_configured` à jour : c'est déjà le seul endroit où l'interface apprend l'existence d'une clé, sans jamais la relire (docstring de `Version`, ADR-012). Aucun événement nouveau. `handle_get_version` lit le trousseau pour tous les autres cas.
- **Aucune fuite** : la clé n'apparaît dans aucun log, aucun `params`, aucun message d'erreur, aucun événement, aucune variable Sentry (`include_local_variables=False` déjà posé, `.claude/rules/sentry/python.md`). `run_loop` ne logue pas les erreurs de validation, et le log des erreurs métier ne porte que le `code`. Un test de sécurité de bout en bout le vérifie (ARCHITECTURE.md § Tests).
- **Tests sur un trousseau en mémoire** : un backend `keyring.backend.KeyringBackend` minimal, posé par une fixture avec `keyring.set_keyring`, restauré après le test. Aucun test ne touche le Credential Manager de la machine. Les erreurs keyring sont provoquées par un backend qui lève, pas par un mock de keyring lui-même (`.claude/rules/pytest/tests.md`).
- **Service sidecar Angular** : signal `apiKeyConfigured` alimenté par l'événement `version`, méthode `setApiKey(key)` qui envoie la commande, sur le patron des méthodes existantes (`.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`). La clé ne transite qu'une fois de la webview au sidecar et n'est gardée dans aucun signal.
- **Section API des Settings** (`.claude/rules/angular/components.md`, `.claude/rules/angular/forms.md`, `.claude/rules/primeng/composants.md`) :
  - titre de page et section « API », une rangée libellé plus aide à gauche, contrôles à droite, comme la maquette ;
  - `p-password` en `[feedback]="false"` et `[toggleMask]="true"` (DESIGN.md § Settings), jamais prérempli, vidé après l'envoi ;
  - bouton primaire « Enregistrer » en `size="small"`, désactivé tant que le champ est vide ;
  - état « Clé enregistrée » ou « Aucune clé » lu depuis `apiKeyConfigured` ;
  - une erreur `api_key_not_stored`, `keyring_unavailable` ou `malformed_command` s'affiche par `ErrorMessageComponent` sous la rangée ;
  - libellés par ngx-translate, FR et EN dans le même commit (`.claude/rules/ngx-translate/i18n.md`), largeurs mesurées sur le texte le plus long des deux langues (DESIGN.md § Conventions de Code).
- **Documentation réalignée sur l'URL figée**, chaque modification datée du 2026-09-19 : la ligne `store` d'ARCHITECTURE.md ne mentionne plus l'URL, `set_api_url` disparaît de la table des commandes, la note de l'ADR-012 dit l'URL figée dans le sidecar, `knowledges/techno-scraper.md` aussi, la ligne « URL de l'API » quitte le mapping Settings de DESIGN.md et la table des réglages de PRODUCTION.md, et la Feature 7 de BRAINSTORM.md reçoit une note « Décidé autrement depuis » sur le modèle de celles qui existent.

## Acceptance criteria

### Scénario 1 : Premier lancement sans clé
**GIVEN** un trousseau sans entrée pour l'application
**WHEN** l'interface demande la version
**THEN** l'événement `version` porte `api_key_configured: false`
**AND** la section API affiche « Aucune clé »

### Scénario 2 : Enregistrement d'une clé
**GIVEN** l'onglet Settings ouvert sans clé enregistrée
**WHEN** l'utilisateur saisit une clé et clique sur « Enregistrer »
**THEN** le sidecar la range dans le trousseau et réémet `version` avec `api_key_configured: true`
**AND** la section affiche « Clé enregistrée » et le champ est vidé

### Scénario 3 : Clé retrouvée au lancement suivant
**GIVEN** une clé enregistrée lors d'une session précédente
**WHEN** l'application redémarre
**THEN** l'événement `version` porte `api_key_configured: true`
**AND** le champ reste vide

### Scénario 4 : Clé hors format
**GIVEN** une saisie qui contient un espace ou un caractère non ASCII
**WHEN** elle est envoyée
**THEN** le sidecar répond `malformed_command` sans ranger la clé
**AND** l'erreur ne contient pas la valeur saisie

### Scénario 5 : Trousseau indisponible
**GIVEN** un trousseau qui refuse l'écriture
**WHEN** une clé est envoyée
**THEN** le sidecar répond `api_key_not_stored`, ou `keyring_unavailable` si aucun backend n'est disponible
**AND** la section affiche l'erreur traduite

### Scénario 6 : La clé ne fuit nulle part
**GIVEN** une clé reconnaissable envoyée par `set_api_key` sur la boucle NDJSON
**WHEN** la commande est traitée
**THEN** la valeur n'apparaît dans aucune ligne de stdout ni dans aucun enregistrement de log

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_api_key.py` :
  - reads no key from an empty keyring
  - stores then reads the key
  - reads no key when the keyring fails on read
  - raises api key not stored when the keyring refuses the write
  - raises keyring unavailable without backend
- `sidecar/tests/unit/test_handlers.py` (ajouts) :
  - reports whether an api key is configured
  - answers set api key with a version that reports the key
  - rejects an api key with a space or a non ascii character (paramétré, validation du modèle)
- `src/app/core/sidecar.service.spec.ts` (ajouts) :
  - feeds the api key state from the version event
  - sends the api key command
- `src/app/features/settings/settings-page.component.spec.ts` :
  - shows whether a key is configured
  - disables saving while the field is empty
  - sends the key then clears the field

### Integration
- `sidecar/tests/integration/test_ndjson_loop.py` (ajout) :
  - never echoes the api key on stdout nor in the logs

Aucun test ne vérifie keyring ni PrimeNG : chacun échoue contre une régression de notre traduction d'erreur, de notre contrôle de format, de notre réponse `version` ou de notre gestion du champ.

## Edge cases

- **Remplacement d'une clé** : un nouvel `set_api_key` écrase l'entrée existante, sans confirmation. C'est la procédure de rotation de PRODUCTION.md (« la personne ressaisit dans les Settings »).
- **Clé enregistrée mais révoquée côté API** : `api_key_configured` reste vrai, le run s'arrête sur les 403 (sub-project 06).
- **Backend keyring introuvable dans le binaire figé** : `KeyringUnavailableError` à l'écriture, absence de clé à la lecture. Invisible en `tauri dev`, d'où le blocker.
- **Saisie avec espaces en bord** : refusée comme hors format, jamais tronquée en silence : la clé réelle ne contient aucun espace.
- **Double clic sur « Enregistrer »** : le champ est vidé à l'envoi, le second clic trouve un champ vide et le bouton désactivé.

## Architectural decisions

### Décision : Vérification de la clé à l'enregistrement

**Options envisagées :**
- **A. Aucune vérification auprès de l'API, format seul** : aucun appel à une source, une clé fausse est détectée au premier run par la garde des 403.
- **B. Recherche test après saisie** : retour immédiat dans les Settings, au prix d'un appel à Beatport à chaque enregistrement et d'un faux négatif si la source est en panne.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19.
- `/health` n'est pas authentifié et toute autre route interroge une source : une vérification consommerait la capacité de l'API sans rien garantir de plus que la garde des 403.

### Décision : Canal de confirmation de l'enregistrement

**Options envisagées :**
- **A. Réémettre `version`** : l'événement porte déjà `api_key_configured`, seul canal par lequel l'interface apprend l'état de la clé.
- **B. Événement dédié `api_key_stored`** : un message de plus dans le contrat, pour la même information.

**Choix : A**

**Rationale :**
- Un seul canal pour une seule information : l'état de la clé se lit toujours au même endroit, au démarrage comme après un enregistrement.
