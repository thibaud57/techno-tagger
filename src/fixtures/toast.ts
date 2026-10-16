import { TestBed } from "@angular/core/testing"
import { MessageService } from "primeng/api"
import { vi } from "vitest"

/** Espionne les toasts annonces : un `p-toast` n'est pas monte dans les specs. */
export const spyToast = () => vi.spyOn(TestBed.inject(MessageService), "add")
