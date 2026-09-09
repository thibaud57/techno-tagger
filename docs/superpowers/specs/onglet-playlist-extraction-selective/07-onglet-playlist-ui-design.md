---
feature: "Feature 1 — Onglet Playlist, extraction sélective"
subproject: "onglet-playlist-ui"
goal: "Livrer l'écran qui permet de lancer une extraction de playlist et d'en lire le résultat sans jamais quitter l'application"
status: "draft"
complexity: "L"
tdd_scope: "partial"
depends_on: ["05-cablage-i18n-design.md", "06-service-sidecar-angular-design.md"]
date: "2026-09-08"
---

# Onglet Playlist : sélection, extraction et rapport

## Scope

Couvre l'écran complet de l'onglet Playlist : sélection du dossier source, du dossier destination et du fichier de playlist par le plugin `dialog`, reconnaissance du format annoncée par le sidecar, sélecteur de playlist affiché pour un dump VLC seulement, bascule copier/déplacer persistée dans le `store`, barre de progression alimentée par l'événement `progress`, et rapport rendu en table dense. Couvre également l'implémentation du logo de source, aujourd'hui un stub, pour le seul logo dont cet écran a besoin.

Exclut toute règle métier : l'écran affiche ce qu'il reçoit et émet des commandes. Exclut le composant partagé de tag d'état, conçu pour les champs `state` et `resolution` d'un morceau retagué, sans rapport avec les catégories d'une extraction.

### État livré

À la fin de ce sub-project, on peut : lancer l'application, choisir un dossier source, un dossier destination et un dump VLC, voir apparaître le logo VLC et le sélecteur de playlist rempli avec les noms et leurs nombres de morceaux, lancer l'extraction en mode copie, voir la progression avancer, puis lire le rapport à l'écran et retrouver les fichiers dans le dossier destination, la source intacte.

## Dependencies

- `05-cablage-i18n-design.md` (statut: draft) — fournit ngx-translate et les fichiers de langue que cet écran enrichit.
- `06-service-sidecar-angular-design.md` (statut: draft) — fournit `SidecarService`, ses signaux et ses commandes.

### Amendement requis sur les sub-projects amont

La reconnaissance du format ne peut pas vivre dans l'interface, où elle serait une règle métier en TypeScript. Elle est déjà implémentée dans le sidecar, par en-tête de fichier. Trois documents amont sont donc amendés en conséquence :

- **Sub-project 01** : `list_playlists()` accepte un M3U8 et rend une liste vide plutôt que de lever, la commande servant aussi à faire reconnaître le format.
- **Sub-project 04** : l'événement `playlists_listed` porte un champ `playlist_format`, valant `vlc_dump` ou `m3u8`.
- **Sub-project 06** : `SidecarService` expose un signal `playlistFormat` alimenté par ce champ.

## Files touched

- **À modifier** : `src/app/features/playlist/playlist-page.component.ts` (remplace le stub)
- **À modifier** : `src/app/features/playlist/playlist-page.component.html`
- **À créer** : `src/app/features/playlist/playlist-page.component.spec.ts`
- **À créer** : `src/app/features/playlist/extraction-rows.ts` (agrégation des cinq catégories en lignes de table)
- **À créer** : `src/app/features/playlist/extraction-rows.spec.ts`
- **À créer** : `src/app/core/preferences.ts` (lecture et écriture du mode dans le `store`, avec repli hors Tauri)
- **À modifier** : `src/app/shared/components/source-logo.component.ts` (implémente le rendu, logo VLC)
- **À modifier** : `src/app/shared/components/icon.component.ts` (ajoute l'icône de dossier selon le motif documenté)
- **À modifier** : `public/i18n/fr.json` et `public/i18n/en.json` (clés de l'écran, plus l'espace de noms `errors` qui traduit les `code` du sidecar)

## Architecture approach

- **Aucune logique métier dans le composant** : il lit les signaux du service, dérive des booléens d'affichage, et émet des commandes. Le format de playlist, le départage des doublons et les motifs d'échec viennent tous du sidecar (cf. `.claude/rules/angular/components.md` et DESIGN.md § Conventions de Code).
- **Sélection des chemins par le plugin `dialog`** : `open({ directory: true })` pour les deux dossiers, `open()` pour le fichier de playlist. Chaque chemin retenu s'affiche à côté de son bouton en `text-muted-color`, tronqué par la gauche pour garder le nom du dossier visible.
- **Le choix du fichier de playlist déclenche `list_playlists`** : la réponse annonce le format et, pour un dump, la liste des playlists. Le sélecteur et le logo VLC en découlent, sans qu'aucune règle ne soit écrite côté interface.
- **Composants PrimeNG du mapping de DESIGN.md**, sans substitution : boutons outlined pour la sélection, `p-select` pour la playlist, `p-selectbutton` pour le mode, `p-progressbar` pour la progression, `p-table` dense, scrollable et à défilement virtuel pour le rapport, `p-message` inline pour une erreur contextuelle, `p-skeleton` pendant l'attente d'une liste de playlists.
- **Rapport en table unique**, une ligne par morceau portant sa catégorie et son détail. Les cinq catégories du résultat sont aplaties en lignes par une fonction pure, testable sans monter le composant : trois d'entre elles ne portent qu'un nom, les doublons et les échecs portent une structure, et le détail les rend dans la même colonne.
- **La couleur n'est jamais seule porteuse d'information** : chaque catégorie s'affiche avec une icône et un libellé traduit, conformément à DESIGN.md § Palette. Les familles employées sont celles du document, `warn` n'étant porté par aucune ligne.
- **Action d'extraction conditionnée** : elle n'est disponible que si les deux dossiers et la playlist sont choisis, qu'une playlist est sélectionnée lorsque le fichier est un dump, que le sidecar est disponible et qu'aucune divergence de version n'a été constatée. Chacune de ces conditions est un signal calculé, ce qui rend le blocage lisible et testable.
- **Divergence de version signalée à l'écran** : un `p-message` d'erreur porte les deux versions et l'action reste bloquée. ARCHITECTURE impose de refuser de lancer un run dans ce cas.
- **Préférence de mode dans le `store` de Tauri**, isolée dans un module dédié qui retombe silencieusement sur la valeur par défaut hors Tauri, comme la résolution de langue. La copie est le défaut, la source restant alors intacte.
- **Libellés entièrement traduits**, aucune largeur fixe posée sur du texte traduit, et les motifs d'échec du sidecar affichés par des clés de traduction plutôt que par leur valeur brute : le sidecar n'émet jamais de phrase destinée à l'utilisateur.
- **Layout de DESIGN.md** : container `mx-auto max-w-3xl p-4` pour les contrôles, rythme `gap-2` dans un groupe et `gap-4` entre groupes, le défilement vivant dans la table et jamais dans la page.
- **`icon.component.ts` étendu selon son motif documenté** : un nom dans le tableau, un import, un `@case`. Le tableau existe précisément pour que le test parcoure la liste, Angular ne vérifiant pas l'exhaustivité d'un `@switch`.
- **`source-logo.component.ts` implémenté en SVG inline** : les fichiers de `src/assets/icons/` ne sont pas émis par le build, et c'est voulu — `currentColor` ne fonctionne pas sur une balise `img`, et les câbler dans la configuration d'assets embarquerait des fichiers morts dans l'installeur.

## Acceptance criteria

### Scénario 1 : Sélection des trois chemins
**GIVEN** l'écran Playlist ouvert
**WHEN** l'utilisateur choisit un dossier source, un dossier destination et un fichier de playlist
**THEN** chaque chemin retenu s'affiche à côté de son bouton
**AND** un chemin long est tronqué par la gauche, le nom du dossier restant lisible

### Scénario 2 : Dump VLC reconnu
**GIVEN** un fichier de playlist choisi qui est un dump VLC
**WHEN** le sidecar annonce le format et la liste des playlists
**THEN** le logo VLC s'affiche à côté du fichier
**AND** le sélecteur de playlist apparaît, chaque option portant le nom et le nombre de morceaux

### Scénario 3 : M3U8 reconnu
**GIVEN** un fichier de playlist choisi qui est un M3U8
**WHEN** le sidecar annonce le format
**THEN** l'icône générique de fichier s'affiche
**AND** aucun sélecteur de playlist n'apparaît, le fichier n'en contenant qu'une

### Scénario 4 : Mode copie par défaut
**GIVEN** un premier lancement, sans préférence enregistrée
**WHEN** l'écran s'affiche
**THEN** le mode copie est sélectionné

### Scénario 5 : Mode mémorisé
**GIVEN** un utilisateur ayant choisi le mode déplacement
**WHEN** l'application est relancée
**THEN** le mode déplacement est sélectionné

### Scénario 6 : Extraction bloquée tant que les prérequis manquent
**GIVEN** un écran où l'un des trois chemins n'est pas choisi
**WHEN** l'utilisateur regarde l'action d'extraction
**THEN** elle est indisponible

### Scénario 7 : Extraction bloquée sans playlist choisie sur un dump
**GIVEN** un dump VLC choisi, ses playlists listées, mais aucune sélectionnée
**WHEN** l'utilisateur regarde l'action d'extraction
**THEN** elle est indisponible

### Scénario 8 : Extraction bloquée sur divergence de version
**GIVEN** un sidecar dont la version diffère de celle de l'interface
**WHEN** l'écran s'affiche
**THEN** un message d'erreur porte les deux versions
**AND** l'action d'extraction est indisponible même si tous les chemins sont choisis

### Scénario 9 : Extraction lancée
**GIVEN** tous les prérequis réunis
**WHEN** l'utilisateur lance l'extraction
**THEN** une commande d'extraction est émise, portant les deux dossiers, le chemin de la playlist, le nom de la playlist choisie et le mode retenu

### Scénario 10 : Progression affichée
**GIVEN** une extraction en cours
**WHEN** des événements de progression arrivent
**THEN** la barre de progression avance
**AND** un compteur affiche le nombre traité sur le total

### Scénario 11 : Rapport affiché
**GIVEN** une extraction terminée portant des morceaux extraits, un déjà présent, un introuvable, un doublon départagé et un échec
**WHEN** le résultat arrive
**THEN** la table porte une ligne par morceau, avec sa catégorie
**AND** chaque catégorie s'affiche avec une icône et un libellé, jamais par la couleur seule
**AND** la ligne d'un doublon montre le candidat écarté et le critère appliqué
**AND** la ligne d'un échec montre son motif traduit

### Scénario 12 : Sidecar indisponible
**GIVEN** une interface servie sans sidecar
**WHEN** l'écran s'affiche
**THEN** l'écran reste navigable
**AND** l'action d'extraction est indisponible

## Tests à écrire

### Unit

- `src/app/features/playlist/extraction-rows.spec.ts` :
  - les cinq catégories sont aplaties en lignes, une par morceau
  - une ligne porte la catégorie de son morceau
  - la ligne d'un doublon porte le chemin du candidat écarté, sa taille et le critère
  - la ligne d'un échec porte son motif
  - un résultat vide ne produit aucune ligne
  - les lignes sont rendues dans un ordre stable d'une exécution à l'autre

- `src/app/features/playlist/playlist-page.component.spec.ts` :
  - l'action d'extraction est indisponible tant qu'un chemin manque
  - l'action est indisponible sur un dump dont aucune playlist n'est sélectionnée
  - l'action est disponible sur un M3U8 sans playlist sélectionnée
  - l'action est indisponible quand le sidecar est indisponible
  - l'action est indisponible quand les versions divergent
  - le sélecteur de playlist n'est proposé que pour un dump VLC
  - le mode copie est retenu par défaut
  - la commande émise porte les chemins, le nom de playlist et le mode courants

Le rendu d'un composant PrimeNG, le masquage d'un bloc par un `@if` et la sérialisation d'une commande ne sont pas testés : ce sont des comportements de framework ou de bibliothèque, qu'une mise à jour ferait échouer sans qu'aucune règle du projet ait bougé.

## Edge cases

- **Playlist vide dans un dump** : l'option apparaît avec un compte de zéro, et l'extraction rend un rapport vide. Rien n'est masqué : un compte à zéro est une information.
- **Fichier choisi qui n'est ni un dump ni un M3U8 lisible** : le sidecar émet une erreur, affichée en message inline, et aucun sélecteur n'apparaît.
- **Deux extractions successives** : le rapport précédent est remplacé dès le lancement de la seconde, pour qu'aucun résultat périmé ne reste affiché pendant que la nouvelle tourne.
- **Rapport très long** : le défilement virtuel de la table couvre le cas, la page elle-même ne défilant jamais.
- **Chemin très long** : la troncature par la gauche garde la fin du chemin lisible, qui est la partie utile.
- **Préférence de mode illisible** : hors Tauri ou sur un `store` corrompu, la lecture retombe sur la copie sans lever.

## Architectural decisions

### Décision : Le format de playlist est annoncé par le sidecar, jamais déduit par l'interface

**Options envisagées :**
- **A. Étendre l'événement `playlists_listed` d'un champ de format** : l'interface envoie toujours la commande de listage, le sidecar répond en annonçant le format et, pour un M3U8, une liste vide. La reconnaissance reste où elle est déjà implémentée, par en-tête de fichier.
- **B. Traiter l'erreur de format non supporté comme la marque d'un M3U8** : aucun changement de contrat, mais un fichier corrompu ou illisible serait confondu avec un M3U8 valide, et l'écran se présenterait prêt à extraire sur un fichier qui ne l'est pas.
- **C. Décider sur l'extension du fichier côté interface** : trivial, mais c'est une règle métier en TypeScript, que le projet interdit, et qui contredirait la détection par en-tête déjà retenue côté sidecar.

**Choix : A**

**Rationale :**
- Le projet interdit explicitement toute règle métier hors du sidecar, et reconnaître un format en est une
- L'option B détourne un canal d'erreur en canal d'information : les deux cas cesseraient d'être distinguables, alors qu'ils appellent des réactions opposées
- Le coût est faible et payé au bon moment : les sub-projects concernés ne sont pas encore implémentés, seul leur spec est amendé

### Décision : Le rapport est rendu en table unique plutôt qu'en sections par catégorie

**Options envisagées :**
- **A. Une table dense, une ligne par morceau, colonne de catégorie et colonne de détail** : un seul composant de liste, aligné sur le récapitulatif filtrable que la Feature 2 emploiera. Les cinq catégories sont aplaties par une fonction pure, testable sans monter le composant.
- **B. Une section par catégorie** : chaque bloc peut adopter la mise en forme qui lui convient, notamment pour les doublons, mais multiplie les composants et éloigne cet écran du récapitulatif employé ailleurs.

**Choix : A**

**Rationale :**
- L'utilisateur cherche un morceau, pas une catégorie : une liste unique répond à « qu'est devenu ce titre » sans lui faire parcourir cinq blocs
- La table dense à défilement virtuel est déjà le pattern du projet pour les listes de run, et DESIGN.md ne documente aucun autre rendu de résultat
- L'aplatissement en lignes isole la seule vraie transformation de cet écran dans une fonction pure, ce qui la rend testable sans framework

### Décision : Le tag d'état partagé n'est pas élargi aux catégories d'extraction

**Options envisagées :**
- **A. Cet écran pose son propre rendu de catégorie**, et le composant partagé reste réservé aux champs `state` et `resolution` d'un morceau retagué.
- **B. Élargir le composant partagé aux deux vocabulaires** : un seul composant de tag pour toute l'application, au prix d'un mélange de deux ensembles de valeurs sans recouvrement.

**Choix : A**

**Rationale :**
- Le commentaire du composant partagé dit qu'il encode son mapping « pour ne pas être re-dérivé de travers écran par écran » : y mêler un second vocabulaire ferait précisément ce qu'il cherche à éviter
- Les catégories d'une extraction et les états d'un morceau retagué n'ont aucune valeur en commun, et rien ne dit qu'ils évolueront ensemble
- Le composant partagé est encore un stub : l'élargir maintenant figerait un compromis avant même que son usage principal existe
