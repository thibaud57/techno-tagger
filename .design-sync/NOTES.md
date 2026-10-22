# Notes de sync du design system

## Le projet Claude Design et ce qui fait foi

| Projet | Lien | Rôle |
| --- | --- | --- |
| Techno Tagger Design System (`66daf6c5-f225-4dcc-bf7d-1d792e633ee5`) | https://claude.ai/design/p/66daf6c5-f225-4dcc-bf7d-1d792e633ee5 | Les **composants** (miroir JSX, `.d.ts`, fiche `.prompt.md` et carte par composant), les tokens, les guidelines, les quatre logos et la **maquette** cliquable de l'application dans `ui_kits/techno-tagger/` (un fichier par écran, `AppShell.jsx` pour le shell) |

Un seul projet ici, composants et maquette ensemble. Trois sources se lisent dans cet ordre avant
d'implémenter un écran :

1. `docs/DESIGN.md` fait foi sur les règles et les composants. Le projet Claude Design a été
   généré depuis lui (son `readme.md` § 1), jamais depuis le code.
2. La maquette fait foi sur **à quoi l'écran ressemble**. Là où DESIGN.md se tait, c'est une
   proposition à trancher, puis à écrire dans DESIGN.md. Là où les deux se contredisent,
   DESIGN.md gagne.
3. La spec du sub-project dit ce que l'écran fait.

La rule `.claude/rules/design/claude-design.md` impose cette lecture : un écran écrit sans ouvrir
la maquette en diverge (constat du 2026-09-16 sur l'onglet Playlist, cf. Journal).

## Comment ce dépôt se synchronise

Un push, dans l'ordre :

1. Relire sur le distant (`get_file`) chaque fichier à modifier et le comparer à l'export local
   `.design-sync/design-system/`, ignoré par git et donc absent après un clone : le distant fait foi
2. Modifier l'export local, puis `finalize_plan` sur la liste exacte des chemins et `write_files`
   depuis l'export (`localPath`)
3. Ajouter à `readme.md` § Réserves l'entrée datée de l'alignement
4. Poser `_ds_needs_recompile`, puis retirer de `docs/DESIGN.md` § Arbitrages les écarts réalignés
   (leur règle vit dans leur section), vider le Reste ouvert ci-dessous et écrire l'entrée du Journal

- **Le convertisseur de `/design-sync` ne s'applique pas et le lancer détruirait le projet
  distant** : le skill empaquette un `dist/` React ou un Storybook pour que l'agent de design rende
  les composants compilés du dépôt. Ici il n'y a ni l'un ni l'autre : les composants sont Angular
  et `package.json` est `private` sans `main`, `module`, `exports` ni `types`. Le
  danger n'est pas qu'il échoue : sa clôture **supprime du distant tout ce que le build local ne
  contient pas** sous `components/`, `tokens/`, `guidelines/`, `_preview/`, `fonts/` et `_vendor/`.
  Avec un build vide, elle efface le design system et la maquette. Les composants du projet Claude
  Design sont des recréations React bâties depuis DESIGN.md (son `readme.md` § Réserves), pas le
  code livré.
- **Le design system s'écrit donc fichier par fichier** : `components/<groupe>/<Nom>.{jsx,d.ts,prompt.md}`,
  une carte `<groupe>.card.html` par dossier, `ui_kits/techno-tagger/<Écran>.jsx` pour la
  maquette, via `finalize_plan` puis `write_files` de l'outil `DesignSync`.
- **Tenir `readme.md` § Réserves à jour** : sa dernière entrée porte la date du dernier alignement
  contre `docs/DESIGN.md` et ce qui a changé. Un push qui ne la touche pas laisse le lecteur
  suivant sur un état faux.
- **Finir par `_ds_needs_recompile`** (`{"by":"design-sync-manual"}`) : c'est lui qui déclenche
  l'auto-contrôle de l'app à l'ouverture du projet, qui relit les `.d.ts`, réenregistre les
  cartes, régénère `_ds_manifest.json` et l'adherence, puis l'efface.
- **Pas de `_ds_sync.json`** : cette ancre décrit un build du convertisseur. Sans elle, le prochain
  sync revérifie tout, ce que le skill appelle le choix honnête hors convertisseur.
- **`config.json` porte `mode: manual`** : clé hors schéma du skill, qui ferait échouer un run du
  convertisseur avec un message nommant la clé. C'est voulu, il n'a rien à faire ici.
- **Prévisualiser avant le push** : cartes et écrans lisent `_ds_bundle.js`, qui n'a un composant
  ajouté qu'après la recompilation distante. Pour les contrôler en local, servir l'export
  (`python -m http.server`) et substituer au bundle un build esbuild de `components/*/*.jsx`
  (`--bundle --format=iife --global-name=TechnoTaggerDesignSystem_66daf6 --alias:react=<shim>`,
  le shim rendant `window.React`), par une route Playwright sur `**/_ds_bundle.js`. Le navigateur garde
  l'ancien bundle en cache : vider le cache (CDP `Network.clearBrowserCache`) avant de conclure
  qu'un composant manque.
- **Ne jamais modifier la maquette sans demande explicite** : c'est le fichier de design du
  propriétaire, pas un artefact généré.
- **L'export local n'est un miroir que comparé au distant** : une session peut pousser sans le
  mettre à jour, et rien ne le signale. Relire le fichier distant avant d'en pousser un, jamais
  une copie locale. `DesignSync` n'est disponible que dans la session principale et les agents
  lancés au premier plan : un agent en arrière-plan ne l'a pas.

## Reste ouvert

Ce que le code livre et que le projet Claude Design n'a pas encore, à pousser au prochain sync.

- **`AppShell`** : note d'échec d'installation de l'invite de mise à jour, livrée par le code, absente de la maquette (constaté le 2026-10-21).
- **`AppShell` et `Tabs`** : barre d'onglets de DESIGN.md § Arbitrages « Barre d'onglets » (nom de l'application à gauche, Playlist et Tagging au centre avec leur icône, Réglages en engrenage à droite après les badges, trait sur la bordure de l'onglet), livrée par le code ; la fiche `Tabs` dit encore « aucune icône » (décidé le 2026-10-22).
- **`SettingsScreen` et `SectionMenu`** : menu et section dans un seul panneau jusqu'en bas, icône devant chaque entrée du menu (DESIGN.md § Arbitrages « Menu des Réglages »), livrés par le code (décidé le 2026-10-22).
- **Fondations** (DESIGN.md § Arbitrages « Fondations harmonisées », § Bordures) : table encadrée, titre de section en 18px, badge en 12px, `info` en `sky`, pieds de modale à 8px, corps de modale atténué, filets de liste en `surface-800`, livrés par le code (décidé le 2026-10-22).

## Journal

- **2026-09-16, audit de l'onglet Playlist** : comparaison de l'écran livré contre DESIGN.md et
  `ui_kits/techno-tagger/PlaylistScreen.jsx`, écarts consignés dans la conversation de revue. Création de ce dossier, de la rule et du lien dans DESIGN.md § Ressources. Aucun push
  encore effectué depuis ce dépôt.
- **2026-09-17, variations de l'onglet Playlist** : neuf directions explorées par
  `/swarm-ui-variations`, dont une calquée sur `PlaylistScreen.jsx`. Le mix retenu (grille compacte,
  deux temps, résumé, table pleine hauteur) est livré en `2d3b10e`. Aucun
  push vers le projet Claude Design.
- **2026-09-24, premier push du design system** : `readme.md` réaligné sur `docs/DESIGN.md` après
  la livraison des onglets Playlist et Tagging, avec sa réserve n° 8 datée. Les deux régimes de
  largeur cèdent au container unique, les tables reviennent à leur taille par défaut, la colonne
  Pochette passe à 48px et les trois colonnes fixes du run cessent d'annoncer des pixels. La fiche
  `Password` dit enfin que `p-password` est déprécié et que l'app compose son champ à la main.
  Cinq composants rejoignent le catalogue, chacun avec son `.jsx`, son `.d.ts` et sa fiche :
  `Card`, `ErrorMessage`, `PathPicker`, `PhaseProgress`, `TruncatedText`. `_ds_needs_recompile`
  posé en fin de push.
- **2026-09-24, alignement des écrans** : les quatre écrans de `ui_kits/techno-tagger/` suivent
  l'interface livrée à cette date. `TaggingScreen` reçoit son sélecteur de dossier, garde son bouton
  de lancement visible et grisé plutôt que de le masquer et son bloc vide dit « Aucun run lancé ».
  `SettingsScreen` perd la rangée « URL de l'API » (devenue une constante du sidecar) et gagne le
  tag d'état de la clé. `PlaylistScreen` passe en deux temps, résumé puis rapport en table à deux
  colonnes, sélecteurs en primaire outlined. `AppShell` rend l'écran bloquant en carte neutre et
  non plus en pavé d'alerte. Container unique et tiret simple entre artiste et titre appliqués
  partout. Les composants ajoutés au catalogue n'étant pas encore dans le bundle compilé, que la
  recompilation régénère, les écrans composent leur motif avec les primitives déjà exportées.
- **2026-09-25, ce que la passe du 24 avait manqué** : le push du 24 avait réaligné `readme.md`,
  les cartes et les écrans, mais ni `tokens/spacing.css` ni les fiches de composant, qui
  annonçaient encore le régime formulaire à 768px, la colonne Pochette à 32px, les trois colonnes
  fixes à des largeurs que le code ne porte pas et les tables en `[size]="'small'"`. Les tokens
  reçoivent le container unique et les largeurs réellement livrées (48 / 144 / 128 / 160px, plus
  197px pour l'État du rapport), `DataTable` passe au cran par défaut en gardant sa police dense,
  sa fiche gagne la cellule sans valeur et les trois états de pochette et la carte « Deux régimes
  de largeur » cède la place à « Un seul container ». Deux règles du readme qui contredisaient le
  code tombent : le cadratin rejoint le point médian parmi les glyphes Unicode admis et la
  vignette compte trois états. `TaggingScreen` corrige « Phase réseau terminée » en « Recherche
  terminée » et porte les trois états. Réserve n° 9 datée, `_ds_needs_recompile` posé.
  Second passage le même jour : `SkeletonRows`, livré entre-temps côté application, remet deux
  temps là où la règle du chargement n'en voyait qu'un. Une table encore vide se couvre de
  lignes entières en squelette et non de son bloc vide, qui annoncerait l'inverse de ce qui se
  passe ; le squelette ne se réduit à la vignette qu'une fois la première ligne reçue. Le même
  passage livre « Non traité » : la famille Neutre gagne un second glyphe, `minus-circle`, pour
  le morceau qu'un run interrompu n'a jamais atteint, l'horloge y promettant une suite qui ne
  viendra pas. Et un bloc vide porte dès lors un titre **et** une phrase, jamais un titre seul.
- **2026-09-25, interruption d'un run et fiches contradictoires** : `TaggingScreen` reçoit
  « Interrompre » à gauche du lancement et `AppShell` arrête le run simulé au clic. `StateTag` rend
  enfin « Non traité » par sa prop `interrupted` : le readme l'annonçait, le composant s'arrêtait
  à « En attente ». Le toast du kit dit « Recherche terminée ». Cinq fiches contredisaient
  DESIGN.md des deux côtés, local comme distant : `Tooltip` annonçait un fondu de 200ms là où
  PrimeNG code 250, ignorait ses trois exceptions et écrivait un cadratin entre artiste et titre,
  `motion.css` et sa carte oubliaient l'exception du tooltip et un quatrième usage du fondu,
  `DataTable` taisait la prop `loading` qu'il porte, `StateTag.d.ts` le `source_unavailable` du
  contrat. Réserve n° 11 datée, `_ds_needs_recompile` posé.
- **2026-09-25, export local complété** : les treize fichiers que la passe du 24 avait laissés
  absents ont été tirés du distant (`.jsx` et `.d.ts` de `PhaseProgress`, `Card`, `ErrorMessage`,
  `PathPicker`, `TruncatedText`, plus trois fiches). Aucune ne portait de règle périmée. L'export
  est alors un miroir exact, ce qui rend de nouveau fiable une lecture locale.
- **2026-09-25, audit de DESIGN.md contre le code** : cinq écarts corrigés à la source, dont deux
  que le readme distant héritait. La règle du `danger` distingue dès lors une action destructive
  d'une sévérité qui rapporte un état, le décompte figé des libellés d'état disparaît, le toast
  « clé enregistrée » cède au tag persistant qu'affiche réellement l'écran et les deux boutons de
  lancement rejoignent leur famille du Mapping. `DESIGN.md` reçoit sa rubrique « Maquette et design
  system externes », que le skill `design-doc` réclame : sans elle, les commandes de décomposition
  et d'implémentation ne savent pas qu'une maquette existe ni où la lire.
- **2026-09-25, états vides et motifs** : réserve n° 10. Le motif d'un non résolu se lit au
  survol de son état (icône `info-circle`), `failure_reason` gagne `source_unavailable`. Les deux
  écrans couvrent tous leurs cas vides : bloc encadré avant la première extraction ou le premier
  run, dont la phrase suit le dossier choisi, lignes en squelette pendant une phase, bloc de table
  une fois la phase finie. `EmptyState` gagne `framed`, `DataTable` gagne `loading` (miroir de
  `SkeletonRows`) et perd le commentaire qui la disait toujours `small`, la fiche d'`EmptyState`
  passe au vouvoiement. « Passer au tagging » passe en `primary` outlined, aligné à droite avec la
  ligne de fin. Le tooltip compte trois exceptions et un fondu de 250ms. Les huit fichiers poussés
  sont recopiés dans l'export local, `_ds_needs_recompile` posé.
- **2026-09-25, « Extraire la playlist » sur la ligne du mode** : réserve n° 12. Le bouton quitte
  sa ligne pour celle du mode, calé à droite, sans changer de largeur : la grille devient un
  container et la largeur vaut `100cqw` moins la colonne des chemins et un gap. `PlaylistScreen`
  et `readme.md` poussés après relecture du distant, `_ds_needs_recompile` posé. Même jour, un
  contrôle désactivé garde la flèche du curseur comme l'application : `not-allowed` quitte six
  composants, la carte « Focus et désactivé » et le readme, relus sur le distant avant envoi.
  Puis Tagging perd son libellé et son « Aucun dossier sélectionné », le lancement descend sur
  la ligne du dossier : `TaggingScreen`, `PathPicker` (libellé facultatif, `pathAlign`), `Select`
  (libellé long coupé avec tooltip) et le readme poussés après relecture du distant.
- **2026-09-29, arbitrage utilisateur** : export local comparé en entier au distant, où
  `SettingsScreen.jsx` et `Password.prompt.md` étaient plus récents. Poussés : la modale
  d'arbitrage et la confirmation de sortie dans la maquette, la colonne Pochette à 60px, les
  icônes des boutons à 16px, `Listbox` sans sélection au survol, `DataTable.rowClickable`,
  `Button.loading`, `Message` sans plein écran, `TruncatedText` par `Tooltip`, `PhaseProgress`
  indéterminée sans compteur, tirets simples, point médian entre les deux seuils et `app-dark`
  dans les cartes. Réserve n° 13, `_ds_needs_recompile` posé.
- **2026-10-05, rattrapage par URL** : les cinq points du Reste ouvert poussés après relecture du
  distant, identique à l'export pour chaque fichier touché. `TaggingScreen` suit le bloc livré :
  aucune reconnaissance d'hôte, « Résoudre » actif dès le champ rempli, spinner, erreur sous la
  ligne, lignes rattrapées conservées, bloc borné et affiché après une interruption, barre « N sur
  M rattrapés », « Lancer le run » à la place de « Confirmer l'écriture ». `AppShell` joue le
  sidecar qui juge l'URL et ouvre la confirmation d'écriture de la Feature 5 par un lien
  `écriture ?` de la barre d'onglets. `ArbitrationDialog` coupe son en-tête par `TruncatedText` et
  gagne l'état d'erreur d'un geste. `gap-6` entre sections sur les trois onglets, gris nommés dans
  la modale et les Réglages. Réserve n° 14, README du kit et § Layout du readme à jour,
  `_ds_needs_recompile` posé. Second push le même jour : les fiches `InputGroup` et
  `ErrorMessage` et la carte des formulaires faisaient encore valider l'hôte par l'écran, elles
  suivent la règle du sidecar. Export local ensuite comparé fichier par fichier au distant et
  réaligné, `_ds_bundle.js`, `_ds_manifest.json` et `_adherence.oxlintrc.json` compris : miroir
  exact au 2026-10-05, hors binaires
  Troisième push après la revue en direct : un message d'erreur garde le même écart au-dessus et
  en dessous (DESIGN.md § Feedback et chargement), `TaggingScreen`, la fiche `ErrorMessage` et le readme suivent
- **2026-10-06, variations du rattrapage par URL** : cinq directions explorées par
  `/swarm-ui-variations` pour rendre la hauteur à la liste du run. Retenue : la modale par ligne,
  ajustée (hauteur au contenu, badge dans le shell, étape lien dans l'arbitrage). Aucun push, écarts
  listés dans § Reste ouvert.
- **2026-10-06, push du rattrapage par modale** : `TaggingScreen` perd `UrlRescue` au profit de
  la modale du lien et de l'indice « Coller un lien → », `AppShell` gagne le badge « N à
  rattraper » groupé avec celui de la file, `ArbitrationDialog` gagne l'étape lien. `readme.md`
  (§ Layout, `ErrorMessage`, réserve n° 15), le README du kit et les fiches `ErrorMessage` et
  `InputGroup`, passé en réservé, suivent. Maquette rejouée en local avant le push.
  `_ds_needs_recompile` posé en fin de push. Second push après audit : la fiche `DataTable`
  ouvre la modale du lien depuis une ligne non résolue, la carte des formulaires marque
  `InputGroup` réservé, et le readme et le README du kit disent le badge masqué et la modale
  désactivée pendant la recherche.
- **2026-10-11, revue d'écran de l'écriture, du rollback et des Réglages** : `docs/DESIGN.md` réécrit
  sur le gabarit du skill `design-doc` (Mapping par familles d'usage) et audité contre le code, puis
  le design system réaligné et poussé après relecture du distant, identique à l'export pour chaque
  fichier touché. 109 fichiers : `readme.md` (réserve n° 16), README du kit, `SKILL.md`, fiches et
  composants (`Tag` au style de `p-tag`, `Button` `link`, `Tooltip` sous l'élément, `Dialog`,
  `ConfirmDialog`, `Message`, `StateTag` « Restauré », `Badge`, `Toast`, `Password`, `DataTable` à
  chevron), trois composants ajoutés (`DialogHeader`, `SettingsRow`, `RollbackFailures`), tokens et
  cartes de fondations, maquette (bouton d'action unique, écriture et restauration, détail par
  blocs, en-têtes de modale, Réglages en rangées, `Recap` gardé comme écran prévu derrière le lien
  « récapitulatif ? »). `_ds_needs_recompile` posé.
  Second push le même jour : `SettingsRow` donne 12px à un retour en tête de zone, comme l'app. Troisième push :
  les écrans de la maquette appellent `DialogHeader`, `RollbackFailures`, `ConfirmDialog`, `SettingsRow`,
  `Message` et `StateTag` du catalogue au lieu de leurs recompositions locales, contrôlés avant le
  push sur un bundle esbuild des sources (§ Comment ce dépôt se synchronise). `Message` `small` passe
  à 26px, la hauteur mesurée dans l'app sur le bandeau de l'arbitrage (`min-h-6.5`) : à 28px, la liste
  bougeait de 2px au changement de source. Après la recompilation, `_ds_bundle.js`, `_ds_manifest.json` et
  `_adherence.oxlintrc.json` relus du distant dans l'export, maquette et cartes rejouées sur ce bundle
  sans erreur. Le gabarit `templates/app-shell`, resté à l'état d'avant le container unique (formulaire
  à 768px, « Re-tagging », six colonnes), suit l'app et est poussé : sa description dans le manifeste
  change à la recompilation suivante, à relire du distant.
- **2026-10-13, réalignement de la Feature 6** : les écarts laissés par la reprise, le récapitulatif et les runs passés sont poussés. `AppShell` ouvre le récapitulatif par « Récapitulatif » à côté de « Restaurer le run », rend les trois états de l'invite de reprise sans focus, dossier sur sa ligne, et une confirmation de sortie réduite à l'extraction, l'écriture et la restauration. `Recap` perd « Envoyer ce rapport », « Restaurer le run » et « Nouveau run » au profit d'un pied commun aux deux runs, retour à gauche et contexte à droite. `TrackDetail` passe à une pochette de 168px, « Restaurer ce morceau » dessous, 7 lignes dans tous les cas, ligne Source par logo et nom. `SettingsScreen` gagne la rangée « Runs passés ». `SourceLabel` rejoint le catalogue, `Icon` compte `search` et `external-link`, `Button` le second usage de `link`, `--tt-artwork-size-large` passe à 168px. Second passage le même jour, après rendu local des écrans : `Button` `small` repasse aux jetons d'Aura 3 (0.75rem, l'ancien 0.875rem débordait de « Restaurer ce morceau »), son libellé se coupe par une ellipse, et la note sur les filtres quitte le `Recap`. Réserve n° 17 datée, `_ds_needs_recompile` posé.
- **2026-10-13, pochette après restauration** : la confirmation de la restauration sépare ses deux
  phrases, « Les pochettes posées par l'écriture restent en place. » puis « Les commentaires retirés
  par l'écriture ne sont pas récupérés. » (ADR-011). Fichiers distants relus et identiques à l'export
  avant le push : `ConfirmDialog.prompt.md`, `overlay.card.html`, `AppShell.jsx`, `SettingsScreen.jsx`
  et `readme.md` (réserve n° 18). `_ds_needs_recompile` posé.
- **2026-10-13, clôture de la Feature 6** : `RollbackFailures` se place comme dans l'app, au-dessus
  de la liste du run et sous le bouton de restauration des Réglages, dans sa fiche, `readme.md`
  (réserve n° 19) et le README du kit. Fichiers distants relus et identiques à l'export avant le
  push. `_ds_needs_recompile` posé ; le Reste ouvert attend toujours la recompilation.
- **2026-10-14, décomposition de la Feature 7 (Réglages)** : `SettingsScreen` passe en menu latéral
  (API, Matching, Interface, Administration ; miroir de `p-menu` composé dans l'écran, une section
  affichée à la fois, page sans défilement), perd « Mode agent IA », « Motif de renommage » et le
  message sur le thème, gagne les bornes croisées et « Valeurs par défaut » en Matching, un select
  de langue mesuré sur « Français » et l'aide du signal sonore sur sa ligne, des aides Cache et Logs
  sans constante du moteur et « Ouvrir le dossier des logs ». `AppShell` termine le toast du vidage
  par un point. Les fiches `Slider` et `InputNumber` cessent d'écrire 70 et 90, `ToggleSwitch` ne
  cite plus « copie par défaut ». `readme.md` (§ Layout Réglages, réserve n° 20) et le README du
  kit suivent ; `docs/DESIGN.md` porte la ligne « Réglages » en § Structure de Page et les seuils
  lus du sidecar en § Post-MVP, sans arbitrage (correction directe de la maquette, demande du
  propriétaire). Écrans contrôlés en local (serveur HTTP sur l'export, Playwright à 1280 × 800,
  les quatre sections). Fichiers distants relus et identiques à l'export avant le push, sept
  fichiers poussés, `SettingsScreen.jsx` en CRLF comme le distant. `_ds_needs_recompile` posé.
- **2026-10-15, seuils de matching (sub-project 03 de la Feature 7)** : le contrôle de fidélité de `/verify` a relevé trois écarts entre l'écran livré et les miroirs, tranchés par le propriétaire en faveur de DESIGN.md (boutons `small` partout, rendu natif d'Aura) puis réalignés dans le même passage. `InputNumber` gagne `size` (`small` : jetons `--p-form-field-sm-*`, `4rem`) et perd ses boutons de pas par défaut ; `Slider` reprend piste, plage et poignée d'Aura ; `SettingsScreen` pose `size="small"` sur les deux champs, la carte des formulaires suit. `readme.md` § Réserves n° 21 et les deux arbitrages de `docs/DESIGN.md` (réalignés le 2026-10-15) suivent. Fichiers distants relus et identiques à l'export avant le push, neuf fichiers poussés, `SettingsScreen.jsx` et `readme.md` en CRLF comme le distant. `_ds_needs_recompile` posé. Le bouton des seuils passe aussi à l'infinitif, « Rétablir les valeurs par défaut », comme tous les libellés d'action de l'application (rule ngx-translate) : maquette, README du kit, fiche `Slider` et `readme.md` poussés dans un second passage. Écrans non rendus en local après les pushs : l'effet des deux changements est borné aux deux champs des seuils, contrôlé sur l'application.
- **2026-10-16, administration des Réglages (sub-project 04 de la Feature 7) et réécriture de `docs/DESIGN.md`** : l'export local réaligné composant par composant sur DESIGN.md, le code et Aura 3.0.1 (`@primeuix/themes` installé), après six audits parallèles (157 écarts). 131 fichiers poussés : `readme.md` (réserve n° 22), `SKILL.md`, `_adherence.oxlintrc.json` (`warn` dans la regex de `badgeSeverity`), `thumbnail.html`, les fiches et composants de `forms`, `feedback`, `data`, `overlay`, `navigation` et `icons`, les 21 cartes de `guidelines`, les tokens, le gabarit `app-shell` et les huit fichiers du kit. Maquette : menu des Réglages au rendu de `p-menu`, Cache et Logs grisés selon le moteur, colonne des libellés à 10rem et rangées jointives, curseurs des seuils sur 0-100, écran bloquant à l'anatomie de nos modales, champ de lien en `small`. Distant non rouvert depuis le push du 2026-10-15 (`_ds_needs_recompile` encore présent) et relu fichier par fichier pendant l'alignement, identique à l'export d'avant aux fins de ligne près ; `tokens/base.css` repassé en LF comme le distant. Bundle esbuild et cinq écrans compilés, rendus dans Chromium sans exception. Six arbitrages de DESIGN.md datés « réaligné le 2026-10-16 » ; quatre phrases de DESIGN.md corrigées (opacité des contrôles désactivés, anneau des boutons `secondary` et `danger`, sélection d'une liste contre segment du `p-selectbutton`, plein des validations). `_ds_needs_recompile` posé.
- **2026-10-19, alignement de l'export et push, la maquette est un exemple et non un miroir** : l'export local réaligné sur `docs/DESIGN.md` et le code, puis poussé après relecture du distant, sans dérive. 35 fichiers écrits, 12 créés (`Artwork`, `NoValue`, `CloseConfirmation`, `SectionMenu`, chacun en `.jsx`, `.d.ts` et `.prompt.md`) et 23 modifiés, aucune suppression : `readme.md` (réserve n° 23), `ui_kits/techno-tagger/` (`AppShell`, `SettingsScreen`, `TaggingScreen`, README), `Tooltip`, `Dialog`, `TruncatedText`, `DataTable`, `Skeleton`, `Tabs`, `Tag`, `Button`, `InputGroup`, `Icon`, `SourceLogo` et les cartes `overlay`, `data` et `navigation`. `Recap` reçoit « Envoyer ce rapport », le tooltip compte quatre exceptions, les cadratins de prose quittent les `.d.ts` et `Dialog.prompt.md` cite `core/platform/theme.ts`. Fins de ligne alignées sur celles du distant. `_ds_needs_recompile` était déjà posé des deux côtés : la recompilation du bundle reste à faire côté Claude Design, et les quatre nouveaux composants ne se rendent dans la maquette qu'après elle. Décision du propriétaire : `ui_kits/techno-tagger/` montre les bons composants du design system et les bonnes règles, sans rejouer chaque état du code (écran bloquant de divergence de version, détail à 4 lignes, squelette du sélecteur de playlist, récapitulatif en chargement ou sans run, résumé d'un M3U8). Ces états ne sont donc plus un écart à combler. Un composant, une règle ou une exception du mapping de `docs/DESIGN.md` qui manque à l'export reste un écart.
- **2026-10-20, recompilation et `SourceLabel`** : bundle recompilé à l'ouverture du projet, `_ds_manifest.json` liste `Artwork`, `NoValue`, `SectionMenu`, `CloseConfirmation` et `SourceLabel`. `TaggingScreen` et `templates/app-shell/AppShell.dc.html` appellent `SourceLabel` à la place de leur recomposition, `readme.md` (réserve n° 23) le date. Trois fichiers poussés après relecture du distant, sans dérive, `_ds_needs_recompile` posé.
- **2026-10-20, clôture de l'epic Distribution et mise à jour** : `docs/DESIGN.md` audité contre le code et le skill `design-doc` (quatre audits parallèles, 18 corrections vérifiées), puis l'export aligné et poussé. Distant relu avant le push : identique à l'export pour chaque fichier touché, seuls `_ds_bundle.js`, `_ds_manifest.json` et `_adherence.oxlintrc.json` y étaient plus récents (recompilation du 2026-10-20) ; le bundle est rapatrié, le manifeste et l'adherence non (la recompilation suivante les régénère). Neuf fichiers poussés : `AppShell.jsx` (invite de mise à jour, badge « Mise à jour X.Y.Z », lien `mise à jour ?`), `SettingsScreen.jsx` (rangée Version), le README du kit, `readme.md` (réserve n° 24), `Icon` (`.d.ts`, fiche, carte) et `brand-icons.card.html` (`download`, 26 glyphes ; 20px pour un message et le logo d'en-tête de modale). Maquette rendue en local sur le bundle recompilé, 18 contrôles verts sans erreur console. Les deux arbitrages de l'epic datés « réaligné le 2026-10-20 », § Reste ouvert vidé. `_ds_needs_recompile` posé.
