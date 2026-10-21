# Recette de la distribution : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Valider sur de vraies Releases la chaîne complète de distribution et de mise à jour, jusqu'au jalon 1.0.0.

**Architecture:** Recette manuelle en six tâches, sans code applicatif :
- les documents qui partent avec la Release A (README § Installation, ADR-015 et PRODUCTION.md corrigés sur Azure) ;
- la publication de A, son contrôle d'artefacts et son manifeste ;
- l'installation de A sur VM propre puis chez un utilisateur réel ;
- la publication de B et la mise à jour de A vers B sur les deux machines, avec les mesures ;
- la consignation (cases datées, benchmarks, feature Post-MVP antivirus) ;
- la release 1.0.0.

Les gestes sur les machines de test et chez l'utilisateur sont joués par le propriétaire. L'agent prépare, guide, relève et consigne.

**Tech Stack:** GitHub Releases, release-please, `gh`, `curl`, VM Windows propre, VirusTotal.

**Spec:** `docs/superpowers/specs/distribution-et-mise-a-jour/04-recette-distribution-design.md`

## Global Constraints

- **Sub-projects 01 à 03 implémentés et mergés sur `develop`** avant la Task 2, secrets `TAURI_SIGNING_*` posés (sub-project 01, Task 3).
- **Aucun code applicatif** : un défaut part en `hotfix/*` (PRODUCTION.md § Rollback), puis la tâche en cours est rejouée sur le PATCH.
- **Installeurs téléchargés depuis la Release publiée**, jamais depuis un artefact de CI ni un build local.
- **Gestes sortants confirmés un par un** avec le propriétaire : merge sur `main`, merge de la PR release-please, envoi du lien et de la clé à l'utilisateur réel, soumission à VirusTotal.
- **PR `develop → main` titrée `feat:` ou `fix:`** et mergée par `gh pr merge <n> --squash --body "<une ligne>"` (`.claude/CLAUDE.md` § Workflow Git). Passer par le skill `git-ops`.
- **Cases cochées une à une**, datées (`(2026-MM-JJ)` à la suite du texte), seulement sur la preuve observée, jamais sur une preuve indirecte.
- **Aucune donnée réelle dans le dépôt** : ni nom de l'utilisateur réel, ni identifiant `USER_N` associé à une personne, ni clé.
- **Docs gouvernées par un skill** : `Skill[architecture-doc]` avant ADR-015 et ARCHITECTURE.md, `Skill[production-doc]` avant PRODUCTION.md, `Skill[versions-doc]` avant VERSIONS.md, `Skill[brainstorm-doc]` avant BRAINSTORM.md.
- **Hors périmètre** : items Sentry de la Checklist Post-MEP (Feature 9), runs de 100 morceaux.

## Review Focus

- **Contrôle des artefacts rouge sur A** : Release dépubliée, `hotfix/*`, Task 2 rejouée sur le PATCH (Task 2, Step 4).
- **Application non relancée par l'installeur** : `fix:` qui ajoute le plugin `process` (sub-project 02, décision B), Task 4 rejouée sur la Release suivante (Task 4, Step 4).
- **Signature refusée chez l'utilisateur** : incident critique, Sentry reçoit l'échec, aucune rotation sans l'ancienne clé (Task 4, Step 4).
- **Sidecar en quarantaine après B** : nouvelle empreinte, faux positif déclaré à Microsoft, feature antivirus en n°1 du Post-MVP (Task 4, Step 6 ; Task 5, Step 4).
- **Utilisateur réel indisponible** : la case « machine tierce » reste ouverte et la 1.0.0 attend (Task 6, Step 1).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `README.md` | Section Installation pour les utilisateurs |
| `docs/adrs/015-cibles-distribution-windows.md` | Mise à jour datée sur Azure Artifact Signing |
| `docs/PRODUCTION.md` | Code Signing, Checklist Distribution, Post-MEP, Bootstrap technique, Benchmarks |
| `docs/VERSIONS.md` | Cases `latest.json` et WebView2 |
| `docs/ARCHITECTURE.md` | Ordre de développement, étape 9 livrée ; Évolutions Futures, feature antivirus |
| `docs/BRAINSTORM.md` | Feature Post-MVP « Réduire les faux positifs antivirus », Décision Ordre du Post-MVP |

---

### Task 1: Documents de la Release A

**Files:**
- Modify: `README.md` (section Installation entre l'introduction et « Démarrage »)
- Modify: `docs/adrs/015-cibles-distribution-windows.md` (après le paragraphe « L'option la moins chère accessible à un développeur individuel… »)
- Modify: `docs/PRODUCTION.md` § Code Signing (paragraphe « Signer l'installeur ne changerait pas grand-chose… »)

- [x] **Step 1: Écrire la section Installation** (constaté le 2026-10-21)

Dans `README.md`, avant `## Démarrage` :

```markdown
## Installation

Pour utiliser l'application, sous Windows 10 ou 11 :

1. Télécharger `techno-tagger_<version>_x64-setup.exe` depuis la [dernière version publiée](https://github.com/thibaud57/techno-tagger/releases/latest).
2. Le lancer. Windows affiche « Windows a protégé votre ordinateur » : l'installeur n'est pas signé. Cliquer « Informations complémentaires », puis « Exécuter quand même ».
3. Au premier lancement, ouvrir Réglages > API et saisir la clé API reçue à part.
4. Si l'application affiche « Le moteur de l'application est introuvable », l'antivirus a mis son moteur en quarantaine : le restaurer, l'ajouter aux exclusions, puis cliquer « Réessayer ».

Les mises à jour se proposent d'elles-mêmes au lancement de l'application.
```

`<version>` reste tel quel dans le README : il désigne le numéro de chaque Release, pas une valeur à remplir.

- [x] **Step 2: Corriger ADR-015** (constaté le 2026-10-21)

Charger `Skill[architecture-doc]`, puis ajouter après le paragraphe « L'option la moins chère accessible à un développeur individuel est **Azure Trusted Signing**… » :

```markdown
**Mise à jour 2026-10-15** : devenu Azure Artifact Signing (~9,99 $/mois), le service n'est ouvert aux développeurs individuels qu'aux USA et au Canada, aux organisations qu'aux USA, au Canada, dans l'UE et au Royaume-Uni ([Microsoft Learn, Code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), page du 2026-08-29). Il n'est donc pas accessible à un développeur individuel en dehors de ces deux pays. Les options réelles et leur coût sont relevés dans la spec `docs/superpowers/specs/distribution-et-mise-a-jour/04-recette-distribution-design.md` et portés par la feature Post-MVP « Réduire les faux positifs antivirus ».
```

- [x] **Step 3: Corriger PRODUCTION.md § Code Signing** (constaté le 2026-10-21)

Charger `Skill[production-doc]`, puis dans le paragraphe « Signer l'installeur ne changerait pas grand-chose… », remplacer la phrase entière « L'option la moins chère accessible à un individu, Azure Trusted Signing (~120 $/an), est écartée au vu du budget nul ; son bénéfice réel serait la réduction des faux positifs antivirus, que le mode `--onedir` retenu atténue sans rien dépenser ([ADR-015](adrs/015-cibles-distribution-windows.md)). » par :

```markdown
Azure Artifact Signing (~9,99 $/mois) n'est ouvert aux individus qu'aux USA et au Canada ; les autres options, Microsoft Store en MSIX, certificat Certum Open Source ou OV, bootloader PyInstaller recompilé, attendent la mesure des faux positifs de la première recette, le mode `--onedir` retenu les atténuant déjà sans rien dépenser (mise à jour du 2026-10-15 d'[ADR-015](adrs/015-cibles-distribution-windows.md)).
```

- [x] **Step 4: Commit sur la branche de la feature** (`feature/*`, mergée dans `develop` avant la Task 2)

```bash
git add README.md docs/adrs/015-cibles-distribution-windows.md docs/PRODUCTION.md
git commit -m "docs: installation pour les utilisateurs et eligibilite d'Azure Artifact Signing"
```

---

### Task 2: Release A

**Files:** aucun.

Faite le 2026-10-20 : v0.10.0. Le contrôle a échoué sur les URL d'API que `tauri-action` v1 écrit dans `latest.json` ; manifeste corrigé à la main, réécriture ajoutée au workflow (PR #86). La Release est créée en draft depuis (Steps 3 et 4 ci-dessous).

**Interfaces:**
- Produces : tag `vA` (version calculée par release-please), Release publiée portant l'installeur, son `.sig` et `latest.json`.

- [x] **Step 1: Ouvrir la PR `develop → main`**

Via le skill `git-ops`, titre `feat: distribution et mise a jour de l'application`. Confirmer le merge avec le propriétaire, puis :

Run: `gh pr merge <n> --squash --body "Updater signe, invite de mise a jour et version dans les reglages"`

- [x] **Step 2: Merger la PR release-please**

Attendre le job `sync-lockfiles` vert et le commit `chore: realigner les lockfiles…` en tête de la PR de release, approuver les workflows en attente, relire le CHANGELOG, confirmer avec le propriétaire, merger.

- [x] **Step 3: Suivre le job `build`**

Run: `gh run watch $(gh run list --workflow release-please.yml --limit 1 --json databaseId --jq '.[0].databaseId')`
Expected: job `build` vert, étape « Verifier les artefacts de l'updater » (nom sans accent, comme dans le workflow) comprise, avec sa ligne `latest.json <version> et sa signature publies sur v<version>`, puis « Publier la Release ».

- [x] **Step 4: Si le contrôle échoue**

La Release reste en draft, jamais servie. « Re-run failed jobs » du même run ; si la cause est dans le code, `hotfix/*` et Task 2 rejouée sur le PATCH (PRODUCTION.md § Canaux, « Build en échec »). Ne pas continuer la recette sur une Release dont le contrôle est rouge.

- [x] **Step 5: Manifeste accessible sans authentification**

Run: `curl -sL https://github.com/thibaud57/techno-tagger/releases/latest/download/latest.json`
Expected: JSON avec `version` égale à A, `platforms.windows-x86_64.url` vers `…/releases/download/vA/…-setup.exe`, `signature` non vide.

- [x] **Step 6: Assets de la Release**

Run: `gh release view vA --json assets --jq '.assets[] | "\(.name) \(.size)"'`
Expected: `…_x64-setup.exe`, `…_x64-setup.exe.sig`, `latest.json`. Noter la taille de l'installeur.

---

### Task 3: Installation de A

**Files:** aucun (constats relevés pour la Task 5).

- [ ] **Step 1: Sur VM propre (geste du propriétaire)**

Écartée le 2026-10-21 par décision du propriétaire : la machine de l'utilisateur réel (Step 2) tient lieu de machine tierce, et une VM sous Windows Home coûterait une à deux heures pour le seul Smart App Control, déjà consigné comme risque (PRODUCTION.md § Code Signing). Vaut aussi pour la Task 4, Step 2.

Message au propriétaire, puis attendre son relevé :

```
Sur une VM Windows sans toolchain, en suivant uniquement la section Installation du README :
1. Télécharge l'installeur de vA depuis la Release, lance-le : note le message SmartScreen
   et confirme que « Informations complémentaires » puis « Exécuter quand même » suffit.
2. Note toute alerte Defender (sur l'installeur ou sur tagger.exe).
3. Premier lancement sans clé : Réglages > API explique-t-il quoi saisir ?
4. Saisis une clé valide, ferme puis relance l'application : la clé est-elle toujours là
   (24 points dans le champ) ?
5. Fais un run complet sur trois ou quatre morceaux d'un dossier de test.
6. Remplace la clé par une valeur invalide, lance un run : il doit s'arrêter après trois
   refus avec « La clé API a été refusée. Vérifiez-la dans les Réglages. »
7. Réglages > Administration > Version : la version affichée est-elle vA ?
8. F5, Ctrl+R et le clic droit dans la fenêtre restent-ils sans effet ?
9. Application fermée, renomme tagger.exe dans le dossier d'installation, relance :
   l'écran bloquant nomme-t-il le fichier attendu et son emplacement ? Remets le nom,
   clique « Réessayer » : l'application repart-elle ?
Garde cette VM en vA pour la Task 4.
```

Expected : chaque point observé, avec sa date. Un point en échec renvoie au § Rollback (hotfix), ou à la section Installation du README si c'est elle qui est fausse.

- [x] **Step 2: Chez l'utilisateur réel (geste du propriétaire)** (2026-10-21 : SmartScreen contourné, clé gardée après relance, run sur quelques morceaux)

Le propriétaire envoie le lien de la section Installation du README. La clé de l'utilisateur part à part, par canal privé (PRODUCTION.md § Gestion des clés utilisateurs). Relevé attendu : points 1 à 5 et 7 du Step 1, sans le test de la clé invalide. L'utilisateur reste en vA pour la Task 4.

---

### Task 4: Release B et mise à jour de A vers B

**Files:** aucun (constats relevés pour la Task 5).

Passage de A à B prouvé le 2026-10-21 sur le poste de développement (`.claude/skills/verify/SKILL.md` § Pilotage de l'invite de mise à jour) : ne remplace ni la VM propre ni l'utilisateur réel.

- [x] **Step 1: Publier B** (2026-10-21 : v0.11.0, build vert, Release publiée par le workflow après la garde, `latest.json` sous le tag)

Le premier lot `feat:` ou `fix:` qui suit A, publié comme à la Task 2, Steps 1 à 6. Expected : Release B complète, contrôle vert, `latest.json` en version B.

- [ ] **Step 2: Mise à jour sur la VM (geste du propriétaire)**

Message au propriétaire, puis attendre son relevé :

```
Sur la VM restée en vA :
1. Lance l'application : la modale « Mise à jour disponible » propose-t-elle B, avec vA
   comme version installée ?
2. « Voir les nouveautés » ouvre-t-il la page de la Release B ?
3. « Plus tard » : le badge « Mise à jour B » apparaît-il ? Un clic rouvre-t-il la modale ?
4. « Installer » : la barre de progression avance-t-elle ? L'application se ferme-t-elle,
   puis se relance-t-elle seule après l'installation ?
5. Après relance : Réglages > Administration > Version indique-t-il B, sans écran
   « La mise à jour est incomplète » ?
6. « Rechercher une mise à jour » affiche-t-il « Vous utilisez la dernière version. » ?
7. Note toute alerte Defender sur le nouveau tagger.exe.
```

- [x] **Step 3: Mise à jour chez l'utilisateur réel (geste du propriétaire)** (2026-10-21 : 0.11.0 proposée, installée, relancée, version 0.11.0 dans Réglages, aucune alerte antivirus)

Relevé attendu : points 1, 4 et 5 du Step 2, plus toute alerte antivirus.

- [x] **Step 4: Si un point échoue** (sans objet le 2026-10-21 : aucun point en échec)

- **Application non relancée au point 4** : `fix:` qui ajoute le plugin `process` et un `relaunch()` après l'installation (sub-project 02, décision « relance après installation », option B), puis Task 4 rejouée sur la Release suivante.
- **Signature refusée** (modale en échec, événement Sentry reçu) : incident critique selon PRODUCTION.md § Incident Response. Comparer la `pubkey` de `tauri.conf.json` à la clé publique sauvegardée dans le gestionnaire de mots de passe, ne jamais régénérer la paire.
- **Écran « La mise à jour est incomplète »** : sidecar non remplacé, PRODUCTION.md § Remplacement du sidecar.

- [ ] **Step 5: Mesures (geste du propriétaire pour VirusTotal)**

- Taille de l'installeur B (Task 2, Step 6 rejoué sur B).
- Le propriétaire soumet l'installeur B et `tagger.exe` (tiré du dossier d'installation de la VM) à VirusTotal et relève le nombre de détections et les éditeurs concernés.

- [x] **Step 6: Faux positifs bloquants** (2026-10-21 : aucun, la feature antivirus suit la demande)

Le sidecar a été mis en quarantaine ou bloqué par Defender sur une machine (Task 3 ou Task 4) : le propriétaire déclare le faux positif à Microsoft pour ce build et la feature antivirus passe en n°1 du Post-MVP à la Task 5. Sinon, elle se range avec les features qui suivent la demande.

---

### Task 5: Consignation

**Files:**
- Modify: `docs/PRODUCTION.md`
- Modify: `docs/VERSIONS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/BRAINSTORM.md`

- [x] **Step 1: PRODUCTION.md** (2026-10-21)

Charger `Skill[production-doc]`. Cocher et dater, sur les seuls constats des Tasks 2 à 4. Les Checklists Release et Distribution se déroulent à chaque release : la case cochée et datée atteste du premier passage réel, comme le fait déjà « Confirmé au premier run (v0.1.0) » dans la Checklist Release, elle ne dispense pas de les rejouer à la release suivante :
- Checklist Distribution : les six items ;
- Checklist Post-MEP : `latest.json` accessible, chaîne de mise à jour vérifiée en réel, installation sur une machine tierce, faux positif antivirus mesuré, clé API révoquée testée (les items Sentry restent ouverts : Feature 9) ;
- Bootstrap technique : backend keyring forcé (clé relue après relance, Task 3), `extra-files` a bumpé les deux manifestes TOML (`grep '^version' src-tauri/Cargo.toml sidecar/pyproject.toml` égal à B), WebView2 présent sur le runner (l'application construite en CI s'ouvre) ;
- Validation technique finale : smoke test du livrable ;
- Checklist Release : smoke tests d'installation et de mise à jour.

Benchmarks : renseigner « Taille de l'installeur » (B, avec sa date) et « Détections antivirus » (résultat VirusTotal daté, éditeurs concernés).

- [x] **Step 2: VERSIONS.md** (2026-10-21)

Charger `Skill[versions-doc]`. Cocher et dater « `latest.json` est publié avec une signature valide, et un client sur la version antérieure détecte la mise à jour » (citation du doc) et « WebView2 est bien présent sur l'image du runner Windows… ».

- [x] **Step 3: ARCHITECTURE.md** (2026-10-21)

Charger `Skill[architecture-doc]`. Dans § Ordre de développement, ligne de l'étape 9, ajouter en fin de « Pourquoi cet ordre » : `Livrée par la Feature 8 (recette du AAAA-MM-JJ).`, à la date réelle de la Task 4. Dans § Évolutions Futures (Post-MVP), ajouter la puce « **Réduire les faux positifs antivirus** » avec la même phrase d'ouverture que la feature du BRAINSTORM (Step 4), à la place que lui donne la Task 4, Step 6.

- [x] **Step 4: BRAINSTORM.md** (2026-10-21, Feature 6, VirusTotal à mesurer)

Charger `Skill[brainstorm-doc]`. Ajouter la feature Post-MVP « Réduire les faux positifs antivirus » :

```markdown
### Feature N : Réduire les faux positifs antivirus

Le sidecar PyInstaller non signé est le mode de panne le plus probable chez un utilisateur (PRODUCTION.md § Benchmarks) : mis en quarantaine, il laisse l'application sur son écran bloquant. Mesure de la première recette : <résultat VirusTotal et constats Defender, datés>.

Pistes relevées le 2026-10-15, à trancher par un ADR le jour où la feature est prise :
- Microsoft Store en MSIX : gratuit, re-signé par Microsoft, sans avertissement SmartScreen ; mises à jour par le Store à la place de l'updater, emballage MSIX en CI, certification à chaque version
- Certificat Certum Open Source : dès 49 €, au nom civil du propriétaire, affiché dans chaque binaire
- Bootloader PyInstaller recompilé en CI : gratuit, efficace contre les seules détections par signature
- Certificat OV : 150 à 300 $ par an

SignPath Foundation est écartée : elle refuse tout composant non open source (PrimeNG v22) et exige une réputation vérifiable du projet. Une signature ne retire pas l'avertissement SmartScreen, qui suit la réputation des téléchargements.
```

Placer la feature et numéroter selon la Task 4, Step 6 :
- **bloquant** : en tête du Post-MVP, les suivantes renumérotées ;
- **sinon** : après « Formats de playlist supplémentaires », avant « Canal beta ».

Mettre à jour la « Décision Ordre du Post-MVP » en conséquence, avec sa date. `<résultat …>` se remplace par la mesure réelle de la Task 4, Step 5.

- [x] **Step 5: Commit sur une branche `feature/*`** (2026-10-21), mergée dans `develop` (`git-ops`)

```bash
git add docs/PRODUCTION.md docs/VERSIONS.md docs/ARCHITECTURE.md docs/BRAINSTORM.md
git commit -m "docs: recette de la distribution et de la mise a jour"
```

---

### Task 6: Release 1.0.0

**Files:** aucun.

- [x] **Step 1: Condition** (2026-10-21 : B installée par l'updater chez l'utilisateur réel)

B installée par l'updater chez l'utilisateur réel (Task 4, Step 3 réussi). Sinon, s'arrêter : la case « machine tierce » reste ouverte et la 1.0.0 attend (PRODUCTION.md, jalon 1.0.0).

- [ ] **Step 2: Publier en forçant la version**

Task 2, Steps 1 à 6, la PR `develop → main` titrée `feat: version 1.0.0` et mergée par :

```bash
gh pr merge <n> --squash --body "Release-As: 1.0.0"
```

Le footer va dans le corps du squash, seul texte que release-please lit (PRODUCTION.md § Versioning) : posé dans un commit de branche, il ne survivrait pas au squash. Expected : PR release-please en 1.0.0, Release 1.0.0 complète, contrôle vert.

- [ ] **Step 3: Vérifier le tag**

Run: `gh release view v1.0.0 --json tagName,isDraft --jq '"\(.tagName) draft=\(.isDraft)"'`
Expected: `v1.0.0 draft=false`.

- [ ] **Step 4: Proposée par l'updater**

Le propriétaire lance l'application en B sur la VM. Expected : la modale propose 1.0.0.
