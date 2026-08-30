---
title: "BRAINSTORM — Vision & Idéation Projet"
description: "Vision de techno-tagger : application desktop de re-tagging et d'organisation de bibliothèque musicale pour DJ, consommatrice de l'API techno-scraper."
date: "2026-08-02"
keywords: ["brainstorm", "desktop", "tauri", "dj", "metadata", "tagging"]
scope: ["docs", "planning"]
technologies: ["Tauri", "Angular", "PrimeNG", "ngx-translate", "Python", "mutagen", "rapidfuzz", "httpx2", "PyInstaller"]
---

# 🎯 Vision Projet

## Type de Projet

Application desktop mono-utilisateur (Tauri + Angular + sidecar Python), outil DJ, consommatrice de l'API [techno-scraper](https://techno-scraper.empiricmind.fr) déployée en prod.

## Nom du Projet

- **Nom lisible** : Techno Tagger
- **Repository Git** : `techno-tagger`
- **Remplace** : `BeatportScrapper-TrackTagger` (CLI Python, dépôt distinct conservé en lecture seule)

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

Une application desktop en deux onglets (déplacement par playlist, re-tagging), qui délègue tout le scraping à l'API techno-scraper, enchaîne Beatport puis Bandcamp, demande un arbitrage à l'écran quand le score est ambigu, et laisse coller une URL en dernier recours. Rien n'est écrit sur le disque avant une confirmation globale, et chaque run produit un rapport consultable.

---

# 🏗️ Architecture

## Type

Application desktop à trois couches, sans serveur ni port ouvert. Le « backend » est un process natif qui tourne sur la machine de l'utilisateur, à côté de la webview.

| Couche | Rôle |
|---|---|
| Angular + PrimeNG | Interface seule : sélection de dossiers, listes, modales d'arbitrage, progression, récapitulatif |
| Sidecar Python | Tout le métier : lecture/écriture des tags (mutagen), appels à techno-scraper, scoring rapidfuzz, déplacement de fichiers, plan de run |
| Tauri / Rust | Colle uniquement : `Command.sidecar()`, permissions, packaging, updater |

La clé `X-API-Key` vit dans le process Python et ne touche jamais le JavaScript de la webview.

## Organisation Code

Dépôt unique, trois zones : `src/` (Angular), `sidecar/` (Python), `src-tauri/` (Rust). Le code Rust est une zone morte, tout le code écrit vit dans les deux premières.

> Arborescence détaillée : [ARCHITECTURE.md § Arborescence](ARCHITECTURE.md#arborescence).

## Contrat sidecar ↔ UI

Le sidecar est un process long lancé au démarrage, pas une invocation par action : commandes JSON sur `stdin`, flux d'événements NDJSON sur `stdout`. Imposé par la barre de progression et par le pipeline qui continue de tourner pendant qu'une modale attend une décision.

> Commandes et événements : [ARCHITECTURE.md § Backend > API](ARCHITECTURE.md#api). Justification : [ADR-005](adrs/005-sidecar-python-protocole-ndjson.md).

## Chaîne de résolution d'un morceau

Trois états après interrogation d'une source : **auto** (candidat au-dessus du seuil haut), **zone grise** (décision humaine), **vide**.

```
requête = tags ID3 (repli : nom de fichier nettoyé)
   │
Beatport ──► auto ? ──oui──► VALIDÉ
     │ non
     ├── vide ──► Bandcamp (en fond, pipeline)
     │              ├─ auto ──► VALIDÉ
     │              ├─ zone grise ──► MODALE (candidats Bandcamp)
     │              └─ vide ──► NON RÉSOLU
     │
     └── zone grise ──► MODALE, temps 1 : candidats Beatport
                          ├─ choix ──► VALIDÉ           (Bandcamp jamais appelé)
                          └─ « aucune » ──► appel Bandcamp déclenché ici
                                 │
                          MODALE, temps 2 : la liste Bandcamp remplace la liste Beatport
                                 ├─ choix ──► VALIDÉ
                                 └─ « aucune » ou vide ──► NON RÉSOLU
                                                                │
   fin de run : saisie d'URL sur tous les NON RÉSOLUS ◄─────────┘
   puis confirmation globale ──► écriture des tags, pochettes, renommage ──► rapport
```

**Bandcamp n'est jamais appelé spéculativement** : l'appel ne part qu'au refus des candidats Beatport, la modale restant ouverte pendant ce temps. Les trois causes d'échec convergent vers un seul état, « non résolu », que la phase URL rattrape. SoundCloud n'est accepté qu'en saisie d'URL.

> Justification de l'enchaînement : [ADR-009](adrs/009-enchainement-sources-et-arbitrage.md).

---

# 🛠️ Stack Technique Envisagée

## Backend (sidecar Python)

- Langage : Python
- Tags audio : **mutagen**, pur Python sans dépendance native, couvrant les quatre formats retenus, WAV compris. pytaglib (bindings TagLib C++) écrit les mêmes formats mais impose une dépendance native à empaqueter avec PyInstaller.
- Matching : **rapidfuzz**, successeur de fuzzywuzzy, MIT
- Client HTTP : **httpx2**, fork de maintenance de httpx repris par l'équipe Pydantic, en asyncio, pool de concurrence borné. Pas de curl_cffi, l'app n'appelle que sa propre API.
- Secrets : **keyring**, côté Python, pour que la clé API ne transite jamais par le JavaScript
- Packaging : **PyInstaller**, qui ne cross-compile pas : un binaire par plateforme, donc un seul tant qu'on reste sur Windows
- Outillage : uv, Ruff, Mypy strict, pytest (aligné sur techno-scraper)
- Monitoring : sentry-sdk
- Database : aucune. Le plan de run et le cache sont des fichiers.

## Frontend

- Type : Desktop
- Framework : **Angular**
- UI System : **PrimeNG**, dernière version (catalogue large, table à scroll virtuel pour les listes de 100 lignes)
- i18n : **ngx-translate**, FR et EN, bascule à l'exécution. Pas `@angular/localize`, qui traduit à la compilation et imposerait un build et un installeur par langue.
- Plugins Tauri : shell (sidecar), dialog (sélection de dossiers), fs, store (préférences), os (locale système), updater
- Monitoring : @sentry/angular

> ⚠️ **PrimeNG n'est plus open source à partir de la v22** (dépôt archivé fin juin 2026, bascule sous licence PrimeUI ; la v21 et les antérieures restent MIT). La **Community License** est gratuite et couvre ce projet, sous quatre conditions cumulatives : moins d'1 M$ de revenus annuels, moins de 5 développeurs, moins de 10 employés, et jamais plus de 3 M$ de capital-risque reçu. Aucune limitation fonctionnelle sur la bibliothèque centrale, mais le Theme Designer et les composants Pro n'y sont pas. Conséquences : une clé à poser dans `providePrimeNG({ license: ... })`, donc embarquée dans le bundle distribué ; un renouvellement gratuit tous les 12 mois avec 30 jours de grâce ; et **les erreurs de licence ne s'affichent pas sur localhost**, donc un oubli de renouvellement se verra chez les amis avant de se voir en développement. Un fork MIT de la v21 existe, **Optimus UI** (OpenNG), gardé comme porte de sortie.

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
- Un titre de la playlist introuvable dans le dossier source est logué et le traitement continue
- Barre de progression, signal sonore de fin (désactivable)
- Rapport de run écrit dans le dossier destination

**Deux formats, deux provenances :**

| Format | Provenance | Contenu |
|---|---|---|
| SQLite (`vlc_media.db`) | VLC Android, `Réglages > Avancé > Dump media database` | Dump de toute la médiathèque, pas un export de playlist : les listes sont dans des tables à joindre (`PlaylistMediaRelation`), avec des chemins Android |
| M3U8 | Rekordbox (clic droit sur la playlist, « export for music apps »), Traktor, foobar, VLC desktop | Une playlist, avec les chemins absolus de la machine d'origine |

Les deux sont nécessaires : **VLC Android n'a aucune fonction d'export de playlist**, le dump est sa seule sortie (les scripts tiers type `vlc-to-m3u` ne font rien d'autre que lire cette base). Le SQLite couvre le cas principal, playlist curée sur le téléphone ; le M3U8 couvre les autres DJ.

**Résolution par nom de fichier, pas par chemin.** Le chemin de la playlist est ignoré, seul le nom est retenu puis cherché récursivement dans le dossier source ([playlist_processor.py:122-126](https://github.com/thibaud57/BeatportScrapper-TrackTagger/blob/HEAD/processors/playlist_processor.py#L122-L126)). Sans ça le cas principal ne marche pas : la base vient du téléphone, les fichiers sont sur le PC.

Reste à traiter : deux fichiers de même nom dans des sous-dossiers différents. La CLI prend silencieusement le premier trouvé.

### Feature 2 : Onglet Scraping, pipeline de re-tagging

- Sélection d'un dossier (typiquement la destination de l'onglet 1)
- La requête envoyée à l'API est construite depuis les tags ID3 artiste et titre ; s'ils sont vides ou inexploitables, on retombe sur le nom de fichier nettoyé
- Interrogation de Beatport, puis de Bandcamp si Beatport ne renvoie rien, ou si tu refuses ses candidats (cf. § Chaîne de résolution)
- Scoring rapidfuzz des candidats, avec des seuils réglables dans les Settings
- Pool asyncio borné : plusieurs morceaux en vol simultanément, le débit restant tenu par l'API
- Cache disque des réponses de l'API et des pochettes téléchargées, TTL 30 jours, plafond 500 Mo en éviction LRU
- Liste scrollable affichant `Artiste - Titre` et un état par ligne : vert validé (coche), rouge sans correspondance (croix), bleu en attente d'arbitrage (i)
- Barre de progression, signal sonore de fin

### Feature 3 : Arbitrage utilisateur

Le pipeline ne s'arrête jamais. Les morceaux ambigus s'empilent en file, la modale s'ouvre dès qu'il y en a un et qu'aucune n'est déjà ouverte.

- En haut de la modale, le morceau à identifier ; en dessous, **les candidats en zone grise uniquement**, avec leur score. Cinq résultats renvoyés dont trois en zone grise : on affiche les trois.
- Sélection d'un candidat, ou choix explicite « aucune correspondance »
- Le refus déclenche l'appel Bandcamp, et **sa liste remplace celle de Beatport** dans la même fenêtre, l'en-tête indiquant la bascule et un lien discret permettant de revenir en arrière
- Si Bandcamp ne renvoie rien : message dans la modale, une seule action pour passer au suivant, le morceau part en non résolu
- Navigation entre les arbitrages en attente par flèches, avec compteur (1/3, 2/3), la file se réduisant au fil des décisions
- Fermeture possible par la croix, l'arbitrage restant en file
- Tentative de quitter avec des morceaux encore en cours : modale de confirmation

### Feature 4 : Rattrapage par URL manuelle

À la toute fin du run, avant la confirmation globale, l'app propose de résoudre à la main les morceaux restés sans correspondance.

- Champ de saisie d'URL par morceau, acceptant Beatport, Bandcamp et SoundCloud
- L'URL est résolue via les routes correspondantes de l'API
- Barre de progression sur cette phase également
- Étape entièrement facultative, on peut la passer

### Feature 5 : Écriture des tags et renommage

Aucun fichier n'est modifié avant la confirmation globale de fin de run. L'écriture est purement locale et dure quelques secondes, les pochettes ayant été téléchargées et mises en cache pendant la phase réseau.

Principe : **on écrit tout ce que l'API renvoie**. La CLI actuelle écrivait dix champs, le contrat `Track` en expose davantage.

**Formats supportés** : MP3, WAV, AIFF et FLAC, contre MP3 seul dans la CLI actuelle. Deux systèmes de tags, ID3v2 et Vorbis comments, tous deux couverts par mutagen. Le WAV est le maillon faible, son support en lecture variant selon les logiciels DJ.

La couverture des sources est très asymétrique, Beatport remplissant tout le contrat quand Bandcamp ne donne que le socle d'identité. L'écriture se construit donc à partir de ce qui est présent, sans jamais supposer un champ, et **un champ `null` ne touche pas au tag existant** : c'est ce qui rend un tagging Bandcamp non destructif.

Renommage après l'écriture, jamais avant. Dump JSON des tags d'origine avant réécriture, avec rollback par run ou par morceau.

> Table de correspondance complète des 17 champs, conventions Vorbis et règles de titre : [ADR-011](adrs/011-politique-ecriture-tags.md).

### Feature 6 : Plan de run, reprise et rapport

- Chaque décision (validation auto, arbitrage, URL manuelle, abandon) est écrite au fil de l'eau dans un plan JSON, dans le répertoire de données de l'app (`appLocalDataDir()`), pas dans le dossier de musique
- Un run interrompu est détecté au lancement suivant : « Run du 2 août sur `D:\Sets\Août`, 62/100 traités, reprendre ou repartir de zéro ? ». Aucun fichier n'a été touché entre-temps.
- Purge automatique au démarrage : les plans des runs terminés et écrits sont supprimés, les runs interrompus conservés, plafond d'ancienneté à 30 jours
- Écran récapitulatif final dans l'app : tableau filtrable (tout, validés, arbitrés, échecs), avant/après par morceau, lien vers la fiche source
- Rapport écrit dans le dossier destination en deux formats : JSON (source de vérité, relu par l'app pour rouvrir un run passé) et Markdown (lisible hors application)
- Le rapport détaille par morceau : requête envoyée, source ayant répondu, décision et son origine, champs écrits, ancien et nouveau nom de fichier, erreurs

### Feature 7 : Settings

- URL de l'API et clé `X-API-Key`, saisie par l'utilisateur, stockée chiffrée via le trousseau de l'OS
- Langue : FR ou EN. Au premier lancement, la locale système est lue via le plugin OS de Tauri (`locale()`, format BCP-47) : commence par `fr` donne du français, tout le reste donne de l'anglais. Le sélecteur permet de forcer l'une ou l'autre ensuite.
- Seuils de matching (validation automatique, zone grise)
- Motif de renommage des fichiers
- Signal sonore de fin
- Bouton « ouvrir le dossier de logs », pour récupérer une trace à distance
- Bouton « vider le cache »

### Feature 8 : Distribution et mise à jour

- Installeur Windows produit par la CI au tag, publié sur les GitHub Releases
- Updater Tauri intégré : vérification d'un manifeste au démarrage, proposition de mise à jour, bundles signés avec la paire de clés Tauri
- Une clé API distincte par utilisateur, révocable individuellement

### Feature 9 : Monitoring

- Sentry actif d'office, erreurs techniques uniquement (sidecar qui tombe, API injoignable, parsing cassé), SDK durci : variables locales des frames désactivées, nom de machine fixé, chemins scrubbés
- Scrubbing des chemins de fichiers dans les stack traces (ils contiennent le nom d'utilisateur de l'OS)
- Aucun titre de morceau envoyé automatiquement : les cas d'arbitrage et d'échec restent dans le rapport local
- Bouton « envoyer ce rapport pour améliorer le matching » dans l'écran final : geste explicite de l'utilisateur, pousse le JSON du run, ne consomme pas le quota Sentry

## Post-MVP

### Feature 1 : Agent IA d'arbitrage (PydanticAI)

**En renfort du fuzzy, pas à sa place.** Le scoring rapidfuzz reste le moteur, l'agent est un mode activable dans les Settings, désactivé par défaut, qui intervient là où le fuzzy s'arrête. Sans clé API renseignée, l'application se comporte exactement comme au MVP.

Deux points d'insertion dans la chaîne :

- **Zone grise**, avant d'ouvrir la modale : l'agent reçoit le morceau et les candidats, et tranche. Certain, il valide et tu n'es pas interrompu. Hésitant, la modale s'ouvre quand même, avec son candidat recommandé et sa justification.
- **Non résolu**, avant la phase URL : l'agent peut reformuler la requête (orthographe approximative, translittération, artiste mal découpé) et relancer une recherche plutôt que d'abandonner.

Implique une section Settings dédiée : clé API du fournisseur (chacun met la sienne) et sélection du modèle. La liste des modèles proposés ne doit pas être codée en dur, sous peine de maintenance à chaque sortie. Mécanisme à définir au moment de l'implémentation.

Pas de n8n : l'orchestration reste dans le sidecar, PydanticAI côté Python.

### Feature 2 : Édition manuelle des tags

Formulaire dans l'application pour corriger un champ à la main quand aucune source ne convient et qu'aucune URL n'existe.

### Feature 3 : Formats de playlist supplémentaires

Parsing du TXT Rekordbox, destiné à KUVO et donc orienté affichage : ses colonnes dépendent de la langue d'export, il faudrait rendre leurs clés configurables. Et du XML, qui exporte la collection entière et non une playlist.

### Feature 4 : macOS et Linux

Deuxième et troisième cibles de distribution, à ajouter le jour où un utilisateur le demande vraiment.

macOS est la plus coûteuse : un runner macOS en CI (minutes facturées x10 sur un dépôt privé), un second build PyInstaller à maintenir, et surtout la notarisation. Sans Apple Developer Program à 99 $/an, l'app se distribue quand même mais **Gatekeeper la bloque au premier lancement**. Depuis macOS Sequoia, le contournement par Contrôle-clic ne suffit plus à cette première ouverture : l'utilisateur doit passer par Réglages Système > Confidentialité et sécurité, choisir « Ouvrir quand même » et s'authentifier comme administrateur. Les lancements suivants redeviennent normaux. Le compte Apple gratuit ne résout rien, ses certificats sont limités au développement local et ne permettent pas la notarisation.

Linux est indolore par comparaison : runner GitHub gratuit, aucune signature exigée.

### Feature 5 : Tests bout-en-bout

Pilotage de l'application empaquetée via WebdriverIO et `tauri-driver`, le WebDriver officiel de Tauri.

Rien au MVP : le contrat NDJSON est déjà testable en ligne de commande sans interface, ce qui couvre le vrai risque du projet. Un e2e complet impose un runner Windows dédié en CI et des tests lents, pour valider une UI à deux écrans.

Justifié le jour où l'application est distribuée à plusieurs personnes et où une régression de la chaîne UI vers sidecar cesse d'être détectable à l'œil.

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

> État au moment du brainstorm. La plupart ont été tranchées depuis, lors de la rédaction de l'architecture : voir [docs/adrs/](adrs/) pour les décisions et [ARCHITECTURE.md § Questions ouvertes](ARCHITECTURE.md#questions-ouvertes) pour ce qui reste à vérifier.

## Techniques

- **techno-scraper multi-clés** : [`core/security.py`](https://github.com/thibaud57/techno-scraper/blob/HEAD/src/technoscraper/core/security.py) compare contre une clé unique (`settings.api_key`). Une clé par utilisateur impose de passer à un jeu de clés nommées. Changement petit, mais sur une API déjà en production.
- **Taille du pool de concurrence** : combien d'appels en vol simultanés sans dégrader la latence de l'API ? À mesurer, pas à deviner.
- **Seuils de matching par défaut** : les valeurs de la CLI actuelle sont-elles transposables, sachant que le contrat de sortie de l'API a changé ?
- **Schéma de `vlc_media.db`** : la CLI externalise sa requête SQL dans un fichier (`SQLITE_QUERY_PATH`), signe que le schéma de la médiathèque VLC n'est pas stable dans le temps. Faut-il garder cette souplesse, et comment détecter un schéma devenu incompatible autrement qu'en plantant ?
- **Doublons de noms de fichiers** : que faire quand plusieurs fichiers du dossier source portent le même nom (demander, prendre le plus gros, tout signaler dans le rapport) ?
- **Nettoyage des noms de fichiers** : quels motifs retirer avant d'envoyer la requête (`[FREE DL]`, `320kbps`, numéros de piste, tirets bas) ?
- **Tags WAV** : quels lecteurs lisent réellement le bloc ID3 d'un WAV ? À tester sur Rekordbox avant de promettre quoi que ce soit dans le rapport.
- **Clés libres Vorbis** : quelles conventions retenir pour `key`, `catalog_number` et `source` sur FLAC, où aucun champ standard n'existe (aligner sur Picard) ?
- **Motif de renommage** : quel format par défaut, et jusqu'où le rendre configurable ?
- **Versionnement du plan JSON** : un plan écrit par une version antérieure doit-il rester reprenable après mise à jour de l'app ?
- **Maturité de PyInstaller sur macOS** : à vérifier le jour où la cible macOS revient au programme.
- **Licence PrimeUI** : que se passe-t-il exactement avec une clé absente ou expirée sur les versions actuelles ? Le mécanisme connu (bandeau dans l'application, erreurs invisibles sur localhost) vient du dispositif LTS de PrimeNG, à reconfirmer au moment de prendre la clé.
- **Sélection des modèles LLM (Post-MVP)** : comment proposer une liste à jour sans la coder en dur ni la maintenir à chaque sortie de modèle ?

## Business

- Combien d'utilisateurs réels, donc combien de clés API à gérer et à révoquer ?
- Un pote est-il réellement sur Mac ? C'est ce qui déclenchera la cible macOS, et avec elle la question des 99 $/an.
- Dépôt public ou privé ? Sans objet tant qu'on reste sur Windows, décisif dès qu'un runner macOS entre en jeu (gratuit sur public, facturé x10 sur privé).

---

# 📝 Notes & Décisions

**Décisions actées :**

- **Décision Coquille** : Tauri v2 vs Electron (webview système, bundles légers, tout le métier restant en Python, aucune raison d'embarquer Node)
- **Décision Framework UI** : Angular vs React + Next.js (Next n'apporte rien sans serveur Node, il faudrait l'exporter en statique pour retrouver un React ordinaire avec de la configuration en plus ; Angular est déjà maîtrisé)
- **Décision Lib UI** : PrimeNG dernière version vs Angular Material vs PrimeNG 21, dernière MIT (catalogue plus large, table à scroll virtuel, thèmes variés ; la Community License est gratuite et couvre le projet, contreparties assumées : clé embarquée, renouvellement annuel, dépendance à la politique de PrimeTek)
- **Décision Client HTTP** : httpx2 vs httpx (fork de maintenance repris par l'équipe Pydantic, API strictement identique, déjà en place sur techno-scraper) et vs curl_cffi (inutile ici : l'app appelle sa propre API, pas un site protégé par un anti-bot)
- **Décision Stockage de la clé API** : keyring côté Python vs plugin Tauri stronghold (la clé vit dans le sidecar, la faire transiter par le JavaScript annulerait le bénéfice recherché ; keyring parle nativement au Credential Manager Windows et au Keychain macOS)
- **Décision Métier** : sidecar Python vs réécriture en Rust (mutagen a des années d'avance sur le parsing de tags audio et ses cas tordus ; le code existant est réutilisable tel quel)
- **Décision Matching** : rapidfuzz au MVP, agent IA en Post-MVP **en renfort et non en remplacement** (livrable plus vite, aucune dépendance externe, aucun coût par morceau ; l'agent devient un mode activable qui n'intervient que sur la zone grise et les non résolus, et l'app reste entièrement fonctionnelle sans clé API)
- **Décision Orchestration IA** : PydanticAI dans le sidecar vs agent n8n par webhook (l'app doit fonctionner sans infrastructure distante ; abandon de la piste n8n des premières notes)
- **Décision Matching lib** : rapidfuzz vs fuzzywuzzy (accélérateur python-Levenshtein sous GPLv2, que le renommage en TheFuzz n'a pas changé ; rapidfuzz est MIT, plus rapide, et descend d'une version MIT de fuzzywuzzy donc les seuils se transposent)
- **Décision Scraping** : délégué à techno-scraper vs intégré à l'app (une seule surface à réparer quand un site change de structure, et l'API existe déjà en production)
- **Décision Sources** : Beatport puis Bandcamp en automatique, SoundCloud en URL manuelle seulement (métadonnées d'upload SoundCloud trop peu fiables pour une recherche automatique)
- **Décision Enchaînement des sources** : modale à deux temps vs appel Bandcamp spéculatif vs seconde modale après remise en file (l'appel spéculatif paie Bandcamp même quand un candidat Beatport convient ; la remise en file fait réapparaître le morceau plus loin dans la liste et transforme le refus en pari à l'aveugle ; garder la modale ouverte donne les deux bénéfices)
- **Décision Candidats affichés** : zone grise seulement vs tous les résultats avec leur score (liste courte et lisible ; contrepartie assumée, un bon match mal scoré reste invisible)
- **Décision i18n** : ngx-translate vs Transloco vs `@angular/localize` (le package officiel traduit à la compilation et imposerait un installeur par langue ; entre les deux libs tierces, ngx-translate documente explicitement sa compatibilité Angular 22 et son adaptation à la nouvelle stratégie de détection de changement, là où la page de compatibilité de Transloco n'a pas bougé depuis 10 mois)
- **Décision Formats playlist** : VLC SQLite + M3U8 vs TXT Rekordbox (le M3U8 couvre Rekordbox, Traktor, foobar et VLC avec un seul parser ; le TXT dépend de la langue d'export, donc fragile)
- **Décision Copy/Move** : toggle avec copie par défaut vs déplacement (la bibliothèque source reste intacte pendant que le re-tagging réécrit les fichiers ; une ligne de différence à l'implémentation)
- **Décision Requête de recherche** : tags ID3 avec repli sur le nom de fichier vs nom de fichier seul (couvre aussi bien les fichiers déjà à peu près taggés que les téléchargements sauvages nommés `track01.mp3`)
- **Décision Écriture** : batch final avec plan persisté au fil de l'eau vs écriture immédiate (l'écriture est locale et dure quelques secondes, l'anticiper ne gagne rien et coûte un dossier à moitié renommé en cas de crash, un écran de confirmation qui ne confirme plus rien, et une seconde passe après la phase URL manuelle ; le risque de perdre une session d'arbitrage se corrige en persistant le plan, pas en écrivant les fichiers)
- **Décision Arbitrage** : pipeline qui continue en fond vs mise en pause (le flux d'événements NDJSON est de toute façon imposé par la barre de progression ; une fois là, continuer en fond coûte quelques dizaines de lignes et masque le temps d'arbitrage derrière le temps réseau)
- **Décision Formats de fichiers** : MP3, WAV, AIFF et FLAC vs MP3 seul comme la CLI actuelle (une bibliothèque DJ mélange les achats Beatport et Bandcamp ; M4A écarté, absent des circuits d'achat DJ ; coût réel de deux tables de correspondance, couvertes par mutagen)
- **Décision Champs écrits** : tout ce que l'API renvoie, sans cases à cocher (qui peut le plus peut le moins ; un champ récupéré mais non écrit est une information perdue pour rien, et Rekordbox recalcule BPM et key par analyse audio donc aucun conflit possible)
- **Décision Champs absents** : un `null` ne touche pas au tag existant vs écrasement systématique (la couverture Bandcamp est bien plus pauvre que celle de Beatport, écraser rendrait un tagging Bandcamp destructif sur des fichiers déjà renseignés)
- **Décision Emplacement du plan** : `appLocalDataDir()` vs dossier destination (le plan est un état de session, pas un livrable ; le dossier de musique peut être déplacé ou renommé, ce qui casserait la reprise)
- **Décision Cache** : TTL 30 jours et plafond 500 Mo en éviction LRU (le dossier de cache doit pouvoir être supprimé à tout moment sans rien casser, seulement des appels réseau à repayer)
- **Décision Rapport** : JSON + Markdown vs Markdown seul (le JSON est la source de vérité relue par l'app et la base de l'envoi de feedback, le Markdown en est le rendu lisible hors application)
- **Décision Monitoring** : Sentry pour les crashs uniquement vs événements métier (le plan gratuit plafonne à 5 000 erreurs par mois et **jette silencieusement** les suivantes : noyer les crashs sous de la télémétrie ferait perdre le vrai bug quand il arrive)
- **Décision vie privée** : durcissement du SDK plutôt que consentement (une case à cocher n'empêche aucune donnée de partir, la configuration si), scrubbing des chemins, région EU, aucun titre de morceau envoyé automatiquement
- **Décision Clé API** : une clé par utilisateur saisie dans les Settings vs clé partagée embarquée (une clé compilée dans le binaire est extractible, et la révoquer obligerait à rediffuser l'app à tout le monde)
- **Décision Cibles** : Windows seul au MVP, macOS et Linux en Post-MVP (aucun utilisateur Mac confirmé à ce jour, et la cible coûtait à elle seule 99 $/an de notarisation, un runner macOS facturé x10 en CI et un second build PyInstaller ; sans notarisation, Gatekeeper bloque au premier lancement et le contournement par Contrôle-clic ne suffit plus depuis macOS Sequoia)
- **Décision Dépôt** : dépôt neuf vs évolution de `BeatportScrapper-TrackTagger` (la CLI sert de référence à lire, rien n'est porté tel quel, l'arborescence à plat ne correspond pas à la structure Tauri)

**Principes directeurs :**

- L'application ne scrape rien elle-même. Toute donnée vient de techno-scraper, seule surface à réparer quand un site change.
- Aucun fichier n'est modifié sans confirmation explicite, et les tags d'origine sont toujours récupérables.
- Le dossier de cache est jetable par définition : le supprimer ne doit jamais casser un run.
- **Ce n'est pas un produit.** Pas de multi-tenant, pas de compte, pas de facturation, jamais.

> Ordre de développement : [ARCHITECTURE.md § Ordre de développement](ARCHITECTURE.md#ordre-de-développement).

**Références :**

- [Tauri v2 — Sidecar](https://v2.tauri.app/develop/sidecar/)
- [Tauri v2 — Plugins](https://v2.tauri.app/plugin/)
- [techno-scraper — README](https://github.com/thibaud57/techno-scraper/blob/HEAD/README.md) : routes, contrat `Page[T]`, sémantique des erreurs
- [techno-scraper — ADR-002](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/002-api-gateway-bas-niveau.md) : ni fallback ni matching côté API, cette logique appartient aux consommateurs
- [techno-scraper — ADR-006](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/006-schema-track-normalise.md) : schéma `Track` normalisé, base des champs écrits
- [BeatportScrapper-TrackTagger](https://github.com/thibaud57/BeatportScrapper-TrackTagger) : implémentation CLI de référence (parsing des playlists, matching, déplacement)
