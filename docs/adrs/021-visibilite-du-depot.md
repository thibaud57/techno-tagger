---
title: "ADR-021 — Visibilité du dépôt et canal de distribution"
status: "accepted"
description: "Dépôt public et distribution par GitHub Releases, seul canal permettant à des utilisateurs sans compte GitHub de télécharger l'installeur et de recevoir les mises à jour."
date: "2026-08-02"
keywords: ["architecture", "adr", "distribution", "github-releases", "updater", "depot-public"]
scope: ["docs", "architecture"]
technologies: ["GitHub Actions", "GitHub Releases", "Tauri", "Dokploy", "MinIO"]
---

# 🎯 Contexte

L'application est distribuée à quelques amis DJ, qui **ne sont pas développeurs et n'ont pas de compte GitHub**. Elle embarque un updater Tauri qui interroge un manifeste au démarrage et télécharge un bundle signé.

Sur un dépôt **public**, les assets d'une Release se téléchargent anonymement. Sur un dépôt **privé**, GitHub n'expose aucune URL directe : il faut un token avec le scope `repo` et passer par l'API.

Le code de scraping ne se trouve pas dans ce dépôt, il vit dans techno-scraper qui reste privé (cf. [ADR-006](006-scraping-delegue-techno-scraper.md)). Aucune clé n'est compilée dans le binaire, chaque utilisateur saisit la sienne (cf. [ADR-012](012-securite-cle-api-keyring.md)).

---

# 🧩 Problème

Où publier l'installeur et le manifeste de l'updater, sachant que les destinataires n'ont pas de compte GitHub et ne sauront pas manipuler un token ?

---

# 🛠️ Options Envisagées

## Option A : Dépôt public et GitHub Releases

**Description :** Le dépôt est public, la CI publie l'installeur et le `latest.json` sur les GitHub Releases au tag.

**Avantages :**
- **Téléchargement anonyme** : les amis cliquent sur un lien, rien à configurer, aucun compte
- L'updater interroge une URL publique, sans header d'autorisation, donc **aucun token à embarquer dans le binaire**
- Rien à héberger, rien à surveiller, aucune bande passante à porter
- Minutes CI illimitées sur les runners hébergés, et runner macOS gratuit si la cible revient (cf. [ADR-015](015-cibles-distribution-windows.md))

**Inconvénients :**
- Le projet devient visible et indexable
- L'URL de techno-scraper et la carte de ses routes sont lisibles dans le code

**Coût estimé :** Nul.

## Option B : Dépôt privé et dépôt de releases public

**Description :** Le code reste privé, la CI pousse les artefacts vers un second dépôt public vide.

**Avantages :**
- Téléchargement anonyme préservé
- Le code n'est pas visible

**Inconvénients :**
- Un PAT en secret et un second dépôt à maintenir
- Plan Free limité à 2 000 minutes par mois sur dépôt privé, **Windows décompté x2**
- Le contournement est visible : un dépôt public de releases sans code intrigue plus qu'il ne masque

**Coût estimé :** Faible, en complexité permanente.

## Option C : Dépôt privé et hébergement sur le VPS

**Description :** Installeur et manifeste déposés sur le VPS qui héberge déjà techno-scraper, via un conteneur nginx statique ou un bucket MinIO / Garage déployé par Dokploy. L'updater pointe dessus.

**Avantages :**
- URL entièrement sous contrôle, aucune dépendance GitHub pour la distribution
- L'updater Tauri accepte n'importe quel endpoint statique, aucune adhérence à GitHub
- Dokploy fournit des templates prêts (MinIO, Garage S3), et un nginx statique suffirait pour trois fichiers
- Aucune exposition publique du projet

**Inconvénients :**
- Une clé SSH ou des credentials S3 en secret CI, et un service de plus à surveiller
- La bande passante et la disponibilité du VPS deviennent critiques pour les mises à jour
- Toujours 2 000 minutes de CI par mois, Windows compté x2
- Un point de défaillance supplémentaire, sur la même machine que l'API

**Coût estimé :** Faible en argent, non nul en exploitation.

---

# 🎉 Décision

**Dépôt public et distribution par GitHub Releases.**

La contrainte décisive est humaine : des utilisateurs non développeurs, sans compte GitHub. Le dépôt public est le seul canal où ils n'ont strictement rien à faire d'autre que cliquer.

L'argument de confidentialité ne tient pas à l'examen. Ce que le dépôt révélerait, l'URL de l'API et la carte de ses routes, **est déjà public par trois canaux indépendants** : le binaire distribué, où un `strings` suffit sur un exécutable PyInstaller ; les logs de **Certificate Transparency**, où tout certificat TLS émis pour le domaine est inscrit et interrogeable publiquement, ce qui rend l'énumération des sous-domaines triviale sans jamais ouvrir le dépôt ; et le code source lui-même, l'URL étant la valeur par défaut du champ Settings. Garder le dépôt privé relèverait de la sécurité par l'obscurité, tout en cassant la distribution.

Ce qui protège réellement l'API reste intact, et ne dépend d'aucun secret sur son adresse :

- **Garde fail-closed** : toute route est protégée par défaut, `/health` étant la seule exception, et une clé absente ou fausse rend un 403.
- **Documentation OpenAPI coupée en production** : `/docs`, `/redoc` et `/openapi.json` ne sont pas servis, sans quoi la surface complète de l'API serait lisible sans clé.
- **Concurrence sortante bornée** par source, ce qui protège l'IP de sortie partagée.

Quelqu'un qui lirait tout le code n'aurait toujours aucun moyen d'appeler l'API.

---

# 🔄 Conséquences

## Positives

- Les amis téléchargent et mettent à jour sans compte, sans token, sans explication
- Aucun secret à embarquer dans le binaire pour que l'updater fonctionne
- Minutes CI illimitées, et runner macOS gratuit le jour où la cible revient
- Rien à héberger ni à surveiller sur le VPS, qui reste dédié à l'API

## Négatives

- Le projet est visible et indexable, ce qui augmente la probabilité qu'il soit remarqué
- Toute fuite accidentelle de secret dans un commit devient immédiatement publique : la discipline sur les secrets de CI n'est plus rattrapable après coup
- Le dépôt public documente implicitement l'existence et l'usage de techno-scraper

---

# 📝 Notes complémentaires

Le risque résiduel est de **visibilité, pas de technique**. Un dépôt public qui annonce consommer une API de scraping Beatport est plus facile à trouver qu'un dépôt privé. Aucun précédent documenté de retrait GitHub sur un cas comparable n'a été trouvé (recherche sur la politique DMCA de GitHub et les signalements publiés), le risque reste donc théorique. Il se réduit encore si le README reste factuel : « récupère des métadonnées via une API » plutôt que « scrape Beatport ».

Les options d'auto-hébergement restent documentées et applicables sans changement d'architecture : l'updater Tauri accepte n'importe quel endpoint statique, seul `plugins.updater.endpoints` dans `tauri.conf.json` change. Bascule possible à tout moment si la visibilité devient un problème.

Références : [Tauri v2 — Updater](https://v2.tauri.app/plugin/updater/), [Dokploy — MinIO](https://docs.dokploy.com/docs/templates/minio), [Dokploy — Garage S3](https://docs.dokploy.com/docs/templates/garage), [GitHub — DMCA Takedown Policy](https://docs.github.com/articles/dmca-takedown-policy), [GitHub Actions — Billing](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions).
