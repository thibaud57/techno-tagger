import { signal } from "@angular/core"
import { vi } from "vitest"

import type { PendingWork } from "../app/core/platform/close-guard.service"

/** Faux `CloseGuard` : aucune demande de fermeture en cours, sauf celle qu'un test pose. */
export const closeGuardStub = (request: readonly PendingWork[] | null = null, blocked = false) => ({
  install: vi.fn(() => Promise.resolve()),
  request: signal(request),
  blocked: signal(blocked),
  stay: vi.fn(),
  leave: vi.fn(() => Promise.resolve()),
})
