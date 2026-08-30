# Méthode d'audit de la documentation

Ce document décrit comment auditer les docs de ce projet sans les abîmer. Il est écrit après une première passe réelle, dont les chiffres servent d'étalonnage.

Deux chantiers distincts, à ne pas confondre :

| Chantier | Question posée | État |
|---|---|---|
| **Audit de verbosité** | Cette phrase est-elle dite ailleurs ? | Rapports rendus, coupes appliquées en partie |
| **Audit d'exactitude** | Cette affirmation est-elle vraie ? | **Jamais fait** |

Le second n'a jamais été mené. Il est probablement le plus rentable, pour une raison mesurée plus bas.

## Le principe

**Auditer, vérifier, puis couper. Jamais couper sur la foi d'un rapport.**

Un agent qui audite produit des affirmations plausibles et bien formulées. Certaines sont fausses. La passe de vérification n'est pas une précaution de principe, elle a un taux de prise réel : sur cette première passe, **225 lignes de coupes proposées auraient cassé un gabarit**, et deux affirmations vérifiées se sont révélées inexactes.

## Le workflow, de A à Z

### 1. Lancer les auditeurs en parallèle, en lecture seule

Un agent par document, `general-purpose`, avec consigne explicite de ne modifier aucun fichier. Le prompt doit contenir :

- **Ce qu'il faut chercher** : redites entre documents, délayage, justifications circulaires, sur-explication
- **Ce qui est intouchable** : tout fait technique, chiffre, version, piège, mode de panne, citation verbatim, lien, et le pourquoi d'un arbitrage quand il n'est pas déductible
- **Le format de rendu** : section, extrait, nature, raison, proposition, gain estimé
- **L'instruction d'être sélectif** : « si une section est déjà dense et juste, dis-le plutôt que d'inventer des coupes »

Adapter le prompt au genre du document. Un ADR argumente, son raisonnement *est* le contenu : y être nettement plus conservateur qu'ailleurs.

### 2. Charger le skill de chaque document, en entier

**C'est l'étape que l'on saute et qu'il ne faut pas sauter.** Pour chaque doc, charger son skill (`architecture-doc`, `versions-doc`, `production-doc`, `design-doc`, `brainstorm-doc`, `knowledge-doc`, `skill-creator`) **avec son template et ses exemples**. Lire seulement les sections « Structure » et « Conventions de format » ne suffit pas : les contraintes décisives sont dans les templates et les exemples.

Sur cette passe, 4 skills chargés en entier ont invalidé à eux seuls 225 lignes de propositions.

### 3. Confronter chaque proposition au gabarit

Une coupe qui supprime une ligne imposée par le template est un faux positif, quelle que soit la qualité de son argumentaire.

### 4. Vérifier chaque allégation sur pièce

Les allégations quantifiées (« ce fait est écrit 4 fois ») se vérifient par `grep` en quelques secondes. Les allégations de redite se vérifient en lisant les deux passages : deux formulations proches ne disent pas toujours la même chose, et l'écart est parfois une contradiction à trancher plutôt qu'une redite à couper.

### 5. Couper en reportant d'abord

Un passage redondant porte presque toujours un fragment unique. **Reporter ce fragment dans la section qui garde l'information, puis supprimer, puis vérifier par `grep` que l'information existe encore.** Une redite se coupe, une information jamais.

## Les pièges, constatés et non théoriques

### Faux positif de gabarit

Le plus fréquent. Un agent propose de supprimer une ligne que le template impose.

| Proposition | Réalité |
|---|---|
| Supprimer les 31 lignes `**Stabilité**` de VERSIONS.md | Ligne imposée par le template, et l'exemple officiel la porte en symbole nu |
| Supprimer les 6 `**Recommandation** : ✅` nues | Ligne imposée. Elles sont **incomplètes**, pas superflues : le template attend un message |
| Supprimer les avantages de l'option retenue dans les 22 ADRs | Le skill impose « minimum 2 options comparées avec avantages/inconvénients ». 155 lignes |
| Réduire le post-mortem de PRODUCTION.md | « template toujours inclus, même vide ». Il était déjà personnalisé sur 4 champs |
| Supprimer `Build Numbers`, `Dépendances`, fusionner `Cohérence documentaire` | Sous-sections attendues, dont une où le skill impose « une ligne par doc » |

### Faux positif de formulation

Un agent annonce une redite « mot pour mot » là où les deux formulations divergent sur le fond.

Exemple réel : ARCHITECTURE.md disait à la fois « un 504 n'est **pas retryé dans le run** » et « un 504 n'est **jamais retryé immédiatement** ». Ce n'est pas la même règle, la seconde laissant entendre un retry différé. Ce n'était pas une coupe, c'était une contradiction, tranchée en relisant ADR-017 qui fait foi.

### Redite utile

Trois occurrences du même fait dans trois sections différentes ne sont pas forcément deux de trop. Qui ouvre § Rollback doit y lire qu'il faut prévenir les utilisateurs à la main, sans avoir à connaître § Observabilité. Avant de couper une répétition, se demander si le lecteur de cette section-là lira l'autre.

## Le résultat le plus important

**L'audit de verbosité a trouvé une erreur factuelle par accident.**

`VERSIONS.md` et la rule affirmaient, avec un ✅, que rapidfuzz livre son propre hook PyInstaller via l'entry point `pyinstaller40`. Seule la fiche knowledge en doutait. Vérification dans le venv :

- l'entry point `pyinstaller40` de rapidfuzz s'appelle `tests`, pas `hook-dirs`
- `rapidfuzz/__pyinstaller/` ne contient que des tests, aucun `hook-*.py`
- `pyinstaller-hooks-contrib` ne fournit pas de `hook-rapidfuzz.py`

L'affirmation était fausse dans trois fichiers, et le `.spec` écrit sur sa foi ne collectait pas les cibles SIMD de l'extension C++.

**Personne ne cherchait cette erreur.** Elle est sortie parce qu'une fiche contredisait sa rule. Rien ne garantit qu'il n'en reste pas d'autres, et c'est ce qui justifie l'audit d'exactitude.

## Comment mener l'audit d'exactitude

La question change : non plus « est-ce dit deux fois » mais « est-ce vrai ».

- **Croiser les paires knowledge / rule** : c'est là qu'une contradiction devient visible, comme pour rapidfuzz
- **Vérifier sur pièce, pas sur doc** : le venv, le `node_modules`, le registre npm ou PyPI, le manifeste du paquet. Une affirmation sur une dépendance installée se tranche en l'interrogeant
- **Traiter en priorité ce qui a contaminé du code** : toute affirmation qui a servi à écrire un `.spec`, une config ou un workflow
- **Se méfier des ✅** : celui de rapidfuzz donnait une fausse assurance à une affirmation jamais vérifiée

## Ce qui a déjà été fait

**Corrigé et vérifié**

| Correction | Portée |
|---|---|
| Hook rapidfuzz inexistant | VERSIONS.md ×3, la rule, le `.spec`, rebuild, cibles SIMD confirmées dans le bundle |
| Retry du 504 contradictoire | ARCHITECTURE.md aligné sur ADR-017 |
| `v23_sep=None` donné pour acquis | ADR-011 aligné sur la doc mutagen qui le déconseille |
| `provideErrorHandler()` inexistant | rule et knowledge Sentry, vérifié dans le paquet et sur la doc officielle |
| `tauri.conf.json` dans `extra-files` | rule et knowledge release-please, aligné sur PRODUCTION.md |
| Versions d'outillage | `@angular/cli` et `@angular/build` en 22.1.6, `eslint` en `^10` |
| 4 redites d'ARCHITECTURE.md | coupées, fragments uniques reportés et vérifiés présents |

**Rapporté mais non vérifié**

16 incohérences restent à instruire : 9 entre BRAINSTORM.md et les docs récentes (motif de renommage, doublons de fichiers, visibilité du dépôt, un rapport contre deux, signal sonore, 6 plugins Tauri contre 8), 5 relevées dans les ADRs (dont le mode `--onedir` tranché dans un ADR dont le titre ne l'annonce pas, et le pool de pochettes absent de l'ADR qui décide des pools), et 2 contradictions knowledge / rule.

**Non traité**

Les 21 fiches de `docs/knowledges/`, soit environ 840 lignes de recouvrement avec `.claude/rules/`. Le rapport correspondant signale une inversion de responsabilité à corriger d'abord : plusieurs rules portent des pièges que leur fiche ignore. Couper les fiches avant de la corriger reviendrait à couper la moitié la plus pauvre du couple.

Restent aussi trois skills non chargés (`design-doc`, `brainstorm-doc`, `knowledge-doc`), donc trois rapports non filtrés.

## Répartition knowledge et rule

La règle proposée par l'audit, à appliquer avant toute coupe dans `docs/knowledges/` :

- La **rule** porte l'impératif, l'exemple de code à recopier, l'anti-pattern, le nom exact d'une option. Elle est indexée par `paths:`, donc se déclenche au moment d'éditer le fichier concerné.
- Le **knowledge** porte le pourquoi, l'arbitrage écarté, les tableaux de référence, les faits datés avec leur source et les incertitudes assumées.

Sa question n'est pas « que dois-je écrire » mais « pourquoi c'est comme ça ».
