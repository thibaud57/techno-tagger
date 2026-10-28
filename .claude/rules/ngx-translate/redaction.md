---
paths:
  - "src/app/**/*.ts"
  - "src/app/**/*.html"
  - "public/i18n/*.json"
---

# ngx-translate : rédaction des textes

## À faire
- Écrire les phrases au vouvoiement (« Relancez l'application. ») et les libellés d'action à l'infinitif (« Choisir un dossier »)
- Nommer ce que l'utilisateur connaît, jamais l'architecture : « le moteur de l'application », « la médiathèque VLC », pas sidecar ou dump
- Employer partout le même mot pour une même chose
- Dire dans un message d'erreur le geste qui répare (relancer, réinstaller, choisir), pas la mécanique qui a échoué
- Poser une espace insécable U+00A0 littérale, comme le reste de `fr.json`, avant `:`, `;`, `?` et `!` dans les textes français : un retour à la ligne ne sépare jamais le signe de ce qu'il ponctue
- Mettre une phrase par ligne dans tout message de plusieurs phrases (`\n` dans la traduction, des deux côtés) et une ligne vide (`\n\n`) entre les blocs d'une modale longue
- Composer le motif d'un fichier en deux lignes : la cause `reason.<code>`, puis le remède `reason.fix.<code>` (absent pour `file_missing` et `write_failed`) qui interpole `{{retry}}` avec le contexte `reason.retry.<phase>` (`write`, `rollback`, `extraction`). Traduire le refus d'une phase longue par `errors.phase_busy.<phase>`, la phase qui tourne et non celle demandée

> La charte et ses exceptions (une phrase par ligne) sont dans [DESIGN.md § Conventions de Code](../../../docs/DESIGN.md#-conventions-de-code).
