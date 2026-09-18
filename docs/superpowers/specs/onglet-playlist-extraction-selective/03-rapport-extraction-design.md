---
feature: "Feature 1 — Onglet Playlist, extraction sélective"
subproject: "rapport-extraction"
goal: "Écrire dans le dossier destination le rapport d'extraction qui rend vérifiable chaque décision automatique prise pendant l'extraction"
status: "implemented"
complexity: "M"
tdd_scope: "full"
depends_on: ["01-parsing-playlists-design.md", "02-resolution-extraction-fichiers-design.md"]
date: "2026-09-08"
---

# Rapport d'extraction, en JSON et en Markdown

## Scope

Couvre la sérialisation d'un résultat d'extraction en deux fichiers déposés dans le dossier destination : un JSON versionné, destiné à être relu par l'application, et un Markdown, rendu lisible régénérable depuis le JSON. Les deux sont en anglais quelle que soit la langue de l'interface. Le rapport consigne les cinq catégories du résultat et, pour chaque homonyme départagé, le fichier retenu, les candidats écartés avec leur chemin et leur taille, et le critère appliqué.

Exclut le plan de run, la reprise et le rollback, qui relèvent de la Feature 6. Exclut la relecture d'un rapport passé et les migrations de schéma, qui n'ont rien à migrer tant qu'une seule version existe. Exclut le rapport du re-tagging, produit par la Feature 5, dont ce module posera néanmoins les fondations partagées.

### État livré

À la fin de ce sub-project, on peut : lancer une extraction sur les fixtures et retrouver dans le dossier destination deux fichiers horodatés, un `.json` et un `.md`, en anglais, où un homonyme départagé apparaît avec le fichier retenu, le candidat écarté, leurs chemins, leurs tailles et le critère de départage.

## Dependencies

- `01-parsing-playlists-design.md` (statut: draft) — fournit `TaggerError`, base des erreurs métier.
- `02-resolution-extraction-fichiers-design.md` (statut: draft) — fournit `ExtractionResult` et ses modèles, seule entrée de ce module.

## Files touched

- **À créer** : `sidecar/src/tagger/reports.py` (schéma, horodatage, rendu JSON et Markdown)
- **À créer** : `sidecar/tests/unit/test_reports_json.py` (schéma, versionnement, nommage, contenu)
- **À créer** : `sidecar/tests/unit/test_reports_markdown.py` (rendu lisible)
- **À créer** : `sidecar/tests/helpers/extraction_samples.py` (jeu de données couvrant les cinq catégories, partagé par les deux fichiers de test)
- **À modifier** : `sidecar/tests/conftest.py` (fixture d'un `ExtractionResult` couvrant les cinq catégories)

## Architecture approach

- **Module dédié `tagger/reports.py`** : sérialiser un résultat en JSON et en Markdown est une responsabilité unique, distincte de l'extraction qui le produit. Le rapport du re-tagging viendra s'y ajouter et réutilisera l'horodatage, le champ de version et le rendu Markdown. `plan.py` est écarté : son plan de run appartient à la Feature 6 et n'a rien à voir avec un rapport.
- **Champ de version dès la première version** : le JSON porte `schema_version`, conformément à [ADR-018](../../../adrs/018-versionnement-plan-de-run.md), qui exige de le poser d'emblée sous peine de laisser une génération d'artefacts non identifiables. Aucune fonction de migration n'est écrite ici : il n'y a qu'une version, et une migration sans version antérieure ne serait ni testable ni justifiée.
- **Champ `kind` distinguant les deux rapports du projet** : `extraction` ici, le re-tagging posant le sien. Deux rapports cohabitent dans le même dossier destination et un lecteur doit pouvoir les distinguer sans se fier au nom du fichier.
- **Un couple de fichiers par run, horodaté** : `extraction-report-<horodatage>.json` et son `.md`. ADR-018 qualifie le rapport de permanent et en fait la base de la relecture d'un run passé ; écraser détruirait exactement ce qu'il protège.
- **Horodatage compact dans le nom, ISO complet dans le contenu** : `isoformat()` produit des `:`, interdits dans un nom de fichier Windows. Le nom emploie donc un format compact en UTC, et le champ `generated_at` du JSON porte l'ISO complet.
- **Les cinq catégories du résultat sont écrites**, là où ARCHITECTURE.md § Données n'en nomme que trois. Taire les fichiers déjà présents et les copies en échec priverait le rapport de la moitié de ce qui peut mal tourner.
- **Sérialisation déterministe et lisible** : `ensure_ascii=False` pour que les titres non-ASCII restent lisibles, `sort_keys=True` pour qu'un même résultat produise deux fois le même fichier, `default=str` pour les `Path`, `encoding="utf-8"` explicite (cf. `.claude/rules/python/fichiers-io.md`). L'indentation est admise, la règle qui l'interdit visant le flux NDJSON où une ligne vaut un événement.
- **Markdown non versionné**, conformément à ADR-018 § Notes : c'est un rendu, jamais relu par l'application, régénérable depuis le JSON. Il porte le même contenu, mis en tableaux.
- **Horodatage injectable** : la fonction accepte un instant de génération, faute de quoi aucun test ne pourrait vérifier le nom du fichier produit. Par défaut, `datetime.now(UTC)`.
- **Rendu et écriture séparés** : deux fonctions produisent les chaînes JSON et Markdown, une troisième les dépose sur le disque. Le déterminisme et le contenu se vérifient alors sans toucher au système de fichiers, et le rendu Markdown reste régénérable depuis le JSON comme l'exige ADR-018.
- **Les chemins complets sont écrits sans réserve** : le rapport reste sur la machine de l'utilisateur. C'est vers Sentry que rien de personnel ne part, pas vers le dossier de destination (cf. ARCHITECTURE.md § Enjeux).
- **Aucune écriture sur `stdout`** : le flux standard porte le protocole NDJSON, jamais un diagnostic.

## Acceptance criteria

### Scénario 1 : Deux fichiers produits dans la destination
**GIVEN** un résultat d'extraction et un dossier destination
**WHEN** le rapport est écrit
**THEN** un fichier `.json` et un fichier `.md` existent dans le dossier destination
**AND** leurs deux chemins sont rendus à l'appelant, le JSON devant remonter à l'interface

### Scénario 2 : Nom horodaté, compatible Windows
**GIVEN** un instant de génération connu
**WHEN** le rapport est écrit
**THEN** les noms de fichiers portent cet horodatage en UTC
**AND** ils ne contiennent aucun caractère interdit dans un nom de fichier Windows

### Scénario 3 : Deux runs successifs ne s'écrasent pas
**GIVEN** un dossier destination contenant déjà le rapport d'un run précédent
**WHEN** un second rapport est écrit à un autre instant
**THEN** les quatre fichiers coexistent
**AND** le rapport du premier run est inchangé

### Scénario 4 : Le JSON porte sa version dès la première
**GIVEN** un résultat d'extraction quelconque
**WHEN** le rapport JSON est écrit
**THEN** il porte un champ de version de schéma
**AND** il porte un champ distinguant le rapport d'extraction de celui du re-tagging

### Scénario 5 : Un homonyme départagé est vérifiable
**GIVEN** un résultat où un homonyme a été départagé par la taille, un candidat de 5 Mo ayant été écarté au profit d'un candidat de 12 Mo
**WHEN** le rapport JSON est écrit
**THEN** il porte le chemin et la taille du fichier retenu
**AND** il porte le chemin et la taille du candidat écarté
**AND** il porte le critère de départage appliqué

### Scénario 6 : Les cinq catégories sont écrites
**GIVEN** un résultat portant à la fois des morceaux extraits, déjà présents, introuvables, des homonymes départagés et une copie en échec
**WHEN** le rapport JSON est écrit
**THEN** les cinq catégories y figurent
**AND** un décompte de chacune y figure également

### Scénario 7 : Le rapport est en anglais
**GIVEN** un résultat d'extraction
**WHEN** le rapport Markdown est écrit
**THEN** ses intitulés de sections et de colonnes sont en anglais
**AND** ils ne dépendent d'aucun réglage de langue

### Scénario 8 : Les titres non-ASCII restent lisibles
**GIVEN** un résultat portant un nom de fichier en cyrillique
**WHEN** le rapport JSON est écrit
**THEN** ce nom y apparaît tel quel, non échappé

### Scénario 9 : Sérialisation déterministe
**GIVEN** un même résultat, un même instant de génération et un même dossier destination
**WHEN** le rendu JSON est produit deux fois
**THEN** les deux chaînes sont identiques caractère pour caractère

### Scénario 10 : Dossier destination absent
**GIVEN** un chemin de dossier destination qui n'existe pas encore
**WHEN** le rapport est écrit
**THEN** le dossier est créé
**AND** les deux fichiers y sont déposés

## Tests à écrire

### Unit

- `sidecar/tests/unit/test_reports_json.py` :
  - deux fichiers sont produits et leurs chemins rendus à l'appelant
  - le nom porte l'horodatage fourni, en UTC
  - le nom ne contient aucun caractère interdit sous Windows
  - deux écritures à des instants différents produisent quatre fichiers distincts
  - le JSON porte un champ de version de schéma
  - le JSON porte un champ distinguant le rapport d'extraction du rapport de re-tagging
  - les cinq catégories du résultat figurent dans le JSON
  - les décomptes correspondent au contenu des cinq catégories
  - un homonyme départagé porte le chemin et la taille du fichier retenu, ceux du candidat écarté, et le critère
  - un nom de fichier non-ASCII apparaît non échappé
  - deux écritures du même résultat au même instant donnent des fichiers identiques
  - le dossier destination est créé s'il n'existe pas
  - les chemins écrits sont complets, le rapport restant local

- `sidecar/tests/unit/test_reports_markdown.py` :
  - les intitulés de sections sont en anglais
  - un homonyme départagé apparaît avec son fichier retenu, son candidat écarté et le critère
  - les cinq catégories apparaissent dans le rendu
  - un résultat sans homonyme ne produit pas de section de doublons vide
  - un nom de fichier non-ASCII apparaît intact

## Edge cases

- **Résultat entièrement vide** : un rapport est tout de même écrit, avec ses décomptes à zéro. Un run qui n'a rien extrait est précisément un cas où l'utilisateur cherche une trace.
- **Deux runs dans la même seconde** : l'horodatage étant à la seconde, deux rapports pourraient porter le même nom. Le cas n'est pas théorique : un run qui ne trouve que des fichiers déjà présents se termine en quelques millisecondes, et le relancer aussitôt écrasait le premier rapport (observé au `/verify` du sub-project 04). Le second couple prend un suffixe `-2`, `-3`… plutôt qu'une précision supérieure dans tous les noms.
- **Nom de fichier très long en destination** : le nom du rapport est court et fixe, seul le dossier destination peut porter le dépassement. L'échec remonte alors en `ReportWriteError`, erreur métier de code `report_write_failed` : les morceaux sont déjà extraits, seul le rapport manque, et la boucle NDJSON du sub-project 04 n'intercepte que les erreurs métier.
- **Homonyme avec plus de deux candidats** : tous les écartés sont consignés, pas seulement le premier.

## Architectural decisions

### Décision : Un couple de fichiers horodaté par run plutôt qu'un nom fixe écrasé

**Options envisagées :**
- **A. Nom horodaté, un couple de fichiers par run** : chaque run laisse une trace définitive. Cohérent avec ADR-018, qui qualifie le rapport de permanent et en fait la base de la relecture d'un run passé. Le dossier de travail accumule un couple de fichiers par run.
- **B. Nom fixe écrasé à chaque run** : le dossier reste propre et le chemin du rapport est prévisible sans le demander. Mais un second run efface la trace du premier, y compris les homonymes qu'il avait départagés.

**Choix : A**

**Rationale :**
- ADR-018 classe le rapport comme permanent et lui applique une politique de migration plutôt que de refus, précisément parce qu'il ne doit jamais devenir illisible ni disparaître
- La raison d'être du rapport, selon ADR-020, est de rendre vérifiable après coup un choix automatique : un rapport écrasé au run suivant ne remplit plus cette fonction
- Le chemin n'a pas besoin d'être prévisible : l'événement `extraction_finished` le porte à l'interface

### Décision : Écrire les cinq catégories du résultat, pas les trois nommées par ARCHITECTURE

**Options envisagées :**
- **A. Les cinq catégories** : extraits, déjà présents, introuvables, homonymes départagés, échecs de transfert. Le rapport dit tout ce qui s'est passé.
- **B. Les trois catégories d'ARCHITECTURE.md** : copiés, introuvables, doublons. Colle à la documentation existante, au prix du silence sur deux cas.

**Choix : A**

**Rationale :**
- Un fichier déjà présent et une copie en échec sont exactement ce qu'un utilisateur cherche quand un morceau manque dans son dossier de travail
- Les trois catégories d'ARCHITECTURE.md ont été écrites avant que le sub-project 02 n'établisse que le transfert pouvait échouer sans que le morceau soit introuvable
- Le sub-project 04 doit de toute façon étendre l'événement `extraction_finished` aux cinq catégories : le rapport et l'événement doivent dire la même chose

### Décision : Aucune fonction de migration dans ce sub-project

**Options envisagées :**
- **A. Poser le champ de version et rien d'autre** : le mécanisme de migration s'écrira au premier changement de schéma, quand il aura une version d'origine à migrer et un test qui la couvre.
- **B. Poser dès maintenant une machinerie de migration** : conforme à la lettre d'ADR-018, mais un point d'entrée qui ne migre rien ne peut être ni exercé ni vérifié.

**Choix : A**

**Rationale :**
- ADR-018 exige que le **champ de version** soit posé dès la première version ; il n'exige pas que les migrations existent avant d'avoir quoi que ce soit à migrer
- Une fonction de migration sans version antérieure ne se teste pas : elle serait du code non couvert dans un dépôt dont la couverture est un gate bloquant
- Le champ posé maintenant est ce qui rend la migration possible plus tard, et c'est tout ce dont la décision a besoin aujourd'hui
