---
title: "ADR-004 — Internationalisation : ngx-translate"
status: "accepted"
description: "Choix de ngx-translate pour la bascule français / anglais à l'exécution, contre @angular/localize qui imposerait un installeur par langue, et contre Transloco."
date: "2026-08-02"
keywords: ["architecture", "adr", "i18n", "ngx-translate", "transloco", "angular"]
scope: ["docs", "architecture"]
technologies: ["ngx-translate", "Transloco", "Angular"]
---

# 🎯 Contexte

L'application doit exister en français et en anglais. Au premier lancement, la locale système est lue via le plugin OS de Tauri (`locale()`, format BCP-47) : commence par `fr` donne du français, tout le reste donne de l'anglais. Un sélecteur dans les Settings permet ensuite de forcer l'une ou l'autre.

Le contexte est un logiciel empaqueté et distribué par installeur, pas un site web servi par un serveur qui pourrait router selon la langue.

---

# 🧩 Problème

Quelle solution d'internationalisation permet une bascule de langue à l'exécution, dans une application desktop distribuée sous forme d'un installeur unique ?

---

# 🛠️ Options Envisagées

## Option A : ngx-translate

**Description :** Bibliothèque tierce chargeant des fichiers JSON de traduction à l'exécution, avec un service de bascule.

**Avantages :**
- Bascule de langue à l'exécution, sans rebuild ni rechargement de l'application
- **Un seul build, un seul installeur** pour les deux langues
- Documente explicitement ses tests contre Angular 18 à 22, et précise que sa directive et son pipe sont compatibles OnPush, qu'Angular 22 impose désormais par défaut aux composants qui ne déclarent pas de stratégie
- Fichiers JSON simples à éditer, y compris par un non-développeur

**Inconvénients :**
- Dépendance tierce, hors du périmètre officiel Angular
- Les traductions sont chargées à l'exécution : une clé manquante ne se voit qu'à l'affichage, pas à la compilation
- Pas d'extraction automatique des chaînes depuis les templates

**Coût estimé :** Faible, à condition de câbler l'i18n dès le premier écran.

## Option B : `@angular/localize`

**Description :** Solution officielle Angular, traduction à la compilation.

**Avantages :**
- Package officiel, maintenu par l'équipe Angular
- Traductions résolues à la compilation, donc aucune surcharge à l'exécution et détection des clés manquantes au build
- Extraction automatique des chaînes marquées

**Inconvénients :**
- **Produit un bundle par langue**, donc un build et un installeur par langue, et un choix imposé à l'utilisateur au moment du téléchargement
- Aucune bascule à l'exécution : changer de langue signifierait réinstaller
- Doublerait la matrice de build en CI et la surface de distribution

**Coût estimé :** Rédhibitoire dans un contexte d'installeur unique.

## Option C : Transloco

**Description :** Bibliothèque tierce concurrente de ngx-translate, même principe de chargement à l'exécution.

**Avantages :**
- Bascule à l'exécution, comme ngx-translate
- API souvent jugée plus moderne, API à base de signals, bon support des traductions par périmètre
- **Activement maintenu** : version 8.4.0 publiée le 13 juin 2026

**Inconvénients :**
- Ne documente pas explicitement sa compatibilité avec Angular 22 ni son comportement face au passage d'OnPush en stratégie par défaut, là où ngx-translate le fait
- Aucun avantage fonctionnel décisif sur ce projet, qui n'a que deux langues et quelques dizaines de libellés

**Coût estimé :** Équivalent à ngx-translate.

---

# 🎉 Décision

**ngx-translate.**

`@angular/localize` est disqualifié par le modèle de distribution : un installeur par langue est absurde pour un outil partagé entre amis, et interdit de changer d'avis après installation.

Les deux bibliothèques tierces sont maintenues et fonctionnellement équivalentes sur ce périmètre. Le départage se fait sur la documentation de compatibilité : ngx-translate annonce ses tests contre Angular 18 à 22 et traite explicitement le passage d'OnPush en stratégie par défaut, ce que Transloco ne documente pas. Sur deux langues et quelques dizaines de libellés, aucun autre critère ne pèse.

L'i18n est câblée dès le premier écran développé (étape 5 de l'ordre de développement). L'ajouter après coup obligerait à reprendre chaque libellé déjà écrit en dur.

---

# 🔄 Conséquences

## Positives

- Un seul build, un seul installeur, quelle que soit la langue
- Bascule instantanée depuis les Settings, sans redémarrage
- Détection automatique au premier lancement via la locale système lue par le plugin OS de Tauri
- Fichiers JSON éditables sans toucher au code, si un ami veut corriger une formulation

## Négatives

- Une dépendance tierce de plus, dont la survie n'est pas garantie par l'équipe Angular
- Une clé de traduction manquante ne se voit qu'à l'affichage de l'écran concerné
- Pas d'extraction automatique : chaque nouveau libellé doit être ajouté à la main dans les deux fichiers
- Le départage avec Transloco tient à un écart de documentation, pas de fonctionnalité : la décision serait à revoir sans frais si Transloco publiait sa matrice de compatibilité

---

# 📝 Notes complémentaires

La détection initiale se limite au préfixe de la locale : `fr-FR`, `fr-BE` et `fr-CA` donnent du français, tout le reste de l'anglais. Aucune gestion de variantes régionales n'est prévue.

Référence : [ngx-translate](https://ngx-translate.org).
