---
paths:
  - "src-tauri/tauri.conf.json"
  - "src-tauri/installer-hooks.nsh"
---

# Tauri : updater et bundle

## À faire
- Renseigner `plugins.updater.pubkey` avec le **contenu** de la clé publique, pas un chemin
- Poser `plugins.updater.requireSignedVersion: true` dès le câblage de l'updater : la réponse de l'endpoint n'est pas signée et sans ce flag elle peut associer un numéro gonflé à une ancienne release authentique pour forcer un downgrade
- Vérifier les mises à jour au démarrage ou à la demande depuis les Réglages, mais n'installer que moteur au repos, jamais pendant un run : sous Windows l'application se ferme avant l'installation, ce qui interromprait le run
- Garder `installMode: "passive"`, le défaut (barre de progression sans assistant)
- Cibler `nsis` en `bundle.targets` : le bootstrapper WebView2 couvre une installation Windows incomplète et NSIS reçoit la signature comme le MSI (cf. [ADR-015](../../../docs/adrs/015-cibles-distribution-windows.md))

## À éviter
- Committer la clé privée de l'updater : elle passe par `TAURI_SIGNING_PRIVATE_KEY` au moment du build en CI, jamais par un fichier d'environnement
- Régénérer une paire de clés d'updater avec `--force` : une clé perdue rend non-updatables toutes les installations déjà distribuées. Depuis 2.12, `tauri signer generate` refuse d'écraser une clé sans ce flag
- Activer `plugins.updater.allowDowngrades` : il retire, avec `requireSignedVersion`, une des deux gardes de l'updater contre la réinstallation d'une ancienne release signée. Depuis 2.12, `check()` n'accepte plus cette option côté webview

## Gotchas
- `installer-hooks.nsh` tue le sidecar avant que l'installeur n'écrase ses fichiers : en mise à jour, NSIS ne détecte que l'exe principal et un `tagger.exe` orphelin verrouillerait son propre fichier
- `identifier`, `productName`, `externalBin` et le scope `shell:allow-spawn` sont recopiés ailleurs (sidecar, `angular.json`, workflows) : un renommage se fait partout, `test_main.py` le garde
- Le manifeste de l'updater n'exige que `version`, `platforms.<target>.url` et `.signature`
- `requireSignedVersion` rejette toute release signée avant le CLI 2.12, faute de version inscrite dans sa signature
- `bundle.createUpdaterArtifacts: true` avec une `pubkey` fait échouer tout `tauri build` sans `TAURI_SIGNING_PRIVATE_KEY` (« A public key has been found, but no private key ») : `just build` passe `--no-sign`, seule la CI signe
