---
feature: "Feature 1 — Onglet Playlist, extraction sélective"
subproject: "onglet-playlist-ui"
goal: "Livrer l'écran qui permet de lancer une extraction de playlist et d'en lire le résultat sans jamais quitter l'application"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["05-cablage-i18n-design.md", "06-service-sidecar-angular-design.md"]
date: "2026-10-11"
---

# Onglet Playlist : sélection, extraction et rapport

## Scope

Couvre l'écran complet de l'onglet Playlist, en deux temps. Le formulaire (dossier source, dossier destination et fichier de playlist choisis par le plugin `dialog`, format annoncé par le sidecar, sélecteur de playlist pour un dump VLC seulement, bascule copier/déplacer persistée dans le `store`) cède la place à une ligne de résumé dès le lancement, la barre de progression alimentée par l'événement `progress` s'affichant dessous. Le rapport est rendu en table dense, suivi du bouton « Passer au tagging ». Couvre également le rendu du logo VLC par `SourceLogoComponent`, le seul dont cet écran a besoin.

Exclut toute règle métier : l'écran affiche ce qu'il reçoit et émet des commandes. Exclut le composant partagé de tag d'état, conçu pour les champs `state` et `resolution` d'un morceau retagué, sans rapport avec les catégories d'une extraction.

### État livré

À la fin de ce sub-project, on peut : lancer l'application, choisir un dossier source, un dossier destination et un dump VLC, voir apparaître le logo VLC et le sélecteur de playlist rempli avec les noms et leurs nombres de morceaux, lancer l'extraction en mode copie, voir le formulaire se replier en résumé et la progression avancer, puis lire le rapport à l'écran, retrouver les fichiers dans le dossier destination (la source intacte) et passer à l'onglet Tagging sur ce dossier.

## Dependencies

- `05-cablage-i18n-design.md` (statut: implemented) : fournit ngx-translate et les fichiers de langue que cet écran enrichit.
- `06-service-sidecar-angular-design.md` (statut: implemented) : fournit `SidecarService`, ses signaux (dont `ready` et `extracting`), ses commandes et la constante `SIDECAR_UNAVAILABLE`.

## Références de design

- **Maquette** : `ui_kits/techno-tagger/PlaylistScreen.jsx` (avant le lancement, pendant le run, run terminé), `AppShell.jsx` pour la barre d'onglets. Les écarts tranchés (formulaire en deux temps, deux colonnes du rapport, « Passer au tagging », container porté par le shell) vivent dans `docs/DESIGN.md` (§ Structure de Page, § Mapping Composants > Playlist et fichiers, § Arbitrages) et priment sur elle.
- **Design system** : `components/forms/PathPicker.prompt.md`, `Select.prompt.md`, `SelectButton.prompt.md` et `Button.prompt.md`, `components/data/DataTable.prompt.md`, `PhaseProgress.prompt.md` et `Skeleton.prompt.md`, `components/feedback/Tag.prompt.md`, `EmptyState.prompt.md` et `ErrorMessage.prompt.md`, `components/icons/SourceLogo.prompt.md`, `components/overlay/Tooltip.prompt.md` et `TruncatedText.prompt.md`
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À modifier** : `src/app/features/playlist/playlist-page.component.ts` et `.html`
- **À créer** : `src/app/features/playlist/playlist-page.component.spec.ts`
- **À créer** : `src/app/features/playlist/extraction-rows.ts` (agrégation des cinq catégories en lignes de table)
- **À créer** : `src/app/features/playlist/extraction-rows.spec.ts`
- **À créer** : `src/app/core/preferences.ts` (lecture et écriture du mode et de la dernière destination dans le `store`, avec repli hors Tauri)
- **À créer** : `src/app/core/preferences.spec.ts` (repli sur la copie quand le `store` est illisible ou indisponible)
- **À créer** : `src/app/shared/components/path-picker.component.ts` (bouton de sélection et chemin tronqué, posés en cellules de la grille de l'appelant)
- **À créer** : `src/app/shared/components/phase-progress.component.ts` (libellé, compteur et barre d'une phase)
- **À créer** : `src/app/shared/components/error-message.component.ts` et son spec (erreur du sidecar traduite depuis son `code` et ses `params`)
- **À créer** : `src/app/shared/components/truncated-text.component.ts` (texte coupé, lisible en entier au survol)
- **À modifier** : `src/app/shared/components/source-logo.component.ts` (rendu en SVG inline, logo VLC)
- **À modifier** : `src/app/shared/components/icon.component.ts` (ajoute les icônes de dossier, de catégories et de bandeau d'erreur selon le motif documenté)
- **À modifier** : `src/app/shared/components/empty-state.component.ts` (implémente le bloc vide de DESIGN.md, porté par le rapport vide)
- **À créer** : `src/app/shared/utils/tooltip.ts` (délai et options du tooltip qui révèle une valeur coupée)
- **À créer** : `src/app/shared/utils/file-size.ts` et son spec (taille de fichier lisible, dans l'unité de la locale)
- **À créer** : `src/app/shared/utils/motion.ts` (fondu d'entrée et hôte d'une page d'onglet) et `src/app/shared/utils/table.ts` (table pleine hauteur à colonnes fixes)
- **À modifier** : `src/styles.css` (tooltip : `pointer-events: none` et largeur `wide`)
- **À modifier** : `src/app/app.component.ts` (shell en pleine hauteur : la page ne défile jamais, la table si)
- **À modifier** : `eslint.config.js` (accès par crochets aux membres `protected` dans les specs)
- **À modifier** : `docs/DESIGN.md` et `.claude/rules/primeng/composants.md` (dépréciation de `p-button`, fondu réel du tooltip)
- **À modifier** : `public/i18n/fr.json` et `public/i18n/en.json` (clés de l'écran, plus l'espace de noms `errors` qui traduit les `code` du sidecar)
- **À créer** : `sidecar/tests/unit/test_error_translations.py` (chaque `code` d'erreur du sidecar a sa clé dans les deux langues)
- **À modifier** : `src/app/core/translations.spec.ts` (la clé de `SIDECAR_UNAVAILABLE`, seul code émis par l'interface)

## Architecture approach

- **Aucune logique métier dans le composant** : il lit les signaux du service, dérive des booléens d'affichage et émet des commandes. Le format de playlist, le départage des doublons et les motifs d'échec viennent tous du sidecar (cf. `.claude/rules/angular/components.md`).
- **Sélection des chemins par le plugin `dialog`**, derrière `pickPath` (`shared/utils/dialog.ts`) : dossier pour la source et la destination, fichier pour la playlist. Chaque chemin retenu s'affiche à côté de son bouton (`app-path-picker`) en `text-muted-color`, tronqué par la gauche pour garder le nom du dossier visible.
- **Le choix du fichier de playlist déclenche `list_playlists`** : la réponse annonce le format et, pour un dump, la liste des playlists. Le sélecteur et le logo VLC en découlent, sans qu'aucune règle ne soit écrite côté interface.
- **Composants PrimeNG du mapping de DESIGN.md**, sans substitution : `button pButton` outlined pour la sélection (le composant `p-button` est déprécié depuis PrimeNG 22), `p-select` pour la playlist, `p-selectbutton` pour le mode (tous deux liés aux choix par `[formField]`, les formulaires à signals), `app-phase-progress` pour la progression, `p-table` dense, scrollable et à défilement virtuel pour le rapport, `app-error-message` pour une erreur contextuelle, `p-skeleton` aux dimensions du `p-select` pendant l'attente d'une liste de playlists, `SkeletonRowsComponent` dans le `#emptymessage` de la table tant que l'extraction tourne (le rapport n'arrive qu'à la fin, d'un bloc), `EmptyStateComponent` pour un rapport vide.
- **Rapport en table unique**, une ligne par morceau portant sa catégorie et son détail, plus une ligne par doublon départagé : le sidecar range le fichier retenu dans sa catégorie de transfert et consigne à part le départage. Les cinq catégories du résultat sont aplaties en lignes par une fonction pure, testable sans monter le composant : trois d'entre elles ne portent qu'un nom, les doublons et les échecs portent une structure et le détail les rend dans la même colonne. Deux colonnes, Fichier et État, chaque ligne tenant sur la hauteur fixe qu'exige le défilement virtuel : le détail d'une ligne (motif d'un échec, ou critère, chemins et tailles du fichier retenu et des écartés pour un doublon) se lit au survol de l'icône d'information qui suit le tag d'État, dans un tooltip large. Les tailles sont rendues lisibles par `Intl` dans la langue courante, en Mo au-dessus d'un mégaoctet et en Ko en dessous : un fichier tronqué par une copie interrompue pèse quelques Ko et c'est précisément ce que le départage doit montrer. La fonction d'aplatissement reçoit cette mise en forme en paramètre, pour rester pure et sans langue. Ce qui demande un geste ouvre la liste (échecs, introuvables, doublons départagés, puis déjà présents et extraits), sans tri à l'intérieur d'une catégorie.
- **La couleur n'est jamais seule porteuse d'information** : chaque catégorie s'affiche avec une icône et un libellé traduit, conformément à DESIGN.md § Couleurs Sémantiques. Extrait et doublon départagé sont des issues positives en `success`, déjà présent est neutre en `secondary`, introuvable et transfert en échec sont en `danger` avec deux icônes distinctes, leurs corrections étant opposées. `info` et `warn` ne sont portés par aucune ligne : un doublon départagé n'attend aucun geste.
- **Action d'extraction conditionnée** : elle n'est disponible que si les deux dossiers et la playlist sont choisis, qu'une playlist est sélectionnée lorsque le fichier est un dump, que le sidecar a annoncé le format du fichier, que `SidecarService.ready` est vrai (sidecar lancé, version reçue et concordante, aucune extraction en cours) et qu'aucune recherche de tagging ne tourne : le sidecar refuse une extraction pendant un run (`tagging_in_progress`), le bouton ne l'offre donc pas. La commande applique la même garde que le bouton. Une divergence qui ne serait pas encore contrôlée faute de version reçue bloque donc aussi et un double clic ne lance pas deux extractions. Chacune de ces conditions est un signal calculé, ce qui rend le blocage lisible et testable. Le tooltip du bouton dit pourquoi il est indisponible : la recherche en cours, ou la liste des choix manquants, jointe par `Intl.ListFormat` dans la langue courante.
- **Attente d'une liste de playlists** : le service efface la réponse précédente à chaque listage. Un fichier choisi dont le format n'est pas encore annoncé, sans erreur reçue, affiche le `p-skeleton` ; la réponse d'un fichier précédent ne reste jamais affichée. Une extraction lancée affiche une barre indéterminée jusqu'au premier `progress`.
- **Choix figés pendant un run** : le formulaire entier cède la place à une ligne de résumé (source › destination › playlist · mode, lue dans les choix du dernier run) dès le lancement, la barre de progression dessous et « Modifier » est désactivé tant que l'extraction tourne (cf. [DESIGN.md](../../../DESIGN.md) § Structure de Page, « Onglet Playlist en deux temps »). Une fois le run fini, « Modifier » rouvre le formulaire au-dessus du rapport, que le lancement suivant replie de nouveau. Retirer les contrôles du DOM plutôt que les désactiver un à un rend le rapport plus haut et ferme le même risque : un listage envoyé en plein run remplacerait les playlists affichées et les choix affichés ne décriraient plus l'extraction en cours.
- **Un onglet rouvert reprend les choix du dernier run**, que le service garde avec son rapport : les trois chemins, le mode et si le fichier listé est celui du run, la playlist choisie.
- **« Passer au tagging »** : bouton `primary` outlined sous le rapport, avec le compteur « Extraction terminée (N sur N) », une fois l'extraction terminée. Il ouvre l'onglet Tagging. La destination est mémorisée comme dernier dossier extrait (`writeLastDestination`) au lancement de l'extraction : l'onglet suivant la préremplit, rien n'est transporté par la navigation.
- **Traductions d'erreurs gardées par des tests de cohérence** : les `code` vivent en Python et leurs phrases en JSON. Un test du sidecar vérifie que chaque `code` d'erreur a sa clé dans `errors` des deux fichiers de langue et le test des fichiers de langue fait de même pour `SIDECAR_UNAVAILABLE`. Sans eux, une clé manquante ne se verrait qu'à l'écran, en `errors.<code>` brut. `ErrorMessageComponent` joint un paramètre en liste avant l'interpolation, que ngx-translate écrirait sans espace.
- **Divergence de version et sidecar absent signalés par le shell** : l'écran bloquant de `AppComponent` remplace les onglets (cf. sub-project 06), la page n'a pas de message propre. `ready` garde néanmoins l'action : ARCHITECTURE impose de refuser de lancer un run dans ces cas.
- **Préférence de mode dans le `store` de Tauri**, isolée dans `core/preferences.ts` qui retombe silencieusement sur la valeur par défaut hors Tauri, comme la résolution de langue. La copie est le défaut, la source restant alors intacte. Le même module garde la dernière destination extraite.
- **Libellés entièrement traduits**, aucune largeur fixe posée sur du texte traduit, et les motifs d'échec du sidecar affichés par des clés de traduction plutôt que par leur valeur brute : le sidecar n'émet jamais de phrase destinée à l'utilisateur.
- **Layout de DESIGN.md** (§ Structure de Page) : le container pleine largeur (`px-16 py-8`) est porté par le shell, la page pose `PAGE_HOST` (colonne en `gap-6`) et son contenu. Le formulaire est une grille de trois colonnes (libellés, contrôles de même largeur, chemins alignés à droite), le bouton d'extraction sur la ligne du mode à la largeur des libellés et des contrôles réunis. Le shell occupe toute la hauteur et la table remplit ce qui reste (`scrollHeight="flex"`) : le défilement vit dans la table, jamais dans la page. Un sélecteur annulé garde le chemin déjà choisi.
- **`icon.component.ts` étendu selon son motif documenté** : un nom dans le tableau, un import, un `@case`. Le tableau existe précisément pour que le test parcoure la liste, Angular ne vérifiant pas l'exhaustivité d'un `@switch`.
- **`source-logo.component.ts` implémenté en SVG inline** : les fichiers de `src/assets/icons/` ne sont pas émis par le build et c'est voulu : `currentColor` ne fonctionne pas sur une balise `img` et les câbler dans la configuration d'assets embarquerait des fichiers morts dans l'installeur.

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
**THEN** le shell affiche son écran bloquant, qui porte les deux versions, à la place des onglets
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
**THEN** la table porte une ligne par morceau avec sa catégorie, plus une ligne par doublon départagé
**AND** chaque catégorie s'affiche avec une icône et un libellé, jamais par la couleur seule
**AND** les échecs, les introuvables et les doublons départagés précèdent les déjà présents et les extraits
**AND** le détail d'un doublon, le candidat écarté et le critère appliqué, se lit au survol de son État
**AND** le motif traduit d'un échec se lit de même

### Scénario 12 : Sidecar indisponible
**GIVEN** une interface servie sans sidecar
**WHEN** l'application démarre
**THEN** le shell affiche son écran bloquant à la place des onglets
**AND** l'action d'extraction est indisponible

### Scénario 13 : Extraction bloquée tant que le sidecar n'est pas prêt
**GIVEN** tous les chemins choisis, mais une version pas encore reçue ou une extraction déjà en cours
**WHEN** l'utilisateur regarde l'action d'extraction
**THEN** elle est indisponible

### Scénario 14 : Extraction bloquée pendant une recherche de tagging
**GIVEN** tous les choix faits et une recherche de tagging en cours
**WHEN** l'utilisateur regarde l'action d'extraction
**THEN** elle est indisponible
**AND** son tooltip dit qu'un run est en cours

### Scénario 15 : Choix figés pendant une extraction
**GIVEN** une extraction en cours
**WHEN** l'utilisateur regarde l'écran
**THEN** le formulaire est replié derrière sa ligne de résumé, qui nomme les choix du run et « Modifier » est indisponible
**AND** la barre de progression s'affiche sous le résumé
**AND** aucun listage n'est envoyé au sidecar

### Scénario 16 : Formulaire rouvert après le run
**GIVEN** une extraction terminée et son rapport affiché
**WHEN** l'utilisateur clique sur « Modifier »
**THEN** le formulaire se rouvre au-dessus du rapport, qui reste affiché
**AND** le lancement suivant le replie de nouveau

### Scénario 17 : Passage au tagging
**GIVEN** une extraction terminée
**WHEN** l'utilisateur clique sur « Passer au tagging »
**THEN** l'onglet Tagging s'ouvre
**AND** la destination de l'extraction est mémorisée comme dernier dossier extrait

### Scénario 18 : Onglet rouvert
**GIVEN** une extraction lancée depuis l'onglet Playlist, puis un autre onglet affiché
**WHEN** l'utilisateur revient sur Playlist
**THEN** les trois chemins, le mode et la playlist du dernier run sont restaurés
**AND** le résumé et le rapport du run restent affichés

## Tests à écrire

### Unit

- `src/app/features/playlist/extraction-rows.spec.ts` :
  - un résultat vide ne produit aucune ligne
  - les cinq catégories sont aplaties en lignes, une par entrée du résultat
  - une ligne porte la catégorie de son morceau
  - ce qui demande un geste précède ce qui est passé tout seul
  - la ligne d'un doublon porte le chemin du candidat écarté, sa taille et le critère
  - les chemins et tailles de plusieurs candidats écartés restent alignés, dans leur ordre
  - la ligne d'un échec porte une clé de motif, jamais la valeur brute
  - deux morceaux d'une même catégorie gardent leur ordre d'entrée

- `src/app/shared/utils/file-size.spec.ts` :
  - un morceau s'affiche en Mo, un fichier tronqué en Ko, avec une décimale au plus
  - l'unité et le séparateur suivent la langue de l'interface

- `src/app/features/playlist/playlist-page.component.spec.ts` :
  - l'action d'extraction est indisponible tant qu'un chemin manque et le tooltip nomme chaque choix manquant
  - l'action est indisponible sur un dump dont aucune playlist n'est sélectionnée, disponible sur un M3U8 sans playlist
  - l'action est indisponible quand le sidecar n'est pas prêt, tant que le format n'est pas annoncé, ou pendant une recherche de tagging (avec son tooltip)
  - un fichier dont le listage a échoué est à rechoisir
  - un fichier choisi attend la réponse du sidecar tant que son format n'est pas annoncé
  - le choix du fichier demande le listage des playlists
  - le mode copie est retenu par défaut, le mode enregistré au run précédent est restauré
  - un sélecteur de dossier annulé garde le dossier déjà choisi
  - la commande émise porte les chemins, le nom de playlist et le mode courants et aucune n'est émise quand l'action est indisponible
  - la destination est mémorisée comme dernier dossier extrait au lancement
  - le formulaire se replie au lancement, « Modifier » le rouvre une fois le run fini et le lancement suivant le replie de nouveau
  - le résumé nomme la playlist du run affiché, ou le fichier d'un M3U8
  - un onglet rouvert reprend les choix du dernier run et le fichier listé depuis sans sa playlist
  - « Passer au tagging » ouvre l'onglet Tagging

- `src/app/shared/components/error-message.component.spec.ts` :
  - un paramètre d'erreur en liste est joint avant la traduction

- `src/app/core/preferences.spec.ts` :
  - un mode déplacement enregistré est restitué
  - une valeur enregistrée illisible retombe sur la copie
  - un `store` impossible à charger retombe sur la copie

- `sidecar/tests/unit/test_error_translations.py` :
  - chaque `code` d'erreur du sidecar, `malformed_command` compris, a sa clé dans `errors` de chaque fichier de langue

- `src/app/core/translations.spec.ts` :
  - `SIDECAR_UNAVAILABLE` a sa clé dans `errors` des deux fichiers de langue

Le rendu d'un composant PrimeNG, le masquage d'un bloc par un `@if` et la sérialisation d'une commande ne sont pas testés : ce sont des comportements de framework ou de bibliothèque, qu'une mise à jour ferait échouer sans qu'aucune règle du projet ait bougé.

## Edge cases

- **Playlist vide dans un dump** : l'option apparaît avec un compte de zéro, et l'extraction rend un rapport vide, affiché par le bloc vide de DESIGN.md dans la table. Rien n'est masqué : un compte à zéro est une information.
- **Fichier choisi qui n'est ni un dump ni un M3U8 lisible** : le sidecar émet une erreur, affichée en message inline, et aucun sélecteur n'apparaît.
- **Second fichier choisi après un premier** : le sélecteur, le logo et l'erreur du fichier précédent disparaissent dès le choix, le squelette s'affiche jusqu'à la nouvelle réponse.
- **Deux extractions successives** : le rapport précédent est remplacé dès le lancement de la seconde, pour qu'aucun résultat périmé ne reste affiché pendant que la nouvelle tourne. Les lignes en attente du rapport sont des lignes de squelette.
- **Extraction demandée pendant un run de tagging** : le bouton est indisponible et son tooltip le dit. Le sidecar la refuserait de toute façon, en `tagging_in_progress`.
- **Rapport très long** : le défilement virtuel de la table couvre le cas, la page elle-même ne défilant jamais.
- **Chemin très long** : la troncature par la gauche garde la fin du chemin lisible, qui est la partie utile. Le chemin complet se lit au survol, sans que le bouton voisin change de taille.
- **Sélecteur annulé** : le chemin déjà choisi reste en place, un annuler n'étant pas un choix.
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
- Le coût est faible et payé au bon moment : les specs 01, 04 et 06 ont été amendées avant leur implémentation (liste vide pour un M3U8, champ `playlist_format` de `playlists_listed`, signal `playlistFormat`)

### Décision : Le rapport est rendu en table unique plutôt qu'en sections par catégorie

**Options envisagées :**
- **A. Une table dense, une ligne par morceau, colonne de catégorie et colonne de détail** : un seul composant de liste, aligné sur la liste du run de l'onglet Tagging. Les cinq catégories sont aplaties par une fonction pure, testable sans monter le composant.
- **B. Une section par catégorie** : chaque bloc peut adopter la mise en forme qui lui convient, notamment pour les doublons, mais multiplie les composants et éloigne cet écran du récapitulatif employé ailleurs.

**Choix : A**

**Rationale :**
- L'utilisateur cherche un morceau, pas une catégorie : une liste unique répond à « qu'est devenu ce titre » sans lui faire parcourir cinq blocs
- La table dense à défilement virtuel est déjà le pattern du projet pour les listes de run, et DESIGN.md ne documente aucun autre rendu de résultat
- L'aplatissement en lignes isole la seule vraie transformation de cet écran dans une fonction pure, ce qui la rend testable sans framework
- Remplacé le 2026-09-25 en ce qui concerne la colonne de détail : la table compte deux colonnes, Fichier et État, le détail d'une ligne se lisant au survol de l'icône d'information de l'État (DESIGN.md § Structure de Page, colonnes du rapport d'extraction). Le choix d'une table unique tient.

### Décision : Le tag d'état partagé n'est pas élargi aux catégories d'extraction

**Options envisagées :**
- **A. Cet écran pose son propre rendu de catégorie**, et le composant partagé reste réservé aux champs `state` et `resolution` d'un morceau retagué.
- **B. Élargir le composant partagé aux deux vocabulaires** : un seul composant de tag pour toute l'application, au prix d'un mélange de deux ensembles de valeurs sans recouvrement.

**Choix : A**

**Rationale :**
- Le commentaire du composant partagé dit qu'il encode son mapping « pour ne pas être re-dérivé de travers écran par écran » : y mêler un second vocabulaire ferait précisément ce qu'il cherche à éviter
- Les catégories d'une extraction et les états d'un morceau retagué n'ont aucune valeur en commun, et rien ne dit qu'ils évolueront ensemble
- Le composant partagé sert la liste du run de l'onglet Tagging : l'élargir aux catégories d'une extraction mêlerait deux vocabulaires sans recouvrement dans le composant qui doit les garder séparés

### Décision : Couleurs des catégories alignées sur les familles de DESIGN.md plutôt que sur leur ressemblance visuelle

**Options envisagées :**
- **A. Rattacher chaque catégorie à la famille qui décrit son issue** : extrait et doublon départagé en `success`, déjà présent en `secondary`, introuvable et échec en `danger` avec deux icônes.
- **B. Donner une couleur propre à chaque catégorie**, le doublon en `info` pour le distinguer d'un extrait.

**Choix : A**

**Rationale :**
- `info` signifie « décision attendue » dans DESIGN.md : un doublon déjà départagé l'afficherait comme un geste à faire
- Le libellé porte la voie, jamais la couleur : « Doublon départagé » se distingue d'« Extrait » par son texte, et le détail dit quel fichier a été retenu
- Deux rouges aux corrections opposées (retrouver le fichier, relancer le transfert) ne partagent pas l'icône, comme les deux échecs d'un morceau retagué
