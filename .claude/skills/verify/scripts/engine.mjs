// Démarrer et arrêter le moteur, comme l'app le fait à chaque ouverture et fermeture : le process lancé
// par `just dev-sidecar` annonce sa version, ses seuils par défaut et son fichier de logs, refuse ce qui
// n'est pas une commande sans s'arrêter, sort en 0 sur `shutdown` comme sur la fin de stdin.
// Le trousseau est le vrai : seule la lecture (`get_version`) est jouée, jamais `set_api_key`.

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { Sidecar, VERSION, last, removeTree, scratch, sleep } from "./_common.mjs"
import { play } from "./report.mjs"

const workdir = scratch("engine")
const appData = join(workdir, "appdata")
let sidecar = null

await play(
  "engine",
  [
    ["départ", async () => {
      mkdirSync(appData)
      sidecar = new Sidecar(appData)
    }],
    ["version", async (report) => {
      const [version] = await sidecar.ask({ command: "get_version" }, "version")
      report.check(version.event === "version" && version.version === VERSION, "get_version rend la version de package.json", `${version.version} pour ${VERSION}`)
      report.check(typeof version.api_key_configured === "boolean", "la présence de la clé API est un booléen, sans la clé")
      report.check(version.default_thresholds?.floor === 70 && version.default_thresholds?.ceiling === 90, "seuils par défaut 70 et 90")
      report.check(version.log_file?.startsWith(appData) && existsSync(version.log_file), "fichier de logs sous le dossier de données isolé, présent")
    }],
    ["refus sans arrêt de la boucle", async (report) => {
      const unknown = last(await sidecar.ask({ command: "commande_inconnue" }, "version"))
      report.check(unknown.event === "error" && unknown.code === "malformed_command", "commande inconnue refusée", unknown.code)
      const raw = await sidecar.askRaw("ceci n'est pas du JSON")
      report.check(raw?.event === "error" && raw?.code === "malformed_command", "ligne non JSON refusée", raw?.code ?? "aucune réponse")
      const alive = last(await sidecar.ask({ command: "get_version" }, "version"))
      report.check(alive.event === "version", "la boucle répond encore après deux refus")
    }],
    ["arrêt par shutdown", async (report) => {
      sidecar.send({ command: "shutdown" })
      const code = await Promise.race([sidecar.exited, sleep(20_000).then(() => "timeout")])
      report.check(code === 0, "shutdown : le process sort en 0", String(code))
      report.check(sidecar.invalid.length === 0, "chaque ligne de stdout est un objet JSON", sidecar.invalid.slice(0, 1).join(""))
    }],
    ["arrêt par fin de stdin", async (report) => {
      const second = new Sidecar(appData)
      try {
        const [version] = await second.ask({ command: "get_version" }, "version")
        const code = await second.stop()
        report.check(version.event === "version" && code === 0, "stdin fermé : le process sort en 0", String(code))
      } finally {
        await second.stop()
      }
    }],
  ],
  async () => {
    await sidecar?.stop()
    removeTree(workdir)
  },
)
