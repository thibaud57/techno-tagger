// Extraire une playlist, par le vrai canal du sidecar, sans réseau : le process lancé par
// `just dev-sidecar`, commandes NDJSON sur stdin, événements sur stdout. Listage d'un dump VLC et d'un
// M3U8, extraction en copie puis en déplacement, rapports, homonyme, relance, refus d'une playlist inconnue.
// Le sélecteur de fichiers natif de la fenêtre ne se pilote pas : le canal NDJSON est la surface jouée.

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { HOMONYM, MISSING_TRACK, PLAYLIST, Sidecar, buildLibrary, last, removeTree, scratch } from "./_common.mjs"
import { play } from "./report.mjs"

const workdir = scratch("extraction")
let tree = null
let sidecar = null
const extraction = (destination, library = tree.library) => ({
  command: "extract_playlist",
  source_folder: library,
  destination_folder: destination,
  playlist_path: tree.dump,
  playlist_name: PLAYLIST,
})
// « beta » est l'homonyme rangé dans `singles`
const sourceOf = (library, name) => join(library, name.includes("beta") ? "singles" : "", name)

await play(
  "extraction",
  [
    ["départ", async () => {
      const appData = join(workdir, "appdata")
      mkdirSync(appData)
      tree = buildLibrary(workdir)
      sidecar = new Sidecar(appData)
    }],
    ["playlists", async (report) => {
      const [dump] = await sidecar.ask({ command: "list_playlists", playlist_path: tree.dump }, "playlists_listed")
      const names = (dump.playlists ?? []).map((entry) => entry.name)
      report.check(dump.playlist_format === "vlc_dump" && names.includes(PLAYLIST), "dump VLC : ses playlists listées", names.join(", "))
      const [m3u8] = await sidecar.ask({ command: "list_playlists", playlist_path: tree.m3u8 }, "playlists_listed")
      report.check(m3u8.playlist_format === "m3u8" && m3u8.playlists.length === 0, "M3U8 : format reconnu, aucune playlist à choisir")
    }],
    ["extraction en copie", async (report) => {
      const destination = join(workdir, "copy")
      const events = await sidecar.ask(extraction(destination), "extraction_finished")
      const done = last(events)
      report.check(done.event === "extraction_finished", "extraction terminée", done.event)
      report.check(events.some((event) => event.event === "progress"), "progression émise pendant l'extraction")
      report.check(
        done.extracted?.length === tree.tracks.length && done.missing?.includes(MISSING_TRACK),
        "morceaux copiés, le morceau absent de la bibliothèque signalé",
        `${done.extracted?.length} copiés, absents ${JSON.stringify(done.missing)}`,
      )
      const copied = readdirSync(destination)
      const kept = copied.includes(HOMONYM.name) ? statSync(join(destination, HOMONYM.name)).size : null
      report.check(
        done.duplicates?.length === 1 && kept === HOMONYM.large,
        "homonyme départagé par la taille : le plus gros des deux est copié",
        `${done.duplicates?.length} homonyme(s), ${kept} octets copiés pour ${HOMONYM.large} et ${HOMONYM.small} en source`,
      )
      report.check(tree.tracks.every((name) => copied.includes(name)), "fichiers présents en destination")
      report.check(
        tree.tracks.every((name) => existsSync(sourceOf(tree.library, name))),
        "bibliothèque source intacte en mode copie",
      )
      report.check(
        copied.some((name) => name.endsWith(".json")) && copied.some((name) => name.endsWith(".md")) && existsSync(done.report_path ?? ""),
        "rapports .json et .md écrits en destination",
      )
      const again = last(await sidecar.ask(extraction(destination), "extraction_finished"))
      report.check(again.already_present?.length === tree.tracks.length && again.extracted?.length === 0, "relance : tout est déjà présent")
    }],
    ["extraction depuis un M3U8", async (report) => {
      const destination = join(workdir, "from-m3u8")
      const command = { ...extraction(destination), playlist_path: tree.m3u8 }
      delete command.playlist_name
      const done = last(await sidecar.ask(command, "extraction_finished"))
      report.check(done.event === "extraction_finished" && done.extracted?.length > 0, "extraction d'un M3U8 sans nom de playlist", done.event)
    }],
    ["extraction en déplacement", async (report) => {
      // Bibliothèque à part : le mode déplacement vide sa source
      const moving = buildLibrary(join(workdir, "moving"))
      const destination = join(workdir, "moved")
      const done = last(await sidecar.ask({ ...extraction(destination, moving.library), mode: "move" }, "extraction_finished"))
      report.check(done.event === "extraction_finished" && done.extracted?.length === tree.tracks.length, "extraction en déplacement terminée", done.event)
      report.check(
        tree.tracks.every((name) => readdirSync(destination).includes(name) && !existsSync(sourceOf(moving.library, name))),
        "les morceaux ont quitté la bibliothèque source",
      )
    }],
    ["playlist inconnue", async (report) => {
      const refused = last(await sidecar.ask({ ...extraction(join(workdir, "refused")), playlist_name: "aucune playlist de ce nom" }, "extraction_finished"))
      report.check(refused.event === "error" && refused.code === "playlist_not_found", "playlist inconnue refusée", refused.code)
      report.check(!existsSync(join(workdir, "refused")), "rien n'est écrit en destination après le refus")
      const [alive] = await sidecar.ask({ command: "list_playlists", playlist_path: tree.dump }, "playlists_listed")
      report.check(alive.event === "playlists_listed", "la boucle répond encore après le refus")
    }],
  ],
  async () => {
    await sidecar?.stop()
    removeTree(workdir)
  },
)
