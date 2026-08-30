---
title: "ADR-003 — Bibliothèque de composants : PrimeNG sous Community License"
status: "accepted"
description: "Choix de PrimeNG v22 sous Community License gratuite, contre Angular Material et contre le fork MIT Optimus UI, malgré la sortie de l'open source."
date: "2026-08-02"
keywords: ["architecture", "adr", "primeng", "primeui", "optimus-ui", "angular-material", "licence", "ui"]
scope: ["docs", "architecture"]
technologies: ["PrimeNG", "PrimeUI", "Optimus UI", "Angular Material", "Angular"]
---

# 🎯 Contexte

L'interface a besoin d'une table à scroll virtuel (listes de 100 morceaux, tableau récapitulatif filtrable), de modales, de barres de progression, de formulaires et d'un thème sombre cohérent avec les outils DJ.

**PrimeNG n'est plus open source à partir de la v22.** Le dépôt GitHub a été archivé fin juin 2026 et le projet est passé sous licence PrimeUI, en modèle Community / Commercial. La v21 et les antérieures restent MIT.

La **Community License** est gratuite et couvre ce projet sans version bridée. Quatre critères cumulatifs, tous vérifiés ici :

| Critère | Seuil | Situation |
|---|---|---|
| Chiffre d'affaires brut annuel | < 1 M$ | Aucun revenu |
| Développeurs | < 5 | 1 |
| Employés | < 10 | 0 |
| Capital-risque ou private equity reçu | Jamais > 3 M$ | Aucun |

Un fork communautaire est apparu dans la foulée : **Optimus UI**, maintenu par OpenNG, continuation MIT de PrimeNG v21 avec 80+ composants, sans palier payant ni clé.

---

# 🧩 Problème

Quelle bibliothèque de composants Angular retenir, alors que la plus adaptée fonctionnellement vient de sortir de l'open source et qu'un fork MIT existe ?

---

# 🛠️ Options Envisagées

## Option A : PrimeNG v22, sous Community License

**Description :** Dernière version amont, avec une clé de licence gratuite posée dans `providePrimeNG({ license: ... })`.

**Avantages :**
- Catalogue le plus large de l'écosystème Angular, et le seul à suivre les versions majeures d'Angular sous la responsabilité d'un éditeur qui en vit
- Table à scroll virtuel native, indispensable sur les listes longues
- Presets Aura, Material, Lara et Nora avec mode sombre intégré par `darkModeSelector`
- **Aucune limitation fonctionnelle** sur la bibliothèque centrale par rapport à la licence commerciale
- Corrections de bugs et de sécurité continues

**Inconvénients :**
- Une clé de licence embarquée dans le bundle distribué
- Renouvellement gratuit à refaire tous les 12 mois, avec 30 jours de grâce
- **Les erreurs de licence ne s'affichent pas sur localhost** : un oubli de renouvellement se verra chez les amis avant de se voir en développement
- Les composants Pro, PrimeBlocks et le Theme Designer ne sont pas inclus
- Dépendance à la politique commerciale de PrimeTek, qui vient de changer une fois

**Coût estimé :** 0 €, plus un rappel annuel.

## Option B : Optimus UI (OpenNG)

**Description :** Fork communautaire MIT de PrimeNG v21, maintenu par OpenNG, organisation dont l'objet est de reprendre des bibliothèques abandonnées.

**Avantages :**
- **MIT sans clé, sans renouvellement, sans avis de licence possible chez les utilisateurs**
- Même catalogue et même API que PrimeNG v21, presets Aura compris
- Aucune dépendance à une politique commerciale, l'organisation annonce l'absence de palier payant présent ou futur
- Reprise active du travail amont : sur 968 issues héritées, 58 fermées et 23 triées comme encore pertinentes

**Inconvénients :**
- **Fork de deux mois** : sa capacité à suivre les versions majeures d'Angular sur la durée n'est pas prouvée
- Repart de la v21 : les composants et correctifs introduits en v22 et au-delà n'y seront pas, sauf réimplémentation
- Un abandon du fork laisserait sur une base figée, exactement le scénario qu'on cherche à éviter
- Communauté et documentation encore embryonnaires face à celles de PrimeNG

**Coût estimé :** 0 €, avec un risque de continuité.

## Option C : Angular Material

**Description :** Bibliothèque officielle Angular, MIT, maintenue par l'équipe Angular.

**Avantages :**
- MIT sans ambiguïté ni clé, aucune dépendance à un éditeur tiers
- Alignement garanti sur les versions majeures d'Angular
- Aucun risque de changement de licence ni d'abandon

**Inconvénients :**
- Catalogue nettement plus étroit, notamment sur les tables : pas de scroll virtuel intégré au composant table, il faut l'assembler avec le CDK
- Design Material fortement marqué, difficile à éloigner de l'esthétique Google sans travail de thème conséquent
- Composants de formulaire et de sélection moins riches

**Coût estimé :** 0 €, plus le temps d'assembler ce que PrimeNG fournit d'emblée.

---

# 🎉 Décision

**PrimeNG v22, sous Community License, preset Aura en mode sombre.**

Le besoin fonctionnel écarte Angular Material : la table à scroll virtuel et le catalogue large sont exactement ce que le projet consomme, et il faudrait assembler pour un résultat moindre.

Entre PrimeNG et son fork, le critère décisif est la **continuité sur la durée**. Ce projet vivra plusieurs versions majeures d'Angular ; suivre ces migrations est un travail lourd et régulier, qu'un éditeur dont c'est le métier assure de façon plus prévisible qu'un fork de deux mois, aussi sérieusement lancé soit-il. Le risque assumé n'est pas symétrique : PrimeTek peut durcir sa politique, Optimus UI peut simplement s'arrêter, et la seconde issue laisserait sur une base figée.

Les contreparties de la Community License sont assumées et documentées : clé embarquée, renouvellement annuel, dépendance à PrimeTek.

---

# 🔄 Conséquences

## Positives

- Table à scroll virtuel, modales, progression et formulaires disponibles sans assemblage
- Preset Aura en mode sombre, cohérent avec Rekordbox, Traktor et Serato, sans travail de thème
- Corrections et compatibilité Angular suivies par l'éditeur
- Aucune limitation fonctionnelle par rapport à la version payante sur la bibliothèque centrale

## Négatives

- `PRIMENG_LICENSE_KEY` devient un secret de CI, injecté au build et présent dans le bundle distribué
- Un renouvellement oublié se manifestera chez les utilisateurs par un avis de licence, jamais en développement local, et la période de grâce n'est que de 30 jours
- Le Theme Designer n'étant pas inclus, toute personnalisation de thème passe par `definePreset()` écrit à la main
- Si PrimeTek durcit à nouveau sa politique, la migration sera à faire avec du code écrit contre PrimeNG entre-temps
- **La bascule ne s'arrête pas aux composants** : PrimeNG v22 tire `@primeicons/angular ^8.0.0`, sous la même licence PrimeUI, la dernière version MIT du paquet d'icônes étant `primeicons` 7.0.0. La dépendance à PrimeTek couvre donc aussi le jeu d'icônes, et une bascule vers Optimus UI demanderait de traiter les deux, la police `primeicons` 7.0.0 restant disponible en MIT pour ce cas

---

# 📝 Notes complémentaires

**Optimus UI reste la porte de sortie documentée.** Les deux bibliothèques partagent l'API de PrimeNG v21 : tant que le code n'utilise aucun composant introduit après la v21, la bascule resterait largement mécanique. C'est ce qui rend la décision réversible à coût modéré, et donc acceptable.

Une clé manquante, invalide ou expirée déclenche l'affichage d'un avis de licence dans l'application. Ce comportement est celui annoncé par la page de licence officielle et n'a pas été observé en conditions réelles.

Le preset est importé depuis `@primeuix/themes/aura` en base 16px, pas la variante `aura-compat` calibrée pour un root de 14px, maintenue jusqu'en juin 2027 pour les projets historiques.

Références : [PrimeUI — Community License](https://primeui.dev/licenses/community), [PrimeUI — The Next Chapter of PrimeTek](https://primeui.dev/nextchapter), [PrimeNG — Theming](https://primeng.dev/theming), [PrimeNG — Migration v22](https://primeng.dev/migration/v22), [Optimus UI](https://optimus.openng.org/), [OpenNG — PrimeNG is no longer open source](https://www.openng.org/blog/primeng-is-no-longer-open-source).
