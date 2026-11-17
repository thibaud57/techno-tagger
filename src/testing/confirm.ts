import { TestBed } from "@angular/core/testing"
import { ConfirmationService } from "primeng/api"
import { vi } from "vitest"

/**
 * Espionne `ConfirmationService.confirm` : `options()` rend la demande posee, `accept()` joue le
 * geste « Confirmer » de l'utilisateur. A appeler une fois le service fourni au TestBed.
 */
export const spyConfirmation = () => {
  const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

  return {
    options: () => confirm.mock.calls[0]?.[0],
    accept: () => {
      confirm.mock.calls[0]?.[0].accept?.()
    },
  }
}
