import { TestBed } from "@angular/core/testing"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"
import { firstValueFrom } from "rxjs"

import { ReasonTextPipe, extractionReasonKeys, rollbackReasonKeys, trackReasonKeys } from "./reason"

describe("reason keys", () => {
  it.each([
    ["extraction", extractionReasonKeys("file_locked")],
    ["write", trackReasonKeys("file_locked")],
    ["rollback", rollbackReasonKeys("file_locked")],
  ])("shares one cause and words the retry by the context (%s)", (context, keys) => {
    expect(keys).toEqual({
      cause: "reason.file_locked",
      remedy: { fix: "reason.fix.file_locked", retry: `reason.retry.${context}` },
    })
  })

  it.each(["file_missing", "write_failed"] as const)(
    "gives %s its cause alone, nothing to fix",
    (reason) => {
      expect(trackReasonKeys(reason).remedy).toBeNull()
    },
  )

  it("keeps a resolution reason in the tagging set", () => {
    expect(trackReasonKeys("no_result")).toEqual({
      cause: "tagging.reason.no_result",
      remedy: null,
    })
  })

  it("keeps the rollback only reason in the rollback set", () => {
    expect(rollbackReasonKeys("name_taken")).toEqual({
      cause: "rollback.reason.name_taken",
      remedy: null,
    })
  })
})

describe("ReasonTextPipe", () => {
  const pipe = () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] })
    const translate = TestBed.inject(TranslateService)
    translate.setTranslation("en", {
      reason: {
        file_locked: "locked",
        write_failed: "not written",
        fix: { file_locked: "Close it, then {{retry}}." },
        retry: { rollback: "restore again" },
      },
    })
    translate.use("en")

    return TestBed.runInInjectionContext(() => new ReasonTextPipe())
  }

  it("puts the gesture to repair on the line after the cause", async () => {
    const text = await firstValueFrom(pipe().transform(rollbackReasonKeys("file_locked")))

    expect(text).toBe("locked\nClose it, then restore again.")
  })

  it("gives a reason without a gesture its cause alone", async () => {
    const text = await firstValueFrom(pipe().transform(rollbackReasonKeys("write_failed")))

    expect(text).toBe("not written")
  })

  it("renders nothing without a reason", async () => {
    const text = await firstValueFrom(pipe().transform(null))

    expect(text).toBe("")
  })

  it("follows a language change", async () => {
    const translated = pipe()
    TestBed.inject(TranslateService).setTranslation("fr", {
      reason: { write_failed: "non traité" },
    })
    const texts: string[] = []
    const subscription = translated
      .transform(rollbackReasonKeys("write_failed"))
      .subscribe((t: string) => texts.push(t))

    TestBed.inject(TranslateService).use("fr")
    await Promise.resolve()

    subscription.unsubscribe()
    expect(texts.at(-1)).toBe("non traité")
  })
})
