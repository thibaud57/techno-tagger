import * as Sentry from "@sentry/angular"

import { sentryOptions } from "./sentry-options"

type SentEvent = {
  sdk?: { settings?: { infer_ip?: string } }
  breadcrumbs?: { category?: string }[]
}

/**
 * ADR-014 : rien de personnel ne quitte la machine. Sentry 11 collecte par defaut
 * l'IP de l'utilisateur et la console, que la configuration doit couper.
 */
describe("sentryOptions", () => {
  let sent: SentEvent[]

  beforeEach(() => {
    sent = []
    Sentry.init({
      ...sentryOptions("https://key@o0.ingest.sentry.io/0", "techno-tagger@test", "test"),
      transport: () => ({
        send: (envelope) => {
          for (const [header, payload] of envelope[1]) {
            if (header.type === "event") sent.push(payload as SentEvent)
          }
          return Promise.resolve({})
        },
        flush: () => Promise.resolve(true),
      }),
    })
  })

  afterEach(async () => {
    await Sentry.close()
  })

  it("asks Sentry never to infer the user's IP address", async () => {
    Sentry.captureException(new Error("boom"))
    await Sentry.flush()

    expect(sent[0]?.sdk?.settings?.infer_ip).toBe("never")
  })

  it("sends no console line as a breadcrumb", async () => {
    console.warn("Robert Hood - Minimal Nation")

    Sentry.captureException(new Error("boom"))
    await Sentry.flush()

    expect(sent[0]?.breadcrumbs ?? []).not.toContainEqual(
      expect.objectContaining({ category: "console" }),
    )
  })
})
