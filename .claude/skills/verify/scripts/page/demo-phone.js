// Demo web sur telephone, sous `just dev-demo` : un contexte mobile par cas (viewport meta
// respecte, ecran tactile), plus un ecran de bureau en portrait. Le shell s'arrete a 800px de
// haut sur un ecran tactile en portrait (`demo-portrait`, DESIGN.md § Layout), jamais ailleurs.
// Captures dans SHOTS_DIR si pose.
async (page) => {
  const out = { checks: {}, failures: [], measures: {} }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const shots = process.env.SHOTS_DIR
  const browser = page.context().browser()
  const CASES = [
    ["phone-portrait", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }],
    ["phone-landscape", { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }],
    ["desktop-portrait", { viewport: { width: 900, height: 1200 } }],
  ]
  for (const [name, options] of CASES) {
    const context = await browser.newContext(options)
    const tab = await context.newPage()
    await tab.goto("http://localhost:4200/")
    await tab.waitForFunction(() => document.querySelector("app-root")?.children.length > 0)
    await tab.waitForTimeout(1500)
    out.measures[name] = await tab.evaluate(() => {
      const root = document.querySelector("app-root").getBoundingClientRect()
      return {
        layout: [document.documentElement.clientWidth, window.innerHeight],
        shell: [Math.round(root.width), Math.round(root.height)],
        capped: document.querySelector("app-root").classList.contains("demo-portrait"),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        pageScrolls: document.documentElement.scrollHeight > window.innerHeight,
      }
    })
    if (shots) await tab.screenshot({ path: `${shots}/demo-${name}.png` })
    await context.close()
  }
  const { "phone-portrait": portrait, "phone-landscape": landscape, "desktop-portrait": desktop } = out.measures
  check("phone portrait: layout 1280 wide, far taller than 800", portrait.layout[0] === 1280 && portrait.layout[1] > 2000, portrait.layout)
  check("phone portrait: shell 1280 x 800", portrait.shell[0] === 1280 && portrait.shell[1] === 800, portrait.shell)
  check("phone landscape: shell fills the height", landscape.shell[1] === landscape.layout[1] || landscape.shell[1] === landscape.layout[1] - 1, landscape)
  check("desktop portrait: shell fills the height, no cap", desktop.shell[1] === desktop.layout[1], desktop)
  check("demo-portrait class on the demo shell", portrait.capped && landscape.capped && desktop.capped, [portrait.capped, landscape.capped, desktop.capped])
  check("body background under the shell is the app surface", /^color\(srgb 0\.035|^rgb\(9, 9, 11\)/.test(portrait.bodyBg), portrait.bodyBg)
  check("no page scroll", !portrait.pageScrolls && !landscape.pageScrolls && !desktop.pageScrolls, [portrait.pageScrolls, landscape.pageScrolls, desktop.pageScrolls])
  return out
}
