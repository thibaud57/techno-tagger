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

Ce que le code livre et que la maquette n'a pas encore, à pousser au prochain sync :

- **Écran bloquant en carte** : la maquette le rend en `Message fullScreen`, un pavé d'alerte
  rouge. Le code le rend en `p-card` neutre, sans icône, avec l'action de reprise. À reprendre
  dans `ui_kits/techno-tagger/AppShell.jsx`, et `Card` manque au catalogue de composants.
- **Paires de sévérité du `Message`** : la maquette recalcule ses teintes (fond `red-400` à 90 %,
  texte `red-300`) là où le preset donne `red-500` à 84 % et `red-500` en texte. Le `readme.md`
  du projet annonce déjà que ses tokens de composant ne sont pas vérifiés : ceux-là sont à
  aligner sur le preset.
- **Preset du projet** : l'application ne consomme plus Aura nu mais `TECHNO_TAGGER_PRESET`
  (`src/app/core/theme.ts`), qui impose 8px et aucune ombre à la carte, 4px au tag et 2px au
  badge. Les cartes de guidelines qui montrent ces rayons sont à revérifier.
- **Un seul container, plein écran** : les deux régimes de largeur ont disparu. Le shell porte
  `px-16 py-8` pour les trois onglets et une page ne pose plus de marge à elle. `AppShell.jsx` et les
  trois écrans de `ui_kits/techno-tagger/` posent encore leurs propres paddings, et
  `PlaylistScreen.jsx` un `max-width` de formulaire. La carte `space-regimes.card.html` des
  guidelines décrit un régime qui n'existe plus.
- **La page ne défile jamais** : le shell masque son débordement, la maquette laisse défiler
  ses écrans (`overflowY: auto` dans `PlaylistScreen.jsx`).
- **Tables** : taille par défaut de PrimeNG, à scroll virtuel. Le rapport d'extraction a
  deux colonnes, Fichier fluide et État figée à 197px. Le détail
  d'un doublon ou d'un échec s'ouvre en tooltip sur le badge, signalé par une icône info. La table
  remplit toute la hauteur restante, vide ou remplie, et centre son bloc vide ; « Extraction
  terminée (N sur N) » s'affiche dessous, à droite. La maquette n'a aucune table sur cet écran, et
  la fiche `DataTable` ne décrit que la liste du run.
- **Onglet Playlist en deux temps** : formulaire en grille compacte (libellés, contrôles `small` de
  même largeur, chemins alignés à droite, « Extraire la playlist » seul sur sa ligne), replié dès
  le lancement en une ligne de résumé avec « Modifier », barre de progression sous le résumé sans
  valeur écrite, retirée à la fin. DESIGN.md § Layout le décrit. À reprendre dans
  `PlaylistScreen.jsx`.
- **Conventions de bureau** : curseur flèche partout sauf les champs, et rebond de défilement coupé.
  Rien de tout ça dans le kit.
- **Sévérité des sélecteurs de dossier** : tranchée en primaire outlined, comme le code. La maquette
  les rend encore en `secondary` outlined dans `PlaylistScreen.jsx`.
- **Bannière d'erreur** : `ErrorMessageComponent` partagé, sans équivalent au catalogue.

## Journal

- **2026-09-16, audit de l'onglet Playlist** : comparaison de l'écran livré contre DESIGN.md et
  `ui_kits/techno-tagger/PlaylistScreen.jsx`, écarts consignés dans la conversation de revue et
  ci-dessus. Création de ce dossier, de la rule et du lien dans DESIGN.md § Ressources. Aucun push
  encore effectué depuis ce dépôt.
- **2026-09-17, variations de l'onglet Playlist** : neuf directions explorées par
  `/swarm-ui-variations`, dont une calquée sur `PlaylistScreen.jsx`. Le mix retenu (grille compacte,
  deux temps, résumé, table pleine hauteur) est livré en `2d3b10e` et consigné ci-dessus. Aucun
  push vers le projet Claude Design.
