# Notes de sync du design system

## Le projet Claude Design, et ce qui fait foi

| Projet | Lien | Rôle |
| --- | --- | --- |
| Techno Tagger Design System (`66daf6c5-f225-4dcc-bf7d-1d792e633ee5`) | https://claude.ai/design/p/66daf6c5-f225-4dcc-bf7d-1d792e633ee5 | Les **composants** (miroir JSX, `.d.ts`, fiche `.prompt.md` et carte par composant), les tokens, les guidelines, les quatre logos, et la **maquette** cliquable de l'application dans `ui_kits/techno-tagger/` (un fichier par écran, `AppShell.jsx` pour le shell) |

Un seul projet ici, composants et maquette ensemble. Trois sources se lisent dans cet ordre avant
d'implémenter un écran :

1. `docs/DESIGN.md` fait foi sur les règles et les composants. Le projet Claude Design a été
   généré depuis lui (son `readme.md` § 1), jamais depuis le code.
2. La maquette fait foi sur **à quoi l'écran ressemble**. Là où DESIGN.md se tait, c'est une
   proposition à trancher, puis à écrire dans DESIGN.md. Là où les deux se contredisent,
   DESIGN.md gagne.
3. La spec du sub-project dit ce que l'écran fait.

L'onglet Playlist a été écrit depuis DESIGN.md et sa spec, sans ouvrir la maquette : les écarts
relevés ensuite (régime de largeur du rapport, sévérité des sélecteurs, libellés, états vides) ont
tous cette origine. La rule `.claude/rules/design/claude-design.md` existe pour ça.

## Comment ce dépôt se synchronise

- **Le convertisseur de `/design-sync` ne s'applique pas** : le skill ne traite que des design
  systems React, avec un `dist/` empaquetable ou un Storybook. L'interface est Angular + PrimeNG,
  sans point d'entrée de librairie. Les composants du projet Claude Design sont des recréations
  React bâties depuis DESIGN.md (son `readme.md` § Réserves), pas le code livré.
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
- **Ne jamais modifier la maquette sans demande explicite** : c'est le fichier de design du
  propriétaire, pas un artefact généré.

## Reste ouvert

Ce que le code livre et que le projet Claude Design n'a pas encore, à pousser au prochain sync.

> **Vidé le 2026-09-24** : les vingt-trois arbitrages qui vivaient ici ont été poussés, écrans
> compris (cf. Journal). Leur détail vit désormais dans le projet distant et dans `DESIGN.md` ;
> les garder ici en ferait deux sources pour une même règle. La section reprendra au premier
> écart suivant.

## Journal

- **2026-09-16, audit de l'onglet Playlist** : comparaison de l'écran livré contre DESIGN.md et
  `ui_kits/techno-tagger/PlaylistScreen.jsx`, écarts consignés dans la conversation de revue et
  ci-dessus. Création de ce dossier, de la rule et du lien dans DESIGN.md § Ressources. Aucun push
  encore effectué depuis ce dépôt.
- **2026-09-17, variations de l'onglet Playlist** : neuf directions explorées par
  `/swarm-ui-variations`, dont une calquée sur `PlaylistScreen.jsx`. Le mix retenu (grille compacte,
  deux temps, résumé, table pleine hauteur) est livré en `2d3b10e` et consigné ci-dessus. Aucun
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
  désormais l'interface livrée. `TaggingScreen` reçoit son sélecteur de dossier, garde son bouton
  de lancement visible et grisé plutôt que de le masquer, et son bloc vide dit « Aucun run lancé ».
  `SettingsScreen` perd la rangée « URL de l'API », devenue une constante du sidecar, et gagne le
  tag d'état de la clé. `PlaylistScreen` passe en deux temps, résumé puis rapport en table à deux
  colonnes, sélecteurs en primaire outlined. `AppShell` rend l'écran bloquant en carte neutre et
  non plus en pavé d'alerte. Container unique et tiret simple entre artiste et titre appliqués
  partout. Les composants ajoutés au catalogue n'étant pas encore dans le bundle compilé, que la
  recompilation régénère, les écrans composent leur motif avec les primitives déjà exportées.
- **2026-09-25, audit de DESIGN.md contre le code** : cinq écarts corrigés à la source, dont deux
  que le readme distant héritait. La règle du `danger` distingue désormais une action destructive
  d'une sévérité qui rapporte un état, le décompte figé des libellés d'état disparaît, le toast
  « clé enregistrée » cède au tag persistant qu'affiche réellement l'écran, et les deux boutons de
  lancement rejoignent leur famille du Mapping. `DESIGN.md` reçoit sa rubrique « Maquette et design
  system externes », que le skill `design-doc` réclame : sans elle, les commandes de décomposition
  et d'implémentation ne savent pas qu'une maquette existe ni où la lire.
