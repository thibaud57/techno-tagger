import { TestBed } from "@angular/core/testing"
import { Router } from "@angular/router"
import { vi } from "vitest"

/** Remplace la navigation reelle du `Router` : seul compte l'appel, aucune route n'est chargee. */
export const stubNavigation = (method: "navigate" | "navigateByUrl") =>
  vi.spyOn(TestBed.inject(Router), method).mockResolvedValue(true)
