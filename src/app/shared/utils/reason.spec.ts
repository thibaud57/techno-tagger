import { TestBed } from "@angular/core/testing"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"
import { firstValueFrom } from "rxjs"

import { translateWith } from "../../../fixtures/translate"
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

  it.each([
    {
      case: "keeps a resolution reason in the tagging set",
      keys: trackReasonKeys("no_result"),
      cause: "tagging.reason.no_result",
    },
    {
      case: "keeps the rollback only reason in the rollback set",
      keys: rollbackReasonKeys("name_taken"),
      cause: "rollback.reason.name_taken",
    },
  ])("$case", ({ keys, cause }) => {
    expect(keys).toEqual({ cause, remedy: null })
  })
})

describe("ReasonTextPipe", () => {
  const pipe = () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] })
    translateWith({
      reason: {
        file_locked: "locked",
        write_failed: "not written",
        fix: { file_locked: "Close it, then {{retry}}." },
        retry: { rollback: "restore again" },
      },
    })

    return TestBed.runInInjectionContext(() => new ReasonTextPipe())
  }

  it.each([
    {
      case: "puts the gesture to repair on the line after the cause",
      keys: rollbackReasonKeys("file_locked"),
      expected: "locked\nClose it, then restore again.",
    },
    {
      case: "gives a reason without a gesture its cause alone",
      keys: rollbackReasonKeys("write_failed"),
      expected: "not written",
    },
    { case: "renders nothing without a reason", keys: null, expected: "" },
  ])("$case", async ({ keys, expected }) => {
    const text = await firstValueFrom(pipe().transform(keys))

    expect(text).toBe(expected)
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
