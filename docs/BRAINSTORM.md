---
title: "BRAINSTORM : Vision & Idéation Projet"
description: "Vision de techno-tagger : application desktop de re-tagging et d'organisation de bibliothèque musicale pour DJ, consommatrice de l'API techno-scraper."
date: "2026-10-29"
keywords: ["brainstorm", "desktop", "tauri", "dj", "metadata", "tagging"]
scope: ["docs", "planning"]
technologies: ["Tauri", "Angular", "PrimeNG", "Tailwind CSS", "ngx-translate", "Python", "pydantic", "mutagen", "rapidfuzz", "httpx2", "keyring", "PyInstaller"]
---

# 🎯 Vision Projet

## Type de Projet

Application desktop mono-utilisateur (Tauri + Angular + sidecar Python), outil DJ, consommatrice de l'API [techno-scraper](https://techno-scraper.empiricmind.fr) déployée en prod.

## Nom du Projet

- **Nom lisible** : Techno Tagger
- **Repository Git** : `techno-tagger`
- **Remplace** : `BeatportScrapper-TrackTagger` (CLI Python, dépôt supprimé le 2026-10-28 une fois remplacé en entier)

## Description

Application de bureau qui automatise deux corvées du travail de préparation d'un set : extraire d'une grosse bibliothèque les morceaux d'une playlist pour les isoler dans un dossier de travail, et remplacer les métadonnées de ces fichiers par des données propres issues de Beatport et Bandcamp.

L'outil existe déjà en CLI Python, utilisable uniquement par son auteur. Le projet consiste à en faire une application distribuable à des amis DJ, avec une interface graphique, un pipeline parallélisé et un rattrapage manuel pour les cas que l'automatisation ne résout pas.

## Problème Résolu

Une bibliothèque de DJ accumule des fichiers téléchargés de partout, aux tags incohérents, absents ou faux. Les corriger à la main est irréaliste sur des milliers de titres, et les outils existants soit ne connaissent pas les sorties électroniques de niche, soit imposent leur propre écosystème.

**Pain Points** :

- La CLI actuelle exige d'éditer `constants/app_constants.py` avant chaque usage (chemins, seuils, clés de colonnes) : inutilisable par quelqu'un qui ne lit pas de Python
- Elle scrape Beatport directement, donc casse à chaque changement de structure du site
- Une seule source : quand Beatport ne connaît pas le titre, il n'y a aucune alternative et le fichier reste tel quel
- Le matching fuzzy est binaire et la confirmation se fait au clavier en ligne de commande, sans voir les candidats côte à côte
- Traitement séquentiel, aucun cache : un re-run repaie tout
- `fuzzywuzzy` (renommé TheFuzz) reste tributaire de `python-Levenshtein`, sous licence GPLv2, incompatible avec la distribution d'un binaire
- Aucun moyen de partager l'outil : pas de binaire, pas d'installeur, pas de mise à jour
- Aucune trace exploitable de ce qui a coincé, donc aucun moyen d'améliorer le matching

**Solution** :

Une application desktop en deux onglets (extraction par playlist, re-tagging) et des Réglages, qui délègue tout le scraping à l'API techno-scraper, enchaîne Beatport puis Bandcamp, demande un arbitrage à l'écran quand le score est ambigu et laisse coller une URL en dernier recours. Rien n'est écrit sur le disque avant une confirmation globale, et chaque run produit un rapport consultable.

---

# 🏗️ Architecture

## Type

Application desktop à trois couches, sans serveur ni port ouvert. Le « backend » est un process natif qui tourne sur la machine de l'utilisateur, à côté de la webview.

| Couche | Rôle |
|---|---|
| Angular + PrimeNG | Interface seule : sélection de dossiers, listes, modales d'arbitrage, progression, récapitulatif |
| Sidecar Python | Tout le métier : lecture/écriture des tags (mutagen), appels à techno-scraper, scoring rapidfuzz, copie ou déplacement de fichiers, renommage, rollback, plan de run, rapports |
| Tauri / Rust | Colle uniquement : `Command.sidecar()`, permissions, packaging, updater, instance unique, fenêtre sans décorations (barre de titre dans l'interface) |

La clé `X-API-Key` vit dans le process Python et ne touche jamais le JavaScript de la webview.

## Organisation Code

Dépôt unique, trois zones : `src/` (Angular), `sidecar/` (Python), `src-tauri/` (Rust). Le code Rust est une zone morte, tout le code écrit vit dans les deux premières.

> Arborescence détaillée : [ARCHITECTURE.md § Arborescence](ARCHITECTURE.md#arborescence).

## Contrat sidecar ↔ UI

Le sidecar est un process long lancé au démarrage, pas une invocation par action : commandes JSON sur `stdin`, flux d'événements NDJSON sur `stdout`. Imposé par la barre de progression et par le pipeline qui continue de tourner pendant qu'une modale attend une décision.

> Commandes et événements : [ARCHITECTURE.md § Backend > API](ARCHITECTURE.md#api). Justification : [ADR-005](adrs/005-sidecar-python-protocole-ndjson.md).

## Chaîne de résolution d'un morceau

Trois états après interrogation d'une source : **auto** (candidat au-dessus du seuil haut), **zone grise** (décision humaine dans une modale), **vide**.

**Bandcamp n'est jamais appelé spéculativement**, seulement au refus, au vide ou à l'indisponibilité de Beatport (Bandcamp ne valide alors jamais seul). Les échecs convergent vers « non résolu », rattrapé par saisie d'URL, juste après un refus ou en fin de run, SoundCloud n'étant accepté que là.

> Diagramme et états détaillés : [ARCHITECTURE.md § Chaîne de résolution](ARCHITECTURE.md#chaîne-de-résolution-dun-morceau). Justification de l'enchaînement : [ADR-009](adrs/009-enchainement-sources-et-arbitrage.md).

---

# 🛠️ Stack Technique Envisagée

## Backend (sidecar Python)

- Langage : Python
- Tags audio : **mutagen**, pur Python sans dépendance native, couvrant les quatre formats retenus, WAV compris. pytaglib (bindings TagLib C++) écrit les mêmes formats mais impose une dépendance native à empaqueter avec PyInstaller.
- Matching : **rapidfuzz**, successeur de fuzzywuzzy, MIT
- Client HTTP : **httpx2**, fork de maintenance de httpx repris par l'équipe Pydantic, en asyncio, pool de concurrence borné. Pas de curl_cffi, l'app n'appelle que sa propre API.
- Secrets : **keyring**, côté Python, pour que la clé API ne transite jamais par le JavaScript
- Protocole : **pydantic**, modèles des commandes et des événements NDJSON
- Packaging : **PyInstaller**, qui ne cross-compile pas : un binaire par plateforme, donc un seul tant qu'on reste sur Windows
- Outillage : uv, Ruff, Mypy strict, pytest (aligné sur techno-scraper)
- Monitoring : sentry-sdk
- Database : aucune. Le plan de run et le cache sont des fichiers.

## Frontend

- Type : Desktop
- Framework : **Angular**
- UI System : **PrimeNG**, dernière version (catalogue large, table à scroll virtuel pour les listes de 100 lignes), thème sombre permanent, **Tailwind CSS** pour la mise en page
- i18n : **ngx-translate**, FR et EN, bascule à l'exécution. Pas `@angular/localize`, qui traduit à la compilation et imposerait un build et un installeur par langue.
- Plugins Tauri : shell (sidecar), dialog (sélection de dossiers), store (préférences), os (locale système), updater, single-instance, opener, prevent-default (rechargement et menu contextuel coupés en release)
- Monitoring : @sentry/angular

> ⚠️ **PrimeNG n'est plus open source à partir de la v22** : Community License gratuite, conditions cumulatives vérifiées pour ce projet, clé de licence requise même en développement, Optimus UI (fork MIT de la v21) gardé comme porte de sortie. Cf. [ADR-003](adrs/003-primeng-community-license.md).

## Coquille

- **Tauri v2**, Rust réduit à l'initialisation des plugins dans `src-tauri/src/lib.rs`

## Infrastructure

- CI/CD : GitHub Actions, calqué sur techno-scraper (lint, typecheck, tests à chaque push ; build des bundles au tag)
- Versioning : release-please sur commits Conventional
- Distribution : GitHub Releases (installeur + manifeste de l'updater Tauri)
- Cibles : Windows seul au MVP. PyInstaller ne cross-compile pas, chaque plateforme ajoutée impose son propre runner en CI.

## Services Externes

- **techno-scraper** : seule source de données, via le domaine public et le header `X-API-Key`. Aucun scraping dans l'app.
- **Sentry** (plan Developer gratuit, région EU) : erreurs techniques uniquement, SDK durci pour que rien de personnel ne transite.

---

# 🚀 Features

## MVP

### Feature 1 : Onglet Playlist, extraction sélective

Isoler dans un dossier de travail les morceaux d'une playlist, pris dans une bibliothèque qui peut en compter des dizaines de milliers.

- Sélection d'un dossier source (sous-dossiers parcourus), d'un dossier destination et d'un fichier de playlist
- **Sélecteur de playlist** quand le fichier est un dump VLC : celui-ci contient toute la médiathèque, l'app liste donc les playlists présentes avec leur nombre de morceaux. Sans objet pour un M3U8, qui n'en contient qu'une.
- Toggle copier / déplacer, **copier par défaut** : la bibliothèque source reste intacte pendant que le re-tagging réécrit les fichiers de destination
- Un titre introuvable ou un transfert en échec est consigné dans le rapport et le traitement continue. Un fichier déjà présent à la destination n'est pas recopié.
- Barre de progression
- Rapport d'extraction écrit dans le dossier destination
- Fin d'extraction : signal sonore (désactivable) et toast, puis bouton « Passer au tagging » qui ouvre l'onglet Tagging sur le dossier extrait

**Deux formats, deux provenances :**

| Format | Provenance | Contenu |
|---|---|---|
| SQLite (`vlc_media.db`) | VLC Android, `Réglages > Avancé > Dump media database` | Dump de toute la médiathèque, pas un export de playlist : les listes sont dans des tables à joindre (`PlaylistMediaRelation`), avec des chemins Android |
| M3U8 | Rekordbox (clic droit sur la playlist, « export for music apps »), Traktor, foobar, VLC desktop | Une playlist, avec les chemins absolus de la machine d'origine |

Les deux sont nécessaires : **VLC Android n'a aucune fonction d'export de playlist**, le dump est sa seule sortie (les scripts tiers type `vlc-to-m3u` ne font rien d'autre que lire cette base). Le SQLite couvre le cas principal, playlist curée sur le téléphone ; le M3U8 couvre les autres DJ.

**Résolution par nom de fichier, pas par chemin** : la base vient du téléphone, les fichiers sont sur le PC. Deux fichiers de même nom, le plus volumineux est retenu et le cas consigné dans le rapport ([ADR-020](adrs/020-doublons-noms-de-fichiers.md)). Détail du flux : [ARCHITECTURE.md § Use-case 1](ARCHITECTURE.md#use-case-1--extraction-sélective-par-playlist).

### Feature 2 : Onglet Tagging, pipeline de re-tagging

- Sélection d'un dossier (typiquement la destination de l'onglet Playlist, préremplie avec la dernière utilisée)
- La requête envoyée à l'API est construite depuis les tags ID3 artiste et titre ; s'ils sont vides ou inexploitables, on retombe sur le nom de fichier nettoyé
- Interrogation de Beatport, puis de Bandcamp si Beatport ne renvoie rien ou est indisponible, ou si tu refuses ses candidats (cf. § Chaîne de résolution)
- Scoring rapidfuzz des candidats, avec des seuils réglables dans les Settings
- Pool asyncio borné : plusieurs morceaux en vol simultanément, le débit restant tenu par l'API
- Cache disque des réponses de l'API et des pochettes téléchargées, TTL 30 jours, plafond 500 Mo en éviction LRU
- Liste scrollable affichant `Artiste - Titre`, la source, le score et un état par ligne : vert validé (coche), rouge sans correspondance (croix) ou échec d'écriture, bleu en attente d'arbitrage (i), gris en attente ou restauré ; le motif d'un échec s'affiche au survol
- Barre de progression, **signal sonore de fin** (désactivable) et toast : une seule fois par phase longue (extraction, phase réseau, écriture, restauration), pas par arbitrage
- Un run s'interrompt depuis l'écran, sans fermer l'application, pour qu'un dossier lancé par erreur cesse de consommer le quota de l'API : les morceaux déjà résolus gardent leurs résultats, les autres passent en « Non traité »
- Un seul bouton d'action dont le rôle suit la phase : lancer, interrompre, confirmer l'écriture, relancer l'écriture

### Feature 3 : Arbitrage utilisateur

Le pipeline ne s'arrête jamais. Les morceaux ambigus s'empilent en file, la modale s'ouvre dès qu'il y en a un et qu'aucune n'est déjà ouverte.

- En haut de la modale, le morceau à identifier ; en dessous, **les candidats en zone grise uniquement**, avec leur score. Cinq résultats renvoyés dont trois en zone grise : on affiche les trois.
- Sélection d'un candidat, ou choix explicite « aucune correspondance »
- Le refus déclenche l'appel Bandcamp, et **sa liste remplace celle de Beatport** dans la même fenêtre, l'en-tête indiquant la bascule et un lien discret permettant de revenir en arrière
- Beatport indisponible : la liste Bandcamp s'ouvre d'emblée avec un bandeau qui le dit, sans validation automatique
- Si Bandcamp ne renvoie rien : message dans la modale, une seule action pour passer à l'étape lien
- Le refus de tous les candidats ouvre une étape lien dans la même modale : coller une URL (Feature 4) ou passer, le morceau restant rattrapable en fin de run
- Navigation entre les arbitrages en attente par flèches, avec compteur (1/3, 2/3), la file se réduisant au fil des décisions
- Fermeture possible par la croix, l'arbitrage restant en file, et un badge de la barre d'onglets rouvre la modale
- Tentative de quitter pendant une extraction, une écriture ou une restauration : modale de confirmation qui nomme le travail. L'extraction se quitte après confirmation, l'écriture et la restauration retiennent la fenêtre. Un run en cours, ses arbitrages et un run non confirmé ne retiennent rien : le plan de run les propose à la reprise (Feature 6).

### Feature 4 : Rattrapage par URL manuelle

L'app propose de résoudre à la main les morceaux restés sans correspondance, dès le refus d'un arbitrage ou à la toute fin du run, avant la confirmation globale.

- Champ de saisie d'URL par morceau, acceptant Beatport, Bandcamp et SoundCloud, dans une modale ouverte depuis la ligne du morceau ou par un badge de la barre d'onglets (compteur de morceaux à rattraper, navigation de l'un à l'autre)
- L'URL est résolue via les routes correspondantes de l'API ; recoller un lien sur un morceau déjà rattrapé remplace le précédent avant l'écriture
- Barre de progression sur cette phase également
- Étape entièrement facultative, on peut la passer

### Feature 5 : Écriture des tags et renommage

Aucun fichier n'est modifié avant la confirmation globale de fin de run, une modale qui nomme le dossier et chiffre les morceaux à écrire, les non résolus et les arbitrages en attente. L'écriture est purement locale et dure quelques secondes, les pochettes ayant été téléchargées et mises en cache pendant la phase réseau. Un fichier en échec n'arrête pas les suivants : l'écriture des seuls fichiers en échec se relance sans réseau ni arbitrage.

Principe : **on écrit tout ce que l'API renvoie**. La CLI actuelle écrivait dix champs, le contrat `Track` en expose davantage.

**Formats supportés** : MP3, WAV, AIFF et FLAC, contre MP3 seul dans la CLI actuelle. Deux systèmes de tags, ID3v2 et Vorbis comments, tous deux couverts par mutagen. Le WAV est le maillon faible, son support en lecture variant selon les logiciels DJ.

La couverture des sources est très asymétrique, Beatport remplissant tout le contrat quand Bandcamp ne donne que le socle d'identité. L'écriture se construit donc à partir de ce qui est présent, sans jamais supposer un champ, et **un champ `null` ne touche pas au tag existant** : c'est ce qui rend un tagging Bandcamp non destructif.

Renommage après l'écriture, jamais avant. Dump JSON des tags d'origine avant réécriture, avec rollback par run (onglet Tagging, ou dernier run depuis les Réglages) ou par morceau (ligne dépliée). Le rollback rend les champs de la table et le nom d'origine, pas la pochette posée ni les commentaires retirés, et le dump n'est conservé que 30 jours (cf. Feature 6).

La ligne dépliée de la liste du run compare avant et après champ par champ selon la table de correspondance, pochette en grand, lien vers la fiche source et bouton de restauration du morceau (DESIGN.md § Tables et listes, « Détail avant / après »).

> Table de correspondance complète des champs, conventions Vorbis et règles de titre : [ADR-011](adrs/011-politique-ecriture-tags.md).

### Feature 6 : Plan de run, reprise et rapport

- Chaque décision (validation auto, arbitrage, URL manuelle, abandon) est écrite au fil de l'eau dans un plan JSON, dans le répertoire de données de l'app (`appLocalDataDir()`), pas dans le dossier de musique
- Un run interrompu est détecté au lancement suivant : « Run du 2 août sur `D:\Sets\Août`, 62/100 traités, reprendre ou repartir de zéro ? ». Aucun fichier n'a été touché entre-temps. Un plan d'une autre version ou illisible ne laisse que « repartir de zéro », un dossier introuvable ajoute « Plus tard » (ADR-018).
- Purge automatique au démarrage : plans des runs confirmés supprimés, puis plans, dumps de tags et exports de feedback au-delà de 30 jours, un run interrompu restant reprenable dans cette limite
- Écran récapitulatif dans l'app, ouvert par le bouton « Récapitulatif » de l'onglet Tagging : tableau filtrable (tout, validés, arbitrés, échecs) avec recherche texte, avant/après par morceau, lien vers la fiche source. Les runs passés se rouvrent depuis les Réglages.
- **Deux rapports distincts**, celui de l'extraction dans le dossier destination, celui du re-tagging dans le dossier du run (le dossier re-tagué), chacun en deux formats : JSON (source de vérité, relu par l'app pour rouvrir un run passé) et Markdown (lisible hors application), rédigés en anglais quelle que soit la langue de l'interface
- Le rapport de re-tagging détaille par morceau : requête envoyée, source ayant répondu, décision et son origine, champs écrits, ancien et nouveau nom de fichier, erreurs

### Feature 7 : Settings

- Clé `X-API-Key` saisie par l'utilisateur, jamais relue ensuite, stockée via le trousseau de l'OS. Le lancement du re-tagging est bloqué sans clé. Un run s'arrête sur une clé refusée (trois refus consécutifs), avec renvoi aux Réglages.
- Langue : FR ou EN. Au premier lancement, la locale système est lue via le plugin OS de Tauri (`locale()`, format BCP-47) : commence par `fr` donne du français, tout le reste donne de l'anglais. Le sélecteur permet de forcer l'une ou l'autre ensuite.
- Seuils de matching (validation automatique, zone grise), réinitialisables aux valeurs par défaut du sidecar
- Signal sonore de fin
- Bouton « ouvrir le dossier de logs », pour récupérer une trace à distance
- Bouton « vider le cache », taille affichée, refusé tant que le run courant attend son écriture
- Restauration du dernier run, dont la confirmation nomme le run visé (Feature 5)
- Sélecteur de runs passés, pour rouvrir leur récapitulatif (Feature 6)
- Version installée et recherche manuelle de mise à jour (Feature 8)

### Feature 8 : Distribution et mise à jour

- Installeur Windows produit par la CI au tag, publié sur les GitHub Releases
- Updater Tauri intégré : vérification d'un manifeste au démarrage et à la demande depuis les Réglages, proposition de mise à jour en modale que rouvre un badge de la barre d'onglets, bundles signés avec la paire de clés Tauri
- Jamais d'installation pendant un travail en cours : l'installeur ferme l'application. Un échec d'installation est détecté au lancement suivant et remonté à Sentry.
- Une clé API distincte par utilisateur, révocable individuellement

### Feature 9 : Monitoring

- Sentry actif d'office, erreurs techniques uniquement (sidecar qui tombe, parsing cassé), SDK durci : variables locales des frames désactivées, nom de machine fixé, chemins scrubbés
- Scrubbing des chemins de fichiers dans les stack traces (ils contiennent le nom d'utilisateur de l'OS)
- Aucun titre de morceau envoyé automatiquement : les cas d'arbitrage et d'échec restent dans le rapport local
- Bouton « envoyer ce rapport pour améliorer le matching » dans l'écran final, run courant ou passé : geste explicite de l'utilisateur, qui ne consomme pas le quota Sentry. Il ouvre dans le navigateur, via le plugin `opener`, une issue pré-remplie du dépôt et révèle dans l'Explorateur un export nettoyé du run (ni dossier ni chemin absolu) à y joindre : l'application ne pousse rien elle-même, l'utilisateur relit, joint ou abandonne avant de valider (cf. [ARCHITECTURE.md § Alerts](ARCHITECTURE.md#alerts))

## Post-MVP

### Feature 1 : Démo web publique

Démo interactive de l'application dans un navigateur, ouverte dans un nouvel onglet par le bouton « Voir la démo » du portfolio, sur `demo-techno-tagger.thibaud-geisler.com`.

- **Rejeu d'un run enregistré** : le vrai sidecar joue chaque branche du parcours sur une bibliothèque fictive face à un faux techno-scraper, l'interface rejoue ses réponses NDJSON. Hors scénario : les saisies libres (URL, seuils). Le rattrapage par URL n'est joué que sur un morceau, lien pré-rempli
- Aucun sidecar ni clé API, aucun appel à techno-scraper : le visiteur ne peut ni choisir un dossier à lui ni rien envoyer. Les sélecteurs de fichiers renvoient des chemins de démo
- **Données fictives de bout en bout**, pochettes générées comprises : les CGU Beatport réservent métadonnées et pochettes à un usage personnel (relevé du 2026-10-25). Une douzaine de morceaux, un par cas à montrer
- Bandeau permanent : démo, données fictives, application privée non affiliée à Beatport ni Bandcamp, liens « Me contacter » et « Recommencer la démo ». Aucun lien de téléchargement
- Langue reçue du portfolio par `?lang=fr|en`, bascule FR / EN dans les Réglages
- Fichiers statiques dans un container durci et isolé sur le réseau, redéployé par la CI à chaque tag
- Prérequis côté portfolio, dans son dépôt : `?lang` sur le bouton, nouvel onglet, pages de contact FR et EN

> Livrée le 2026-10-26 avec la release 1.1.0 (cf. [PRODUCTION.md](PRODUCTION.md#-environnements)). Faisabilité étudiée le 2026-10-25. Rejeu, isolation et déploiement : [ADR-023](adrs/023-demo-web-par-rejeu.md).

### Feature 2 : Compatibilité des tags avec les logiciels DJ

Ce que Rekordbox ne lit pas encore, relevé le 2026-10-23 ([knowledges/rekordbox.md](knowledges/rekordbox.md)) :
- **WAV** : seul le RIFF `LIST/INFO` est lu, jamais le chunk ID3. Un WAV tagué s'affiche avec son nom de fichier pour titre, sans artiste. mutagen n'écrit pas ce bloc : écriture maison, sauvegarde de restauration comprise
- **Remixeur FLAC** : `REMIXER` n'est pas lu, le bon nom est à trancher par un import de variantes
- **Nom du mix** : `TIT3` n'est pas écrit, la version reste dans le titre
- **Date de sortie** : seule l'année est écrite, Rekordbox lit une date complète dans `TDRL`

Traktor, Serato et Engine DJ restent à relever.

### Feature 3 : Édition manuelle des tags

Formulaire dans l'application pour corriger un champ à la main quand aucune source ne convient et qu'aucune URL n'existe.

### Feature 4 : Tests bout-en-bout

Pilotage de l'application empaquetée via WebdriverIO et `tauri-driver`, le WebDriver officiel de Tauri.

Rien au MVP : le contrat NDJSON est déjà testable en ligne de commande sans interface, ce qui couvre le vrai risque du projet. Un e2e complet impose un runner Windows dédié en CI et des tests lents, pour valider une UI à deux écrans.

Justifié le jour où l'application est distribuée à plusieurs personnes et où une régression de la chaîne UI vers sidecar cesse d'être détectable à l'œil, et dans tous les cas avant l'agent IA, qui modifie la chaîne de décision.

### Feature 5 : Agent IA d'arbitrage (PydanticAI)

**En renfort du fuzzy, pas à sa place.** Le scoring rapidfuzz reste le moteur, l'agent est un mode activable dans les Settings, désactivé par défaut, qui intervient là où le fuzzy s'arrête. Sans clé API renseignée, l'application se comporte exactement comme au MVP.

Deux points d'insertion dans la chaîne :

- **Zone grise**, avant d'ouvrir la modale : l'agent reçoit le morceau et les candidats, et tranche. Certain, il valide et tu n'es pas interrompu. Hésitant, la modale s'ouvre quand même, avec son candidat recommandé et sa justification.
- **Non résolu**, avant la phase URL : l'agent peut reformuler la requête (orthographe approximative, translittération, artiste mal découpé) et relancer une recherche plutôt que d'abandonner.

Implique une section Settings dédiée : clé API du fournisseur (chacun met la sienne) et sélection du modèle. La liste des modèles proposés ne doit pas être codée en dur, sous peine de maintenance à chaque sortie. Mécanisme à définir au moment de l'implémentation.

> **Reporté ici depuis la Feature 7** (décomposition du 2026-10-14) : la rangée « Mode agent IA » des Réglages, que la maquette posait en bascule désactivée « Indisponible au MVP » dans `ui_kits/techno-tagger/SettingsScreen.jsx`. Elle sort de la maquette du MVP et revient avec cette feature.

Pas de n8n : l'orchestration reste dans le sidecar, PydanticAI côté Python.

### Feature 6 : macOS et Linux

Deuxième et troisième cibles de distribution, à ajouter le jour où un utilisateur le demande vraiment.

macOS est la plus coûteuse : un runner macOS en CI (minutes facturées x10 sur un dépôt privé), un second build PyInstaller à maintenir, et surtout la notarisation. Sans Apple Developer Program à 99 $/an, l'app se distribue quand même mais **Gatekeeper la bloque au premier lancement**. Depuis macOS Sequoia, le contournement par Contrôle-clic ne suffit plus à cette première ouverture : l'utilisateur doit passer par Réglages Système > Confidentialité et sécurité, choisir « Ouvrir quand même » et s'authentifier comme administrateur. Les lancements suivants redeviennent normaux. Le compte Apple gratuit ne résout rien, ses certificats sont limités au développement local et ne permettent pas la notarisation.

Linux est indolore par comparaison : runner GitHub gratuit, aucune signature exigée.

### Feature 7 : Formats de playlist supplémentaires

Parsing du TXT Rekordbox, destiné à KUVO et donc orienté affichage : ses colonnes dépendent de la langue d'export, il faudrait rendre leurs clés configurables. Et du XML, qui exporte la collection entière et non une playlist.

### Feature 8 : Réduire les faux positifs antivirus

Le sidecar PyInstaller non signé est le mode de panne le plus probable chez un utilisateur (PRODUCTION.md § Benchmarks) : mis en quarantaine, il laisse l'application sur son écran bloquant. Mesure de la première recette : ni blocage ni quarantaine chez un utilisateur réel, à l'installation comme à la mise à jour, installeur v0.11.0 à 0/68 sur VirusTotal, mais `tagger.exe` à 4/71 dont Microsoft Defender (`Trojan:Win32/Wacatac.B!ml`, détection par machine learning), faux positif déclaré à Microsoft (2026-10-21).

Pistes relevées le 2026-10-15, à trancher par un ADR le jour où la feature est prise :
- Microsoft Store en MSIX : gratuit, re-signé par Microsoft, sans avertissement SmartScreen ; mises à jour par le Store à la place de l'updater, emballage MSIX en CI, certification à chaque version
- Certificat Certum Open Source : dès 49 €, au nom civil du propriétaire, affiché dans chaque binaire
- Bootloader PyInstaller recompilé en CI : gratuit, efficace contre les seules détections par signature
- Certificat OV : 150 à 300 $ par an

SignPath Foundation est écartée : elle refuse tout composant non open source (PrimeNG v22) et exige une réputation vérifiable du projet. Une signature ne retire pas l'avertissement SmartScreen, qui suit la réputation des téléchargements.

### Feature 9 : Canal beta

Pré-release GitHub publiée sur un manifeste updater distinct, pour installer une mise à jour sur une machine avant de la pousser à tout le monde.

Rien à mettre en place tant que la distribution ne s'élargit pas : le canal se justifie le jour où un bug de mise à jour toucherait des utilisateurs qui ne savent pas revenir en arrière.

---

# ⚠️ Contraintes

## Business

- Budget mensuel : nul. Sentry sur le plan gratuit, GitHub Releases pour la distribution, l'API tourne sur un VPS déjà payé. La seule dépense possible, l'Apple Developer Program à 99 $/an, est écartée avec le report de macOS en Post-MVP.
- Timeline MVP : aucune deadline, projet personnel.
- Équipe : 1 personne.
- Utilisateurs : l'auteur et quelques amis DJ. Aucune ambition commerciale, aucun multi-tenant.

## Technique

- **Performance** : un run type traite 100 morceaux. Le débit est tenu par techno-scraper, pas par l'application ; le pool de concurrence doit rester borné pour ne pas la saturer. Le cache évite de repayer un re-run sur le même dossier.
- **Scalabilité** : sans objet, application locale mono-utilisateur.
- **Sécurité** : la clé API ne transite jamais par la webview, elle vit dans le sidecar et est stockée dans le trousseau de l'OS. Aucune donnée personnelle ne quitte la machine : le SDK Sentry est durci, et l'envoi du rapport reste un geste manuel.
- **Intégrité des fichiers** : rien n'est écrit avant confirmation globale, les tags d'origine sont sauvegardés avant réécriture, et la phase d'écriture est séparable et testable sans réseau ni interface.
- **Packaging** : c'est le vrai coût du projet, et le limiter à Windows au MVP le rend indolore. Le binaire du sidecar doit porter le suffixe target-triple (`tagger-x86_64-pc-windows-msvc.exe`), Tauri refuse de bundler sans. Un installeur non signé déclenche l'avertissement SmartScreen, contournable en deux clics.

---

# ❓ Questions Ouvertes

> Les questions tranchées vivent dans [docs/adrs/](adrs/).

## Techniques

- **Seuils de matching par défaut** : les valeurs de la CLI actuelle sont-elles transposables, sachant que le contrat de sortie de l'API a changé ? À recalibrer aux premiers runs réels (cf. [ADR-008](adrs/008-matching-rapidfuzz-et-agent-ia.md))
- **Maturité de PyInstaller sur macOS** : à vérifier le jour où la cible macOS revient au programme
- **Sélection des modèles LLM (Post-MVP)** : comment proposer une liste à jour sans la coder en dur ni la maintenir à chaque sortie de modèle ?

## Business

- Combien d'utilisateurs réels, donc combien de clés API à gérer et à révoquer ?
- Un pote est-il réellement sur Mac ? C'est ce qui déclenchera la cible macOS, et avec elle la question des 99 $/an

---

# 📝 Notes & Décisions

**Décisions actées :**

- **Décision Coquille** : Tauri v2 vs Electron ([ADR-001](adrs/001-coquille-desktop-tauri.md))
- **Décision Framework UI** : Angular vs React + Next.js ([ADR-002](adrs/002-framework-ui-angular.md))
- **Décision Lib UI** : PrimeNG dernière version vs Angular Material vs PrimeNG 21, dernière MIT ([ADR-003](adrs/003-primeng-community-license.md))
- **Décision Client HTTP** : httpx2 vs httpx vs curl_cffi ([ADR-007](adrs/007-client-http-httpx2.md))
- **Décision Stockage de la clé API** : keyring côté Python vs plugin Tauri stronghold ([ADR-012](adrs/012-securite-cle-api-keyring.md))
- **Décision Clé API** : une clé par utilisateur saisie dans les Settings vs clé partagée embarquée ([ADR-012](adrs/012-securite-cle-api-keyring.md))
- **Décision Métier** : sidecar Python vs réécriture en Rust ([ADR-005](adrs/005-sidecar-python-protocole-ndjson.md))
- **Décision Matching** : rapidfuzz au MVP, agent IA en Post-MVP en renfort et non en remplacement ([ADR-008](adrs/008-matching-rapidfuzz-et-agent-ia.md))
- **Décision Orchestration IA** : PydanticAI dans le sidecar vs agent n8n par webhook ([ADR-008](adrs/008-matching-rapidfuzz-et-agent-ia.md))
- **Décision Matching lib** : rapidfuzz vs fuzzywuzzy ([ADR-008](adrs/008-matching-rapidfuzz-et-agent-ia.md))
- **Décision Scraping** : délégué à techno-scraper vs intégré à l'app ([ADR-006](adrs/006-scraping-delegue-techno-scraper.md))
- **Décision Sources** : Beatport puis Bandcamp en automatique, SoundCloud en URL manuelle seulement ([ADR-009](adrs/009-enchainement-sources-et-arbitrage.md))
- **Décision Enchaînement des sources** : modale à deux temps vs appel Bandcamp spéculatif vs seconde modale après remise en file ([ADR-009](adrs/009-enchainement-sources-et-arbitrage.md))
- **Décision Candidats affichés** : zone grise seulement vs tous les résultats avec leur score ([ADR-009](adrs/009-enchainement-sources-et-arbitrage.md))
- **Décision i18n** : ngx-translate vs Transloco vs `@angular/localize` ([ADR-004](adrs/004-i18n-ngx-translate.md))
- **Décision Formats playlist** : VLC SQLite + M3U8 vs TXT Rekordbox (le M3U8 couvre Rekordbox, Traktor, foobar et VLC avec un seul parser ; le TXT dépend de la langue d'export, donc fragile)
- **Décision Copy/Move** : toggle avec copie par défaut vs déplacement (la bibliothèque source reste intacte pendant que le re-tagging réécrit les fichiers ; une ligne de différence à l'implémentation)
- **Décision Requête de recherche** : tags ID3 avec repli sur le nom de fichier vs nom de fichier seul (couvre aussi bien les fichiers déjà à peu près taggés que les téléchargements sauvages nommés `track01.mp3`)
- **Décision Écriture** : batch final avec plan persisté au fil de l'eau vs écriture immédiate ([ADR-010](adrs/010-ecriture-batch-et-plan-de-run.md))
- **Décision Emplacement du plan** : `appLocalDataDir()` vs dossier destination ([ADR-010](adrs/010-ecriture-batch-et-plan-de-run.md))
- **Décision Arbitrage** : pipeline qui continue en fond vs mise en pause (le flux d'événements NDJSON est de toute façon imposé par la barre de progression ; une fois là, continuer en fond coûte quelques dizaines de lignes et masque le temps d'arbitrage derrière le temps réseau)
- **Décision Formats de fichiers** : MP3, WAV, AIFF et FLAC vs MP3 seul comme la CLI actuelle ([ADR-011](adrs/011-politique-ecriture-tags.md))
- **Décision Champs écrits** : tout ce que l'API renvoie, sans cases à cocher ([ADR-011](adrs/011-politique-ecriture-tags.md))
- **Décision Champs absents** : un `null` ne touche pas au tag existant vs écrasement systématique ([ADR-011](adrs/011-politique-ecriture-tags.md))
- **Décision Cache** : TTL 30 jours et plafond 500 Mo en éviction LRU ([ADR-013](adrs/013-cache-disque-jetable.md))
- **Décision Rapport** : JSON + Markdown vs Markdown seul ([ADR-014](adrs/014-observabilite-sentry-et-rgpd.md))
- **Décision Monitoring** : Sentry pour les crashs uniquement vs événements métier ([ADR-014](adrs/014-observabilite-sentry-et-rgpd.md))
- **Décision vie privée** : durcissement du SDK plutôt que consentement ([ADR-014](adrs/014-observabilite-sentry-et-rgpd.md))
- **Décision Cibles** : Windows seul au MVP, macOS et Linux en Post-MVP ([ADR-015](adrs/015-cibles-distribution-windows.md))
- **Décision Compatibilité DJ en tête du Post-MVP** (2026-10-23) : avant l'édition manuelle (un WAV tagué reste illisible dans Rekordbox, format courant chez les DJ)
- **Décision Tonalité FLAC** (2026-10-23) : `KEY` et `INITIALKEY` avec la même valeur vs `INITIALKEY` seul ([ADR-011](adrs/011-politique-ecriture-tags.md))
- **Décision Ordre du Post-MVP** : édition manuelle, tests bout-en-bout puis agent IA vs agent IA en premier (l'édition manuelle comble à moindre coût le dernier trou de la chaîne de résolution ; le filet e2e précède l'agent IA, plus gros changement de comportement à venir ; macOS et Linux, formats de playlist, faux positifs antivirus et canal beta suivent la demande ; les faux positifs n'ont bloqué aucun utilisateur à la recette du 2026-10-21, d'où leur place parmi ces derniers)
- **Décision Démo web en tête du Post-MVP** (2026-10-25) : avant la compatibilité DJ (vitrine du portfolio sans dépendance aux autres features : elle rejoue le comportement existant)
- **Décisions Démo web** (2026-10-25) : rejeu d'un run enregistré vs sidecar sur le serveur vs sidecar dans le navigateur via Pyodide, données fictives, image construite en CI, projet Dokploy dédié, rattrapage par URL sur un seul morceau, lien « Me contacter » plutôt que téléchargement ([ADR-023](adrs/023-demo-web-par-rejeu.md))
- **Décision Dépôt** : dépôt neuf vs évolution de `BeatportScrapper-TrackTagger` (la CLI sert de référence à lire, rien n'est porté tel quel, l'arborescence à plat ne correspond pas à la structure Tauri)

**Principes directeurs :**

- L'application ne scrape rien elle-même. Toute donnée vient de techno-scraper, seule surface à réparer quand un site change.
- Aucun fichier n'est modifié sans confirmation explicite, et les champs de tags d'origine restent récupérables le temps de la rétention du dump (30 jours).
- Le dossier de cache est jetable par définition : le supprimer ne doit jamais casser un run.
- **Ce n'est pas un produit.** Pas de multi-tenant, pas de compte, pas de facturation, jamais.

**Références :**

- [Tauri v2 : Sidecar](https://v2.tauri.app/develop/sidecar/)
- [Tauri v2 : Plugins](https://v2.tauri.app/plugin/)
- [techno-scraper : README](https://github.com/thibaud57/techno-scraper/blob/HEAD/README.md) : routes, contrat `Page[T]`, sémantique des erreurs
- [techno-scraper : ADR-002](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/002-api-gateway-bas-niveau.md) : ni fallback ni matching côté API, cette logique appartient aux consommateurs
- [techno-scraper : ADR-006](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/006-schema-track-normalise.md) : schéma `Track` normalisé, base des champs écrits
