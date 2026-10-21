---
feature: "Feature 8 : Distribution et mise à jour"
subproject: "recette-distribution"
goal: "Valider sur de vraies Releases la chaîne complète de distribution et de mise à jour"
status: "implemented"
complexity: "M"
tdd_scope: "none"
depends_on: ["01-chaine-de-signature-design.md", "02-invite-de-mise-a-jour-design.md", "03-version-dans-les-reglages-design.md"]
date: "2026-10-15"
---

# Recette de la distribution

## Scope

Couvre :
- deux Releases successives, A puis B, la première à embarquer l'updater ;
- l'installation de A à la main sur une VM propre et chez un utilisateur réel, les installations ≤ 0.7.0 n'ayant pas le plugin ;
- la mise à jour de A vers B par l'updater sur les deux machines ;
- les vérifications qui n'existent que sur une Release publiée ou un bundle installé :
  - contrôle des artefacts en CI ;
  - SmartScreen et antivirus ;
  - keyring dans le binaire figé ;
  - sidecar remplacé ;
  - clé API refusée ;
- la section Installation du README ;
- la mesure des faux positifs antivirus et la décision qui en découle ;
- la correction d'ADR-015 et de PRODUCTION.md sur l'éligibilité d'Azure Artifact Signing ;
- les cases correspondantes de PRODUCTION.md et VERSIONS.md, cochées et datées.

Exclut :
- la release 1.0.0, sortie du périmètre le 2026-10-21 par décision du propriétaire et publiée à part ;
- la VM propre, écartée le même jour : la machine de l'utilisateur réel tient lieu de machine tierce ;
- tout code applicatif, un défaut trouvé partant en `hotfix/*` (PRODUCTION.md § Rollback) ;
- les items Sentry de la Checklist Post-MEP (chaîne d'alerte, payload inspecté, release Sentry au tag), qui relèvent de la Feature 9 ;
- les mesures de runs de 100 morceaux.

### État livré

À la fin de ce sub-project :
- une installation en version A, sur VM propre comme chez un utilisateur réel, se met à jour seule en version B, sidecar compris ;
- une clé API refusée arrête le run ;
- les cases de distribution et de mise à jour de PRODUCTION.md et VERSIONS.md sont cochées avec leur date.

## Dependencies

- `01-chaine-de-signature-design.md` (statut: draft) : paire de clés, secrets, Release signée et contrôle des artefacts.
- `02-invite-de-mise-a-jour-design.md` (statut: draft) : modale, badge, téléchargement et installation, ce que la recette exerce.
- `03-version-dans-les-reglages-design.md` (statut: draft) : version lue dans les Réglages avant et après la mise à jour.

## Files touched

- **À modifier** : `README.md` (section Installation, pour les utilisateurs)
- **À modifier** : `docs/PRODUCTION.md` (Checklist Distribution, Checklist Post-MEP hors Sentry, Bootstrap technique : keyring, `extra-files`, WebView2 ; Benchmarks : taille de l'installeur et détections antivirus)
- **À modifier** : `docs/VERSIONS.md` (« `latest.json` est publié avec une signature valide… » et « WebView2 est bien présent sur l'image du runner Windows »)
- **À modifier** : `docs/ARCHITECTURE.md` (Ordre de développement, étape 9 livrée ; Évolutions Futures, feature antivirus)
- **À modifier** : `docs/adrs/015-cibles-distribution-windows.md` et `docs/PRODUCTION.md` § Code Signing (éligibilité d'Azure Artifact Signing, via le skill `architecture-doc` pour l'ADR)
- **À modifier** : `docs/BRAINSTORM.md` (feature Post-MVP « Réduire les faux positifs antivirus » et Décision Ordre du Post-MVP, via le skill `brainstorm-doc`)

## Architecture approach

- **Section Installation du README**, en français, pour un utilisateur sans compte GitHub :
  - téléchargement depuis la dernière Release ;
  - avertissement SmartScreen, contournable en deux clics (ADR-015), « Informations complémentaires » puis « Exécuter quand même » ;
  - exclusion antivirus si le sidecar est mis en quarantaine (texte de l'écran bloquant `app.blocked.missing`) ;
  - saisie de la clé API dans les Réglages, la clé arrivant à part par canal privé (PRODUCTION.md § Gestion des clés utilisateurs) ;
  - mises à jour proposées au lancement.

  Aucun identifiant ni aucune personne réels. C'est le lien que reçoit l'utilisateur.
- **Release A** :
  - PR `develop → main` titrée `feat:`, mergée en squash avec un corps explicite (`.claude/CLAUDE.md` § Workflow Git) ;
  - merge de la PR release-please ;
  - job `build` vert, étape « Verifier les artefacts de l'updater » comprise (nom sans accent, comme les autres étapes du workflow) : premier passage réel de son contrôle de contenu ;
  - `curl -L` de `latest.json` sans authentification (Checklist Post-MEP).
- **Installation de A** : depuis la Release publiée, jamais depuis l'artefact de CI ni un build local, ce qui exerce la `pubkey` contre la vraie clé de la CI.
  - **Sur VM propre** :
    - SmartScreen constaté ;
    - Defender ;
    - premier lancement sans clé (Réglages explicites) ;
    - clé saisie, application relancée, clé relue : keyring dans le binaire figé (ADR-012) ;
    - run complet sur quelques morceaux ;
    - clé volontairement invalide : arrêt après trois `403` et `api_key_rejected`.
  - **Chez un utilisateur réel**, avec le lien du README et sa clé : même parcours, sans le test de la clé invalide.
- **Release B** (tout lot `feat:` ou `fix:` qui suit), observée sur les deux machines :
  - modale au lancement, « Voir les nouveautés » ;
  - « Plus tard » puis badge ;
  - « Installer » : progression, fermeture, relance par l'installeur ;
  - version B lue dans Réglages > Version, sans écran de versions désaccordées, ce qui prouve un sidecar remplacé (PRODUCTION.md § Remplacement du sidecar).
- **Mesures** : taille de l'installeur B, installeur et sidecar soumis à VirusTotal, résultats datés dans PRODUCTION.md § Benchmarks.
- **Faux positifs antivirus, mesurer puis décider** (décision du propriétaire, 2026-10-15) :
  - Une feature Post-MVP « Réduire les faux positifs antivirus » rejoint `docs/BRAINSTORM.md` dans tous les cas, avec les mesures de la recette. PRODUCTION.md § Benchmarks appelle ce faux positif « le mode de panne le plus probable du projet ».
  - Un sidecar mis en quarantaine ou bloqué par Defender chez l'utilisateur réel rend les faux positifs bloquants. Le faux positif est alors déclaré à Microsoft (remède immédiat, à chaque build) et la feature passe en n°1 du Post-MVP. Sinon, elle se range avec les features qui suivent la demande. La Décision Ordre du Post-MVP est mise à jour en conséquence (décision du propriétaire, 2026-10-15).
  - Pistes de la feature, relevées le 2026-10-15 (Microsoft Learn « Code signing options », page du 2026-08-29 ; conditions SignPath ; boutique Certum) :
    - le Microsoft Store en MSIX : gratuit, re-signé par Microsoft, sans avertissement SmartScreen, mais mises à jour par le Store à la place de l'updater, emballage MSIX en CI et certification à chaque version ;
    - un certificat Certum Open Source, dès 49 €, au nom civil du propriétaire, affiché dans chaque binaire public ;
    - le bootloader PyInstaller recompilé en CI, efficace contre les seules détections par signature ;
    - un certificat OV (150 à 300 $ par an).
  - SignPath Foundation, gratuite pour l'open source, est écartée d'avance : elle refuse tout composant non open source (PrimeNG v22, ADR-003) et exige une réputation vérifiable du projet.
  - Une signature ne retire pas l'avertissement SmartScreen, qui suit la réputation des téléchargements depuis 2024 (ADR-015).
- **ADR-015 et PRODUCTION.md § Code Signing corrigés** en tête de la recette : Azure Artifact Signing n'est pas accessible à un développeur individuel hors des USA et du Canada (Microsoft Learn, quickstart Trusted Signing, consulté le 2026-10-15). Le texte présentait l'option comme « accessible à un développeur individuel ».
- **Cases cochées** au fil de la recette, chacune datée, aucune cochée sur une preuve indirecte (règle « Écrire durable » des instructions utilisateur).
- **Un défaut trouvé** :
  - en `hotfix/*` puis nouveau tag PATCH, la Release fautive dépubliée si elle casse la chaîne (PRODUCTION.md § Rollback) ;
  - si l'installeur ne relance pas l'application, le plugin `process` s'ajoute (sub-project 02, décision « relance après installation », option B).

## Acceptance criteria

### Scénario 1 : Release A complète
**GIVEN** les sub-projects 01 à 03 mergés sur `main`
**WHEN** release-please crée le tag de A
**THEN** le job `build` est vert, son contrôle des artefacts compris
**AND** `latest.json` se télécharge sans authentification avec `version`, `platforms.windows-x86_64.url` et `.signature` renseignés

### Scénario 2 : installation de A sur VM propre
**GIVEN** une VM Windows sans toolchain
**WHEN** l'installeur de A est lancé depuis la Release
**THEN** SmartScreen avertit et se contourne comme le décrit le README
**AND** l'application démarre, les Réglages expliquent la clé à saisir et la clé saisie survit à une relance

### Scénario 3 : clé refusée
**GIVEN** l'application A sur la VM avec une clé invalide
**WHEN** un run démarre
**THEN** il s'arrête après trois `403` consécutifs avec le message de clé refusée

### Scénario 4 : mise à jour de A vers B
**GIVEN** A installée sur la VM et chez l'utilisateur réel, B publiée
**WHEN** l'application A démarre puis l'utilisateur clique « Installer »
**THEN** la modale propose B, la progression avance, l'application se ferme puis se relance
**AND** Réglages > Version indique B, sans écran de versions désaccordées

## Edge cases

- **Contrôle des artefacts rouge sur A** : Release dépubliée, correctif en `hotfix/*` (PRODUCTION.md § Rollback), A devient le PATCH suivant.
- **Signature refusée chez l'utilisateur** (clé de la CI désynchronisée de la `pubkey`) : un événement Sentry part (sub-project 02), incident critique, aucune rotation possible sans l'ancienne clé (PRODUCTION.md § Rotation).
- **Sidecar en quarantaine après B** : empreinte nouvelle, faux positif possible. L'exclusion se refait, le faux positif se déclare à Microsoft et la décision « mesurer puis décider » s'applique (PRODUCTION.md § Rollback, dernier point).
- **Application non relancée** : installation réussie mais fenêtre fermée. Le plugin `process` s'ajoute en `fix:`, la recette de B est rejouée.
- **Utilisateur réel indisponible** : la VM ne vaut pas la machine tierce pour SmartScreen, l'antivirus et le trousseau (Checklist Post-MEP). La case reste ouverte.

## Architectural decisions

### Décision : emplacement du message aux utilisateurs

**Options envisagées :**
- **A. Section Installation du README** : publique, une seule source à jour, le lien suffit, la clé part à part.
- **B. Modèle dans PRODUCTION.md** : un texte à recopier dans chaque message, qui vieillit à chaque copie.
- **C. Hors dépôt** : rien à maintenir ici, rien de vérifiable par la recette.

**Choix : A**

**Rationale :**
- Le dépôt est public (ADR-021), le README est la page que voit un utilisateur sans compte GitHub.
- Le contenu ne porte aucune donnée privée : la clé, seule donnée sensible, passe par canal privé.
