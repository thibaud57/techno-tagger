import { TestBed } from "@angular/core/testing"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"
import { firstValueFrom } from "rxjs"

import { action, hostOf } from "../../fixtures/dom"
import { DEMO_RELOAD, DemoBannerComponent } from "./demo-banner.component"

describe("DemoBannerComponent", () => {
  it("restarts the demo from its home page", () => {
    const reload = vi.fn()
    TestBed.configureTestingModule({
      imports: [DemoBannerComponent],
      providers: [provideTranslateService(), { provide: DEMO_RELOAD, useValue: reload }],
    })
    const fixture = TestBed.createComponent(DemoBannerComponent)
    fixture.detectChanges()

    action("restart", hostOf(fixture))?.click()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["fr", "https://thibaud-geisler.com/fr/contact"],
    ["en", "https://thibaud-geisler.com/en/contact"],
  ])("points the contact link to the page of the current language (%s)", async (lang, url) => {
    TestBed.configureTestingModule({
      imports: [DemoBannerComponent],
      providers: [provideTranslateService()],
    })
    await firstValueFrom(TestBed.inject(TranslateService).use(lang))
    const fixture = TestBed.createComponent(DemoBannerComponent)
    fixture.detectChanges()

    const link = hostOf(fixture).querySelector<HTMLAnchorElement>("a[data-action=contact]")

    expect(link?.href).toBe(url)
    expect(link?.rel).toBe("noopener noreferrer")
    expect(link?.target).toBe("_blank")
  })
})
