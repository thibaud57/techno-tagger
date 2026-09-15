# Service sidecar Angular — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Établir depuis la webview la frontière unique vers le sidecar, en lançant le binaire et en transformant son flux NDJSON en état observable.

**Architecture:** `protocol.ts` porte les types miroir du contrat en unions discriminées. `sidecar-transport.ts` isole l'API Tauri derrière un jeton d'injection, ce qui rend le service testable sans plugin ni binaire. `SidecarService` consomme des lignes, met à jour des signals, et écrit des commandes — sans jamais attendre de réponse, le contrat ne portant aucun identifiant de corrélation.

**Tech Stack:** Angular 22 zoneless, signals natifs, `@tauri-apps/plugin-shell` 2.3.5, Vitest.

**Spec:** `docs/superpowers/specs/onglet-playlist-extraction-selective/06-service-sidecar-angular-design.md`

## Global Constraints

- **Les types sont maintenus à la main** en miroir de `sidecar/src/tagger/protocol.py`. Tout changement de champ se répercute des deux côtés (ADR-005).
- **`Command.sidecar("binaries/tagger")`**, nom exact d'`externalBin` sans suffixe target triple, sinon `SidecarNotAllowed` au premier lancement.
- **`spawn()` et jamais `execute()`** : le protocole est un flux continu sur un process long.
- **Aucun tampon de réassemblage** : Tauri livre déjà une ligne complète par événement `stdout`.
- **`stdout` porte le protocole, `stderr` les logs**, sans jamais les mélanger.
- **Aucune commande ne rend de promesse résolue sur son événement** : le contrat ne porte aucun identifiant de corrélation.
- **L'arrêt passe par la commande `shutdown`**, `Process.kill()` ne ciblant que le bootloader d'un binaire PyInstaller.
- **Aucune permission Tauri à ajouter** : `shell:allow-spawn` et `shell:allow-stdin-write` sont déjà déclarés.
- **Angular 22 zoneless**, signals natifs, aucune bibliothèque de store. Tests Vitest, sans `fakeAsync` ni `tick`, qui exigent zone.js.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`.
- **Pas de `Subject` intermédiaire** : le handler écrit directement dans les signals, aucun opérateur RxJS ne s'appliquant à ce flux (cf. `.claude/rules/angular/rxjs-interop.md`). La file d'arbitrage de la Feature 2 en aura un, elle a de vrais besoins de projection (`exhaustMap`, `scan`).
- **Convention de commit** : `type(scope): description`, scope `ui`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/models/protocol.ts` | Types miroir du contrat NDJSON, en unions discriminées. Aucune logique. |
| `src/app/core/sidecar-transport.ts` | Frontière vers Tauri : lancement, écriture, abonnement. Seul endroit qui connaît `Command.sidecar`. |
| `src/app/core/sidecar.service.ts` | État du run par signals, traitement des lignes reçues, émission des commandes. |
| `src/app/core/sidecar.service.spec.ts` | Traitement du flux et transitions d'état, avec un transport de test. |
| `src/app/app.config.ts` | Initializer de démarrage du sidecar. |

---

## Task 1: Types miroir du contrat

**Files:**
- Modify: `src/app/core/models/protocol.ts` (remplace le `TODO` et l'`export {}`)

**Interfaces:**
- Consumes: rien
- Produces:
  - Commandes : `GetVersionCommand`, `ShutdownCommand`, `ListPlaylistsCommand`, `ExtractPlaylistCommand`, union `SidecarCommand`
  - Événements : `VersionEvent`, `PlaylistsListedEvent`, `ExtractionProgressEvent`, `ExtractionFinishedEvent`, `SidecarErrorEvent`, union `SidecarEvent`
  - Types de données : `PlaylistEntry`, `DuplicateResolution`, `DiscardedCandidate`, `ExtractionFailure`
  - Littéraux : `ExtractionMode`, `Phase`, `DuplicateCriterion`, `ExtractionFailureReason`

- [ ] **Step 1: Écrire les types**

`ProgressEvent` et `ErrorEvent` sont des types DOM globaux : les réutiliser tels quels créerait une collision silencieuse, où l'éditeur résoudrait vers le type du navigateur. D'où `ExtractionProgressEvent` et `SidecarErrorEvent`.

Remplacer le contenu de `src/app/core/models/protocol.ts` après son commentaire de tête, qui est conservé :

```typescript
/**
 * Miroir manuel de `sidecar/src/tagger/protocol.py`. Pas de generation de code :
 * une vingtaine de types stables ne la rentabilisent pas.
 */

export type ExtractionMode = "copy" | "move"

export type Phase = "extraction" | "tagging" | "url_recovery" | "write"

export type DuplicateCriterion = "largest_file" | "path_order"

export type ExtractionFailureReason =
  | "permission_denied"
  | "disk_full"
  | "path_too_long"
  | "file_locked"
  | "file_missing"
  | "write_failed"

export interface PlaylistEntry {
  readonly playlist_id: number
  readonly name: string
  readonly track_count: number
}

export interface DiscardedCandidate {
  readonly path: string
  readonly size: number
}

export interface DuplicateResolution {
  readonly file_name: string
  readonly kept_path: string
  readonly kept_size: number
  readonly criterion: DuplicateCriterion
  readonly discarded: readonly DiscardedCandidate[]
}

export interface ExtractionFailure {
  readonly file_name: string
  readonly reason: ExtractionFailureReason
}

export interface GetVersionCommand {
  readonly command: "get_version"
}

export interface ShutdownCommand {
  readonly command: "shutdown"
}

export interface ListPlaylistsCommand {
  readonly command: "list_playlists"
  readonly playlist_path: string
}

export interface ExtractPlaylistCommand {
  readonly command: "extract_playlist"
  readonly source_folder: string
  readonly destination_folder: string
  readonly playlist_path: string
  /** `null` pour un M3U8, qui ne contient qu'une playlist. */
  readonly playlist_name: string | null
  readonly mode: ExtractionMode
}

export type SidecarCommand =
  | GetVersionCommand
  | ShutdownCommand
  | ListPlaylistsCommand
  | ExtractPlaylistCommand

export interface VersionEvent {
  readonly event: "version"
  readonly version: string
  /** Seul le sidecar lit le trousseau : l'interface l'apprend ici. */
  readonly api_key_configured: boolean
}

export type PlaylistFormat = "vlc_dump" | "m3u8"

export interface PlaylistsListedEvent {
  readonly event: "playlists_listed"
  /** Reconnu par le sidecar a l'en-tete du fichier : l'interface ne le deduit jamais. */
  readonly playlist_format: PlaylistFormat
  readonly playlists: readonly PlaylistEntry[]
}

/** `ProgressEvent` est un type DOM global : le prefixe evite la collision. */
export interface ExtractionProgressEvent {
  readonly event: "progress"
  readonly phase: Phase
  readonly processed: number
  readonly total: number
}

export interface ExtractionFinishedEvent {
  readonly event: "extraction_finished"
  readonly extracted: readonly string[]
  readonly already_present: readonly string[]
  readonly missing: readonly string[]
  readonly duplicates: readonly DuplicateResolution[]
  readonly failures: readonly ExtractionFailure[]
  readonly report_path: string
}

/** `ErrorEvent` est un type DOM global : meme raison. */
export interface SidecarErrorEvent {
  readonly event: "error"
  readonly code: string
  readonly params: Record<string, unknown>
  readonly message: string
}

export type SidecarEvent =
  | VersionEvent
  | PlaylistsListedEvent
  | ExtractionProgressEvent
  | ExtractionFinishedEvent
  | SidecarErrorEvent
```

Les champs gardent le nommage `snake_case` du contrat : renommer côté TypeScript imposerait une conversion à chaque frontière, pour un confort d'écriture qui ne vaut pas ce risque d'écart.

- [ ] **Step 2: Vérifier la compilation**

Run: `just typecheck`
Expected: `tsc --noEmit` sans erreur

- [ ] **Step 3: Commit**

```bash
git add src/app/core/models/protocol.ts
git commit -m "feat(ui): types miroir du contrat NDJSON"
```

---

## Task 2: Frontière de transport

**Files:**
- Create: `src/app/core/sidecar-transport.ts`

**Interfaces:**
- Consumes: `@tauri-apps/plugin-shell`
- Produces:
  - `SidecarHandlers { onLine, onStderr, onTerminated }`
  - `SidecarTransport { start(handlers): Promise<boolean>; send(line): Promise<void> }`
  - `SIDECAR_TRANSPORT: InjectionToken<SidecarTransport>`, dont la factory rend l'implémentation Tauri

- [ ] **Step 1: Écrire la frontière**

Créer `src/app/core/sidecar-transport.ts` :

```typescript
import { InjectionToken } from "@angular/core"
import { Command } from "@tauri-apps/plugin-shell"

/**
 * Frontiere vers Tauri, seul endroit qui connait `Command.sidecar`.
 *
 * Son existence sert le test : la rule de test du projet demande de mocker le
 * protocole au niveau du service qui l'expose, pas les plugins Tauri sous-jacents.
 * Un transport de test pousse des lignes a la demande, sans binaire ni webview.
 */
export interface SidecarHandlers {
  /** Une ligne de `stdout`, deja decoupee par Tauri : un evenement NDJSON complet. */
  readonly onLine: (line: string) => void
  /** Une ligne de `stderr` : un log, jamais un evenement du protocole. */
  readonly onStderr: (line: string) => void
  readonly onTerminated: () => void
}

export interface SidecarTransport {
  /** Rend `false` quand le sidecar n'a pas pu demarrer, sans lever. */
  start(handlers: SidecarHandlers): Promise<boolean>
  send(line: string): Promise<void>
}

class TauriSidecarTransport implements SidecarTransport {
  #child: Awaited<ReturnType<Command<string>["spawn"]>> | null = null

  async start(handlers: SidecarHandlers): Promise<boolean> {
    try {
      // Nom exact d'`externalBin`, sans suffixe target triple : c'est ce que
      // resout `Command.sidecar` cote JS, et un nom errone donne un
      // `SidecarNotAllowed` au premier lancement.
      const command = Command.sidecar("binaries/tagger")

      command.stdout.on("data", handlers.onLine)
      command.stderr.on("data", handlers.onStderr)
      command.on("close", handlers.onTerminated)
      command.on("error", handlers.onTerminated)

      // `spawn` et jamais `execute` : le protocole est un flux continu sur un
      // process long, `execute` attendrait sa fin.
      this.#child = await command.spawn()

      return true
    } catch {
      // Hors Tauri, `invoke` appelle `window.__TAURI_INTERNALS__` sans garde et
      // rejette. L'interface reste navigable, le service passe en indisponible.
      this.#child = null

      return false
    }
  }

  async send(line: string): Promise<void> {
    await this.#child?.write(line)
  }
}

export const SIDECAR_TRANSPORT = new InjectionToken<SidecarTransport>("SidecarTransport", {
  providedIn: "root",
  factory: () => new TauriSidecarTransport(),
})
```

- [ ] **Step 2: Vérifier la compilation**

Run: `just typecheck && just lint`
Expected: tout vert

- [ ] **Step 3: Commit**

```bash
git add src/app/core/sidecar-transport.ts
git commit -m "feat(ui): frontiere de transport vers le sidecar"
```

---

## Task 3: Service et état par signals

**Files:**
- Modify: `src/app/core/sidecar.service.ts`
- Test: `src/app/core/sidecar.service.spec.ts`

**Interfaces:**
- Consumes: les types de la Task 1, `SIDECAR_TRANSPORT` de la Task 2
- Produces:
  - signaux en lecture seule : `available`, `version`, `versionMismatch`, `playlistFormat`, `playlists`, `progress`, `extraction`, `lastError`
  - méthodes : `start()`, `listPlaylists(playlistPath)`, `extractPlaylist(request)`, `shutdown()`

- [ ] **Step 1: Écrire les tests**

Créer `src/app/core/sidecar.service.spec.ts` :

```typescript
import { TestBed } from "@angular/core/testing"

import { SIDECAR_TRANSPORT, SidecarHandlers, SidecarTransport } from "./sidecar-transport"
import { SidecarService } from "./sidecar.service"

/**
 * Le protocole se mocke au niveau du transport, la frontiere que le service
 * expose : monter un vrai sidecar testerait Tauri et PyInstaller, pas notre code.
 */
class FakeTransport implements SidecarTransport {
  handlers: SidecarHandlers | null = null
  readonly sent: string[] = []
  startable = true
  starts = 0

  async start(handlers: SidecarHandlers): Promise<boolean> {
    this.starts += 1
    if (!this.startable) {
      return false
    }
    this.handlers = handlers

    return true
  }

  async send(line: string): Promise<void> {
    this.sent.push(line)
  }

  emit(payload: object): void {
    this.handlers?.onLine(JSON.stringify(payload))
  }

  emitRaw(line: string): void {
    this.handlers?.onLine(line)
  }
}

describe("SidecarService", () => {
  let transport: FakeTransport
  let service: SidecarService

  beforeEach(() => {
    transport = new FakeTransport()
    TestBed.configureTestingModule({
      providers: [{ provide: SIDECAR_TRANSPORT, useValue: transport }],
    })
    service = TestBed.inject(SidecarService)
  })

  it("spawns the sidecar only once", async () => {
    await service.start()
    await service.start()

    expect(transport.starts).toBe(1)
  })

  it("requests the version before any other command", async () => {
    await service.start()

    expect(JSON.parse(transport.sent[0])).toEqual({ command: "get_version" })
  })

  it("feeds the version from the received event", async () => {
    await service.start()

    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: false })

    expect(service.version()).toBe(APP_VERSION)
  })

  it("reports no mismatch when the versions match", async () => {
    await service.start()

    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: true })

    expect(service.versionMismatch()).toBeNull()
  })

  it("reports the mismatch with both versions", async () => {
    await service.start()

    transport.emit({ event: "version", version: "0.0.1-old", api_key_configured: false })

    expect(service.versionMismatch()).toEqual({ ui: APP_VERSION, sidecar: "0.0.1-old" })
  })

  it("stays unavailable without throwing when the spawn fails", async () => {
    transport.startable = false

    await service.start()

    expect(service.available()).toBe(false)
  })

  it("feeds the received playlists", async () => {
    await service.start()

    transport.emit({
      event: "playlists_listed",
      playlist_format: "vlc_dump",
      playlists: [{ playlist_id: 1, name: "set", track_count: 8 }],
    })

    expect(service.playlists()).toEqual([{ playlist_id: 1, name: "set", track_count: 8 }])
    expect(service.playlistFormat()).toBe("vlc_dump")
  })

  it("feeds the received progress", async () => {
    await service.start()

    transport.emit({ event: "progress", phase: "extraction", processed: 2, total: 5 })

    expect(service.progress()).toEqual({
      event: "progress",
      phase: "extraction",
      processed: 2,
      total: 5,
    })
  })

  it("feeds the result and resets the progress", async () => {
    await service.start()
    transport.emit({ event: "progress", phase: "extraction", processed: 5, total: 5 })

    transport.emit({
      event: "extraction_finished",
      extracted: ["a.mp3"],
      already_present: [],
      missing: [],
      duplicates: [],
      failures: [],
      report_path: "C:/work/report.json",
    })

    expect(service.extraction()?.report_path).toBe("C:/work/report.json")
    expect(service.progress()).toBeNull()
  })

  it("feeds the error without interrupting the stream", async () => {
    await service.start()

    transport.emit({ event: "error", code: "playlist_not_found", params: {}, message: "x" })
    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: false })

    expect(service.lastError()?.code).toBe("playlist_not_found")
    expect(service.version()).toBe(APP_VERSION)
  })

  it("ignores a line that is not JSON", async () => {
    await service.start()

    transport.emitRaw("pas du json")
    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: false })

    expect(service.version()).toBe(APP_VERSION)
  })

  it("ignores an event of unknown type", async () => {
    await service.start()

    transport.emit({ event: "unheard_of" })

    expect(service.version()).toBeNull()
    expect(service.lastError()).toBeNull()
  })

  it("never reads a stderr line as an event", async () => {
    await service.start()

    transport.handlers?.onStderr(
      JSON.stringify({ event: "version", version: "9.9.9", api_key_configured: true }),
    )

    expect(service.version()).toBeNull()
  })

  it("writes a command as a single newline-terminated line", async () => {
    await service.start()

    await service.extractPlaylist({
      source_folder: "C:/lib",
      destination_folder: "C:/work",
      playlist_path: "C:/x.m3u8",
      playlist_name: null,
      mode: "copy",
    })

    const line = transport.sent.at(-1) ?? ""
    expect(line.endsWith("\n")).toBe(true)
    expect(JSON.parse(line).command).toBe("extract_playlist")
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm test --run src/app/core/sidecar.service.spec.ts`
Expected: FAIL, `SidecarService` n'expose ni `start` ni les signaux

- [ ] **Step 3: Écrire le service**

Remplacer le corps de `src/app/core/sidecar.service.ts`, en conservant son commentaire de tête :

```typescript
import { Injectable, inject, signal } from "@angular/core"

import {
  ExtractPlaylistCommand,
  ExtractionFinishedEvent,
  ExtractionProgressEvent,
  PlaylistEntry,
  PlaylistFormat,
  SidecarCommand,
  SidecarErrorEvent,
  SidecarEvent,
} from "./models/protocol"
import { SIDECAR_TRANSPORT } from "./sidecar-transport"

const KNOWN_EVENTS = new Set([
  "version",
  "playlists_listed",
  "progress",
  "extraction_finished",
  "error",
])

/**
 * Frontiere unique entre la webview et le metier. Detient l'etat du run : les
 * composants lisent et emettent, ils ne calculent rien. La file d'arbitrage
 * viendra avec le pipeline de tagging (Feature 2), elle n'existe pas ici.
 */
@Injectable({ providedIn: "root" })
export class SidecarService {
  readonly #transport = inject(SIDECAR_TRANSPORT)

  readonly #available = signal(false)
  readonly #version = signal<string | null>(null)
  readonly #versionMismatch = signal<{ ui: string; sidecar: string } | null>(null)
  readonly #playlistFormat = signal<PlaylistFormat | null>(null)
  readonly #playlists = signal<readonly PlaylistEntry[]>([])
  readonly #progress = signal<ExtractionProgressEvent | null>(null)
  readonly #extraction = signal<ExtractionFinishedEvent | null>(null)
  readonly #lastError = signal<SidecarErrorEvent | null>(null)

  readonly available = this.#available.asReadonly()
  readonly version = this.#version.asReadonly()
  /** Non nul quand le sidecar et l'interface ne portent pas la meme version. */
  readonly versionMismatch = this.#versionMismatch.asReadonly()
  /** Decide si l'interface propose un selecteur de playlist. */
  readonly playlistFormat = this.#playlistFormat.asReadonly()
  readonly playlists = this.#playlists.asReadonly()
  readonly progress = this.#progress.asReadonly()
  readonly extraction = this.#extraction.asReadonly()
  readonly lastError = this.#lastError.asReadonly()

  #started = false

  /**
   * Lance le sidecar et lui demande sa version.
   *
   * Idempotent : le sidecar est un process long lance au demarrage, pas une
   * invocation par action.
   */
  async start(): Promise<void> {
    if (this.#started) {
      return
    }
    this.#started = true

    const available = await this.#transport.start({
      onLine: (line) => this.#handleLine(line),
      onStderr: (line) => console.error("[sidecar]", line),
      onTerminated: () => this.#available.set(false),
    })
    this.#available.set(available)

    if (available) {
      await this.#send({ command: "get_version" })
    }
  }

  async listPlaylists(playlistPath: string): Promise<void> {
    await this.#send({ command: "list_playlists", playlist_path: playlistPath })
  }

  async extractPlaylist(request: Omit<ExtractPlaylistCommand, "command">): Promise<void> {
    this.#extraction.set(null)
    await this.#send({ command: "extract_playlist", ...request })
  }

  /**
   * `Process.kill()` ne ciblerait que le bootloader d'un binaire PyInstaller et
   * laisserait le process Python vivant : l'arret passe par le protocole.
   */
  async shutdown(): Promise<void> {
    await this.#send({ command: "shutdown" })
  }

  async #send(command: SidecarCommand): Promise<void> {
    if (!this.#available()) {
      return
    }
    // Une ligne, une commande : c'est ce que lit la boucle du sidecar.
    await this.#transport.send(`${JSON.stringify(command)}\n`)
  }

  /**
   * Traite une ligne de `stdout`, deja decoupee par Tauri.
   *
   * Une ligne illisible ou d'un type inconnu n'interrompt pas la session, mais
   * elle est tracee : c'est le symptome d'un contrat desynchronise entre les deux
   * cotes, et l'absorber en silence le rendrait indiagnosticable.
   */
  #handleLine(line: string): void {
    let event: SidecarEvent

    try {
      const parsed: unknown = JSON.parse(line)
      if (!this.#isKnownEvent(parsed)) {
        console.error("[sidecar] evenement inconnu, contrat desynchronise", line)

        return
      }
      event = parsed
    } catch {
      console.error("[sidecar] ligne illisible", line)

      return
    }

    switch (event.event) {
      case "version":
        this.#version.set(event.version)
        this.#versionMismatch.set(
          event.version === APP_VERSION ? null : { ui: APP_VERSION, sidecar: event.version },
        )
        break
      case "playlists_listed":
        this.#playlistFormat.set(event.playlist_format)
        this.#playlists.set(event.playlists)
        break
      case "progress":
        this.#progress.set(event)
        break
      case "extraction_finished":
        this.#extraction.set(event)
        this.#progress.set(null)
        break
      case "error":
        this.#lastError.set(event)
        break
      default: {
        // Ajouter un evenement cote sidecar sans le traiter ici devient une
        // erreur de compilation, pas une ligne silencieusement perdue.
        const exhaustive: never = event
        console.error("[sidecar] evenement non traite", exhaustive)
      }
    }
  }

  #isKnownEvent(parsed: unknown): parsed is SidecarEvent {
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "event" in parsed &&
      typeof parsed.event === "string" &&
      KNOWN_EVENTS.has(parsed.event)
    )
  }
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `pnpm test --run src/app/core/sidecar.service.spec.ts`
Expected: PASS, 14 tests

- [ ] **Step 5: Démarrer le sidecar au bootstrap**

Dans `src/app/app.config.ts`, ajouter un second initializer après celui de la langue :

```typescript
    provideAppInitializer(async () => {
      await inject(SidecarService).start()
    }),
```

Compléter l'import : `import { SidecarService } from "./core/sidecar.service"`.

Le sidecar est un process long lancé au démarrage, et `get_version` doit précéder toute autre commande : le contrôle de version est donc fait avant le premier écran.

- [ ] **Step 6: Vérifier l'application en conditions réelles**

Run: `just build-sidecar && just dev`
Expected: la fenêtre s'ouvre, aucune erreur `SidecarNotAllowed` dans la console, et le sidecar apparaît dans les processus. En `just dev-ui`, l'interface reste navigable malgré l'absence de sidecar.

- [ ] **Step 7: Vérifier le gate qualité complet**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 8: Commit**

```bash
git add src/app/core/sidecar.service.ts src/app/core/sidecar.service.spec.ts src/app/app.config.ts
git commit -m "feat(ui): service sidecar et etat du run par signals"
```

---

## Vérification de l'état livré

L'incrément est complet quand `just test && just lint && just typecheck` rend les trois gates verts, que `just dev` ouvre l'application avec un sidecar démarré et sa version reçue, et que `just dev-ui` laisse l'interface navigable sans sidecar.

Les scénarios du spec sont couverts : démarrage nominal et unicité du lancement, sidecar indisponible, version divergente, playlists, progression, résultat d'extraction, erreur, ligne illisible, événement inconnu, lignes de `stderr` et écriture d'une commande (Task 3), types miroir (Task 1), isolation de Tauri (Task 2).

Ce que ce sub-project ne fait pas : afficher quoi que ce soit. L'onglet Playlist, qui lit ces signaux et émet ces commandes, est le sub-project 07. La file d'arbitrage et l'état du pipeline de tagging appartiennent à la Feature 2.
