---
feature: "Feature 6 : Plan de run, reprise et rapport"
subproject: "reprise-ui"
goal: "Proposer au lancement de reprendre ou d'abandonner un run interrompu et réduire la confirmation de sortie à ce qui perd encore quelque chose"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["04-protocole-ndjson-plan-rapport-design.md"]
date: "2026-10-12"
---

# Invite de reprise d'un run interrompu

## Scope

Ce sub-project ajoute l'annonce d'un run interrompu au lancement (`ResumeStore` et les gestes `resume` et `discard` de `SidecarService`), l'invite de reprise montée dans le shell en trois états (run reprenable, dossier introuvable, plan illisible) et la navigation vers l'onglet Tagging à la reprise. Il réduit aussi la confirmation de sortie à l'extraction et aux deux cas bloquants (écriture, restauration). Il exclut l'écran récapitulatif (sub-project 06) et la liste des runs passés (07).

### État livré

À la fin de ce sub-project, on peut relancer l'application après un run coupé en pleine recherche :
- l'invite annonce « Run du …, N / M traités, sur : » suivi du dossier ;
- « Reprendre » rouvre le run dans l'onglet Tagging, décisions et arbitrages en attente compris et la recherche continue sur les seuls morceaux restants ;
- « Repartir de zéro » écarte le plan et ferme l'invite ;
- quitter l'application en plein run ne demande plus rien.

## Dependencies

- `04-protocole-ndjson-plan-rapport-design.md` (statut: draft) : `GetInterruptedRunCommand`, `ResumeRunCommand`, `DiscardRunCommand`, `InterruptedRunEvent`, `InterruptedRun`, `UnreadablePlan` dans `protocol.ts` et le cas d'`interrupted_run` reconnu sans effet dans `handleLine`.

## Références de design

- **Maquette** : `AppShell`, la `Dialog` pilotée par l'état `resume` (invite de reprise) et `CloseConfirmation`.
- **Design system** : fiches `overlay/Dialog`, `forms/Button`, `overlay/TruncatedText`.
- Règle de lecture : `.claude/rules/design/claude-design.md`.

## Files touched

- **À créer** : `src/app/core/resume.store.ts`, `src/app/core/resume.store.spec.ts`
- **À modifier** : `src/app/core/sidecar.service.ts` :
  - demande de `get_interrupted_run` après une version concordante ;
  - routage d'`interrupted_run` ;
  - `resume`, `discard`, `interruptedRun`, `dismissInterruptedRun` ;
  - `prepareRun`, remise à zéro extraite de `startTagging` ;
  - `resume_run` dans la table `launches`.
- **À modifier** : `src/app/core/sidecar.service.spec.ts` (demande, gestes, `resume_run` dans `LAUNCHES`)
- **À créer** : `src/app/shared/components/resume-dialog.component.ts` (template inline), `resume-dialog.component.spec.ts`
- **À créer** : `src/app/shared/utils/run-date.ts` (extrait de `settings-page.component.ts`)
- **À modifier** : `src/app/features/settings/settings-page.component.ts` (importe `runDate`)
- **À modifier** : `src/app/features/tagging/tagging-page.component.ts` et son `.spec.ts` :
  - un refus de `resume_run` ou de `discard_run` s'affiche comme un refus de `start_tagging` ;
  - le champ dossier suit `requestedFolder()`.
- **À modifier** : `src/app/app.component.html`, `app.component.ts`, `app.component.spec.ts` (invite différée dans la branche non bloquée, stub du spec étendu)
- **À modifier** : `src/app/core/close-guard.service.ts`, `close-guard.service.spec.ts` (cas `tagging`, `arbitration`, `unwritten` retirés)
- **À modifier** : `src/app/shared/components/close-confirmation.component.spec.ts` (le composant lui-même ne change pas)
- **À créer** : `src/fixtures/resume.ts` (événements `interrupted_run` des quatre états)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`resume.*` ajoutés ; `app.close.tagging`, `app.close.arbitration`, `app.close.unwritten` retirés)
- **À modifier** : `docs/DESIGN.md` :
  - lignes « Reprise d'un run interrompu » et « Confirmation de sortie » ;
  - largeur de l'invite dans § Structure de Page ;
  - arbitrages ajoutés et mention périmée de « Reprendre » retirée de « Taille des boutons ».
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : états absents de la maquette)
- **À modifier** : `docs/adrs/009-enchainement-sources-et-arbitrage.md` (note datée : la confirmation de sortie ne retient plus le run)

## Architecture approach

### Store

`ResumeStore` est un `@Service()` à signals (`.claude/rules/angular/signals.md`, `.claude/rules/angular/services.md`). Son signal `prompt` vaut le run à proposer (un `InterruptedRun` ou un `UnreadablePlan`), ou `null` sans annonce, sans run, après un geste ou après « Plus tard ». « Plus tard » vaut pour la session : seule l'annonce d'un nouveau démarrage du moteur rouvre l'invite. Aucun composant n'injecte le store : `SidecarService` le ré-expose (`interruptedRun`), comme pour les autres stores de phase.

### Service

- **Demande** : `SidecarService` envoie `get_interrupted_run` une seule fois par démarrage du moteur, à la réception d'une `version` concordante, quand le moteur n'est ni absent ni en conflit de version. Ce n'est pas le moment où la page Réglages lit la cible de restauration : cet `effect` (`settings-page.component.ts`) part dès que `available()` vaut vrai, donc avant la `version`. La reprise attend la `version`, seule à dire que le moteur est celui de l'application (ADR-018). `restart()` réarme la demande.
- **Routage** : `interrupted_run` est routé vers le store. Ce cas remplace le cas sans effet du sub-project 04.
- **`resume(run)`** ferme l'invite au geste et lance un run comme `startTagging` (`prepareRun`, qui pose `requestedFolder`), puis envoie `resume_run`. `resume_run` entre dans `launches` avec la phase et le `undo` de `start_tagging` : un refus remet l'état du lancement comme un échec de `start_tagging`. Les événements rejoués par le sidecar (`run_started`, `track_resolved`, `arbitration_required`, `progress`) hydratent `TaggingRunStore` et `ArbitrationStore` par les chemins existants.
- **`discard(runId)`** ferme l'invite au geste et envoie `discard_run`. L'`interrupted_run` qui revient la rouvre sur le plan suivant s'il y en a un.

### Invite

`ResumeDialogComponent` vit dans `shared/components/`, car il est monté dans le shell, comme `CloseConfirmationComponent` (`.claude/rules/angular/components.md`). Le shell le monte dans sa branche non bloquée et le diffère comme les deux autres modales : `@defer (when interruptedRun() !== null; prefetch on idle(5s))` (`.claude/rules/angular/lazy-loading.md`).

**Forme** :
- `p-dialog` modal, `[closable]="false"`, largeur `w-120` (celle de la `Dialog` d'`AppShell`) ;
- `[focusOnShow]="false"` : aucun bouton n'a le focus à l'ouverture, Entrée ne supprime donc jamais le plan (même garde-fou que `defaultFocus="reject"` de `DangerConfirmComponent`) ;
- fondu `FADE_IN` au montage, par `[animate.enter]` sur le contenu (DESIGN § Composants Animés : invite de reprise) ;
- boutons `size="small"` (`.claude/rules/primeng/composants.md`, `.claude/rules/primeng/theming.md`).

**Run reprenable** : titre « Reprendre le run interrompu ? », puis deux phrases, une par ligne :
- le résumé (date, N / M traités, puis le dossier sur la ligne suivante) ;
- la garantie « aucun fichier touché ».

La date passe par `runDate()`, extrait vers `shared/utils/run-date.ts` et partagé avec les Réglages et le dossier par `TruncatedTextComponent`. Les actions sont « Repartir de zéro » en texte `secondary` puis « Reprendre » en `primary`, comme dans `AppShell`.

**Dossier introuvable** : `folder_missing` couvre le dossier absent et le dossier qui ne contient plus aucun fichier audio (sub-project 02). Le message nomme le dossier et dit de rebrancher le disque ou de remettre les fichiers, puis de relancer. Les actions sont « Plus tard » et « Repartir de zéro », sans « Reprendre » : le plan reste et un disque rebranché rend le run reprenable au lancement suivant.

**Plan illisible** : seul « Repartir de zéro » reste. Deux textes selon `UnreadablePlan.found` :
- une version trouvée (nombre ou chaîne) : le message nomme la version trouvée et la version attendue (ADR-018) ;
- `null`, un fichier corrompu : un texte distinct, sans aucune mention de version.

**Gestes** :
- « Reprendre » appelle `resume`, puis navigue vers `/tagging` par le Router (`.claude/rules/angular/routing.md`) ;
- « Repartir de zéro » appelle `discard`, sans confirmation : aucun fichier n'est touché et les confirmations du projet sont réservées aux gestes sur les fichiers ;
- « Plus tard » pose `dismissed`.

**Erreur de reprise** : l'invite disparaît au geste. Un refus de `resume_run` ou de `discard_run` s'affiche dans la page Tagging au même emplacement qu'un refus de `start_tagging` (`errorFor`) . L'interface redemande alors l'annonce (`get_interrupted_run`), qui repropose le plan restant ou un autre : un dossier devenu illisible revient avec « Plus tard ». Sauf sur `phase_busy` et `api_key_missing`, où l'invite non fermable enfermerait l'utilisateur : le plan reste sur le disque, et l'annonce est redemandée dès qu'une clé est enregistrée, sinon au prochain lancement. Révisé le 2026-10-13 (le plan n'était reproposé qu'au prochain lancement). Le sidecar n'émet jamais de phrase et l'interface traduit le code (`.claude/rules/ngx-translate/i18n.md`).

**Page Tagging déjà affichée** : `resume()` pose `requestedFolder` et le champ dossier de la page est un `linkedSignal` sur `requestedFolder()`. Il suit donc la reprise sans recréer la page. Sans cela, `runAction` rendrait `start` au lieu de `commit` tant que le champ garde l'ancien dossier.

### Confirmation de sortie

`close-guard` ne compte plus `tagging`, `arbitration` ni `unwritten` : le plan persisté rend ces trois travaux à la reprise. Restent l'extraction (copie coupée) et les deux cas bloquants (écriture, restauration). Les clés `app.close.tagging`, `app.close.arbitration` et `app.close.unwritten` disparaissent des deux langues dans le même commit.

### Textes

Les clés `resume.*` sont ajoutées en FR et EN, sous un espace de noms dédié, en miroir du composant. Le vouvoiement s'applique, avec une espace insécable avant `:` et `?` et une phrase par ligne (`.claude/rules/ngx-translate/i18n.md`).

### Tokens

Seulement des classes `tailwindcss-primeui` (`text-sm`, `text-muted-color`, `text-color`, `w-120`, `gap-2`), jamais une valeur en dur (`.claude/rules/tailwindcss/utilitaires.md`). Composants en `OnPush` (`.claude/rules/angular/change-detection.md`).

### Arbitrages de `docs/DESIGN.md` suivis

« Taille des boutons », « Boutons du `p-confirmdialog` » (non concerné : ni `p-confirmdialog` ni `danger` ici), « Une phrase par ligne », « Position des tooltips » (texte tronqué du dossier) et « Icônes ». La mention de « Reprendre » à la taille par défaut, dans « Taille des boutons », décrit une maquette depuis réalignée : elle est retirée.

## Acceptance criteria

### Scénario 1 : invite au lancement
**GIVEN** un sidecar qui annonce un run interrompu le 2 août sur `D:\Sets\Août`, 62 morceaux traités sur 100
**WHEN** l'application démarre et que la version du moteur concorde
**THEN** l'invite s'ouvre sur « Reprendre le run interrompu ? », avec la date localisée, « 62 / 100 », le dossier et la garantie qu'aucun fichier n'a été touché
**AND** aucun bouton n'a le focus

### Scénario 2 : reprise
**GIVEN** l'invite ouverte sur un run reprenable
**WHEN** l'utilisateur clique « Reprendre »
**THEN** `resume_run` part avec le `run_id` annoncé, l'invite se ferme et l'onglet Tagging s'affiche
**AND** la liste du run se remplit des morceaux rejoués par le sidecar

### Scénario 3 : repartir de zéro
**GIVEN** l'invite ouverte
**WHEN** l'utilisateur clique « Repartir de zéro »
**THEN** `discard_run` part sans confirmation et l'invite se ferme au clic
**AND** si le sidecar annonce un autre plan, l'invite se rouvre sur lui

### Scénario 4 : dossier introuvable ou vidé
**GIVEN** un run interrompu dont le dossier est introuvable ou ne contient plus aucun fichier audio
**WHEN** l'invite s'ouvre
**THEN** elle nomme le dossier, ne propose pas « Reprendre » et « Plus tard » la ferme sans rien envoyer

### Scénario 5 : plan d'une autre version
**GIVEN** un plan d'une autre version
**WHEN** l'invite s'ouvre
**THEN** elle nomme la version trouvée et la version attendue et seul « Repartir de zéro » est proposé

### Scénario 6 : plan corrompu
**GIVEN** un plan que le sidecar ne sait pas lire et dont il ne connaît aucune version (`found` nul)
**WHEN** l'invite s'ouvre
**THEN** elle dit que le fichier du run est endommagé, sans citer de version et seul « Repartir de zéro » est proposé

### Scénario 7 : reprise ou abandon refusé
**GIVEN** un `resume_run` refusé en `tagging_folder_unreadable`, ou un `discard_run` refusé en `run_not_found`
**WHEN** l'erreur revient
**THEN** la page Tagging l'affiche comme un refus de lancement et le run n'est pas marqué en cours
**AND** l'interface redemande l'annonce, qui repropose le plan restant (révisé le 2026-10-13) ; sur `phase_busy` ou `api_key_missing`, le plan reste sur le disque et revient à l'enregistrement d'une clé ou au prochain lancement

### Scénario 8 : reprise depuis l'onglet Tagging
**GIVEN** l'onglet Tagging affiché et le champ dossier vide
**WHEN** une reprise pose le dossier du run
**THEN** le champ prend ce dossier et le bouton d'action du run propose la confirmation, pas un nouveau lancement

### Scénario 9 : quitter en plein run
**GIVEN** un run en pleine recherche, avec des arbitrages en attente
**WHEN** l'utilisateur ferme la fenêtre
**THEN** l'application se ferme sans confirmation
**AND** pendant une extraction, la confirmation s'affiche toujours

## Tests à écrire

### Unit
- `src/app/core/resume.store.spec.ts` :
  - le run annoncé est proposé, puis plus rien après « Plus tard » ou une annonce `null`
- `src/app/core/sidecar.service.spec.ts` :
  - `get_interrupted_run` part après une `version` concordante, jamais sur une version en conflit et repart après un redémarrage
  - `interrupted_run` alimente `interruptedRun`
  - `resume` envoie `resume_run` une seule fois, pose `requestedFolder` et marque le run en cours
  - les événements rejoués remplissent la liste et la file d'arbitrage
  - un refus de `resume_run` remet l'état du lancement (`LAUNCHES`, comme `start_tagging`)
  - `discard` envoie `discard_run`, ferme l'invite et laisse l'annonce suivante la rouvrir
- `src/app/shared/components/resume-dialog.component.spec.ts` :
  - le résumé porte la date, le dossier et « N / M » (scénario 1)
  - aucun bouton ne reçoit le focus à l'ouverture (scénario 1)
  - « Reprendre » appelle `resume` puis navigue vers `/tagging` (scénario 2)
  - « Repartir de zéro » appelle `discard` (scénario 3)
  - dossier introuvable : pas de « Reprendre », « Plus tard » ferme l'invite (scénario 4)
  - plan illisible : les deux versions affichées, « Repartir de zéro » seul (scénario 5)
  - plan corrompu : aucun texte de version (scénario 6)
- `src/app/core/close-guard.service.spec.ts` :
  - un run en cours, des arbitrages ou un run non confirmé ne retiennent plus la fermeture, une extraction la retient (scénario 9)
- `src/app/shared/components/close-confirmation.component.spec.ts` :
  - chaque travail retenu est nommé, dans l'ordre
- `src/app/features/tagging/tagging-page.component.spec.ts` :
  - un refus de `resume_run` ou de `discard_run` s'affiche au même emplacement qu'un refus de `start_tagging` (scénario 7)
  - le champ dossier suit une reprise pendant que la page est affichée (scénario 8)

## Edge cases

- **Moteur absent ou en conflit de version** : aucune demande n'est envoyée et aucune invite ne s'ouvre. L'écran bloquant prime et l'invite, montée dans la branche non bloquée, est démontée avec elle.
- **Geste refusé** : l'invite a déjà disparu au clic. L'erreur s'affiche sur l'onglet Tagging et l'annonce est redemandée, sauf sur `phase_busy` et `api_key_missing` (révisé le 2026-10-13).
- **Deux plans à la suite** : après « Repartir de zéro », l'annonce suivante rouvre l'invite sur le plan plus ancien.
- **« Plus tard » sur un dossier introuvable** : le plan reste et l'invite revient au lancement suivant.
- **Dossier vidé** : traité comme un dossier introuvable, car `reopen_run` ne trouverait aucun morceau.
- **Reprise d'un run dont des arbitrages étaient en attente** : `arbitration_required` rejoué alimente la file et le badge de l'onglet, comme dans un run vivant.
- **Double clic sur « Reprendre »** : une seule commande part, l'invite étant fermée au premier clic.

## Architectural decisions

### Décision : confirmation de sortie
**Options envisagées :**
- **A. Retirer `tagging`, `arbitration` et `unwritten`** : la modale ne reste que pour ce qui perd vraiment quelque chose.
- **B. Les garder, reformulés** : la modale annonce que le run sera proposé à la reprise, mais c'est une confirmation qui ne protège plus de rien.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- La Feature 3 nommait ce qui serait perdu : le plan persisté ne perd plus ces trois travaux.

### Décision : « Repartir de zéro » sans confirmation
**Options envisagées :**
- **A. Directe**, comme dans la maquette `AppShell`.
- **B. Avec un `DangerConfirm`** qui nomme les arbitrages perdus.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Les confirmations du projet sont réservées aux gestes sur les fichiers (DESIGN § Overlays) et aucun fichier n'est touché ici.

### Décision : geste quand le dossier est introuvable
**Options envisagées :**
- **A. Trois gestes** : « Plus tard » (visible seulement quand `folder_missing`), « Repartir de zéro », sans « Reprendre ».
- **B. Deux gestes** : « Repartir de zéro » seul, comme pour un plan illisible.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Un disque externe débranché ne doit pas coûter la session d'arbitrages, pour une ligne de template.
