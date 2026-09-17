---
paths:
  - "src/app/**/*.ts"
  - "src/app/**/*.html"
---

# Claude Design — la maquette de l'application

Le projet Claude Design « Techno Tagger Design System » porte dans `ui_kits/techno-tagger/` une recréation cliquable de l'application, un fichier par écran (`PlaylistScreen`, `TaggingScreen`, `ArbitrationDialog`, `SettingsScreen`) plus `AppShell` pour le shell. Elle fait foi sur **à quoi l'écran ressemble**, quand DESIGN.md fait foi sur **les règles et les composants** (déjà couvert par les rules `primeng` et `tailwindcss`). Le lien du projet est dans [DESIGN.md § Ressources](../../../docs/DESIGN.md#ressources-complémentaires), la procédure de sync et le journal dans `.design-sync/NOTES.md`.

## À faire

- Lire l'écran de la maquette avant d'écrire ou de reprendre un composant d'écran, et le nommer dans la spec du sub-project
- Signaler une divergence entre la maquette, la spec et DESIGN.md au lieu de la trancher en silence : les trois ont été écrits séparément, l'écart est une décision à prendre, qui s'écrit ensuite dans DESIGN.md
- Traiter la maquette comme une proposition là où DESIGN.md se tait, et DESIGN.md comme la règle là où les deux se contredisent
- Consigner dans `.design-sync/NOTES.md` § Reste ouvert ce que le code livre et que la maquette n'a pas encore, pour le prochain push

## À éviter

- Recopier des valeurs de la maquette dans une spec, une rule ou un commentaire : elle continue d'évoluer. On nomme son écran, on ne décrit pas son contenu ailleurs qu'en elle
- Transposer son React tel quel : la maquette est une recréation bâtie depuis DESIGN.md, jamais diffée contre le code Angular. Ses styles inline désignent des tokens à retrouver dans les classes du plugin `tailwindcss-primeui`, pas du CSS à copier
- Modifier la maquette sans demande explicite : c'est le fichier de design du propriétaire, pas un artefact généré

## Gotchas

- La maquette rend les icônes par la police PrimeIcons (`pi pi-*`), que la v22 n'emploie plus : dans l'app, `IconComponent` et `SourceLogoComponent` rendent du SVG inline (cf. rule `primeng/composants.md`)
- Une largeur fixe dans la maquette (colonne de libellés, sélecteur) ne s'importe pas telle quelle dès qu'elle porte du texte traduit : DESIGN.md § Conventions de Code l'interdit, les libellés existent en FR et en EN
