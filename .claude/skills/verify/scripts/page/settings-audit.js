// Audit d'harmonisation des quatre sections des Reglages sous `ng serve`, FR puis EN a 1024 x 700, sidecar
// simule : releve (sans verdict) tailles de texte, alignement libelle / controle, aide, boutons (taille,
// severite, icone), hauteurs des controles, bords gauche et droit, curseurs de souris, tooltips des
// boutons grises et anneau de focus clavier de chaque arret de Tab. Les ecarts se lisent dans `measures`,
// contre docs/DESIGN.md ; `failures` ne garde que les regles chiffrees sans ambiguite. Lance par
// `run_page.mjs`, `just dev-ui` servant :4200 ; `SHOTS_DIR` designe le dossier des captures.
async (page) => {
  const failures = []
  const measures = {}
  const shots = process.env.SHOTS_DIR ?? ".playwright-mcp/verify-settings-audit"
  const check = (ok, message) => {
    if (!ok) failures.push(message)
  }
  const browser = page.context().browser()

  for (const [language, tag] of [["fr", "fr-FR"], ["en", "en-US"]]) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 700 } })
    const p = await context.newPage()
    await p.addInitScript((value) => {
      Object.defineProperty(Navigator.prototype, "language", { get: () => value, configurable: true })
    }, tag)
    await p.goto("http://localhost:4200/settings")
    await p.waitForFunction(() => typeof ng !== "undefined" && document.querySelector("app-root")?.children.length > 0)
    await p.bringToFront()
    await p.evaluate(() => {
      const root = ng.getInjector(document.querySelector("app-root"))
      for (const injector of ng["ɵgetInjectorResolutionPath"](root)) {
        let providers
        try {
          providers = ng["ɵgetInjectorProviders"](injector)
        } catch {
          continue
        }
        for (const record of Object.values(providers)) {
          const provided = Object.values(record).find((v) => typeof v === "function" && /SidecarService$/.test(v.name))
          if (provided) window.__svc = injector.get(provided)
        }
        if (window.__svc) break
      }
      window.__svc._available.set(true)
      window.__svc.send = async () => undefined
      const mk = (version) => JSON.stringify({ event: "version", version, api_key_configured: true, default_thresholds: { floor: 70, ceiling: 90 }, log_file: "C:/Users/Jane Doe/logs/tagger.log" })
      window.__svc.handleLine(mk("0.0.0-probe"))
      window.__svc.handleLine(mk(window.__svc.versionMismatch().ui))
      window.__svc.handleLine(JSON.stringify({ event: "cache_size", size_bytes: 3_200_000 }))
      window.__svc.handleLine(JSON.stringify({ event: "rollback_target", run: { run_id: "a3f9c1", written_at: "2026-10-06T14:30:00Z", folder: "D:\\Music\\Promo Octobre", tracks: 87 } }))
    })
    await p.waitForSelector("app-settings-page p-menu .p-menu-item")
    const out = {}
    measures[language] = out

    for (const [index, name] of ["api", "matching", "interface", "admin"].entries()) {
      await p.locator("app-settings-page p-menu .p-menu-item-content").nth(index).click()
      await p.waitForTimeout(500)
      await p.mouse.move(2, 2)
      out[name] = await p.evaluate(() => {
        const n = (x) => Math.round(x * 10) / 10
        const host = document.querySelector("app-settings-page")
        const section = host.querySelector("section")
        const s = section.getBoundingClientRect()
        const text = getComputedStyle(document.body).color
        const probe = document.createElement("span")
        probe.className = "text-muted-color"
        document.body.append(probe)
        const muted = getComputedStyle(probe).color
        probe.remove()
        const h2 = section.querySelector("h2")
        const describe = (el) => {
          const r = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          const kind = el.tagName.toLowerCase()
          return {
            kind: kind + (el.getAttribute("data-action") ? `[${el.getAttribute("data-action")}]` : el.getAttribute("data-field") ? `[${el.getAttribute("data-field")}]` : ""),
            text: kind === "button" ? el.textContent.replace(/[ \t\r\n]+/g, " ").trim() : undefined,
            classes: kind === "button" ? [...el.classList].filter((c) => /^p-button-/.test(c)).join(" ") : undefined,
            disabled: el.disabled === true || el.classList.contains("p-disabled") || undefined,
            h: n(r.height),
            w: n(r.width),
            left: n(r.left),
            right: n(r.right),
            font: style.fontSize,
            cursor: style.cursor,
            // Ce que la souris trouve au centre de l'element : le curseur vu par l'utilisateur
            hit: (() => {
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
              return hit ? { tag: hit.tagName.toLowerCase(), cls: String(hit.className).slice(0, 30), cursor: getComputedStyle(hit).cursor } : null
            })(),
            icon: el.querySelector("svg") ? { name: el.querySelector("svg").getAttribute("data-p-icon"), size: n(el.querySelector("svg").getBoundingClientRect().width) } : undefined,
          }
        }
        const rows = [...host.querySelectorAll("app-settings-row")].map((row) => {
          const label = row.querySelector("[rowLabel]")
          const control = row.querySelector("[rowControl]")
          // Colonne d'actions (Administration) : c'est elle, et non le controle, qui touche le bord droit.
          const action = row.querySelector("[rowAction]")
          const extra = row.querySelector(":scope > div.col-start-2")
          // Classe utilitaire `hint` (src/styles.css) : le style se mesure ensuite sur l'element, pas sur ses classes.
          const hint = row.querySelector(".hint")
          const l = label.getBoundingClientRect()
          const c = control.getBoundingClientRect()
          const first = control.querySelector("button, input, p-select, p-slider, p-toggleswitch")?.getBoundingClientRect()
          const ls = getComputedStyle(label)
          const elements = [...control.querySelectorAll("button, p-select, p-slider, p-inputnumber input, p-toggleswitch, input")].filter((e) => !e.closest("p-select") || e.tagName === "P-SELECT").map(describe)
          return {
            label: label.textContent.trim(),
            labelTag: label.tagName.toLowerCase(),
            labelFont: ls.fontSize,
            labelWeight: ls.fontWeight,
            labelColorIsText: ls.color === text,
            labelCenterMinusControlCenter: n(l.top + l.height / 2 - (c.top + c.height / 2)),
            labelCenterMinusFirstControlCenter: first ? n(l.top + l.height / 2 - (first.top + first.height / 2)) : null,
            controlLeft: n(c.left),
            controlRight: n(c.right),
            // Le controle s'arrete au bord interieur de la section (son padding), pas a son bord.
            controlRightToSection: n(s.right - parseFloat(getComputedStyle(section).paddingRight) - c.right),
            actionRightToSection: action ? n(s.right - parseFloat(getComputedStyle(section).paddingRight) - action.getBoundingClientRect().right) : null,
            hint: hint ? { font: getComputedStyle(hint).fontSize, mutedColor: getComputedStyle(hint).color === muted, whiteSpace: getComputedStyle(hint).whiteSpace, left: n(hint.getBoundingClientRect().left) } : null,
            hintBelowControl: hint && extra && extra.contains(hint) ? n(hint.getBoundingClientRect().top - c.bottom) : null,
            extraGap: extra && extra.getBoundingClientRect().height > 0 ? getComputedStyle(extra).rowGap : null,
            elements,
          }
        })
        return {
          h2: { text: h2.textContent.trim(), font: getComputedStyle(h2).fontSize, weight: getComputedStyle(h2).fontWeight, left: n(h2.getBoundingClientRect().left) },
          sectionLeft: n(s.left),
          sectionRight: n(s.right),
          sectionPadding: getComputedStyle(section).padding,
          rows,
          loose: [...section.querySelectorAll("button")].filter((b) => !b.closest("app-settings-row")).map(describe),
          menuCursor: getComputedStyle(host.querySelector(".p-menu-item-link")).cursor,
        }
      })
      await p.screenshot({ path: `${shots}/${language}-${name}.png` })

      // Focus clavier : chaque arret de Tab depuis le menu, anneau lu sur l'element et ses deux premiers ancetres
      if (language === "fr") {
        await p.locator("app-settings-page p-menu .p-menu-item-link").nth(index).focus()
        const stops = []
        for (let i = 0; i < 9; i += 1) {
          await p.keyboard.press("Tab")
          await p.waitForTimeout(260)
          const stop = await p.evaluate(() => {
            const el = document.activeElement
            if (!el || !el.closest("app-settings-page")) return { outside: el?.tagName ?? null }
            const ring = (e) => {
              const st = getComputedStyle(e)
              return { outline: st.outlineStyle === "none" ? "none" : `${st.outlineWidth} ${st.outlineStyle} ${st.outlineColor}`, shadow: st.boxShadow === "none" ? "none" : st.boxShadow, border: st.borderTopColor }
            }
            // Le frere suivant porte l'anneau de la bascule (`input:focus-visible + slider`)
            const chain = [el, el.parentElement, el.parentElement?.parentElement, el.nextElementSibling].filter(Boolean)
            return {
              tag: el.tagName.toLowerCase(),
              id: el.id || el.getAttribute("data-action") || el.getAttribute("aria-labelledby") || el.className.toString().slice(0, 40),
              visible: el.matches(":focus-visible"),
              ring: chain.map(ring),
            }
          })
          stops.push(stop)
          if (stop.outside !== undefined) break
        }
        out[name].focusStops = stops
      }
    }
    out.cursorChecks = await p.evaluate(() => ({ body: getComputedStyle(document.body).cursor }))
    await context.close()
  }

  // Regles chiffrees sans ambiguite
  for (const language of ["fr", "en"]) {
    const m = measures[language]
    for (const name of ["api", "matching", "interface", "admin"]) {
      const s = m[name]
      check(s.h2.font === "18px" && s.h2.weight === "600", `${language} ${name} : h2 ${s.h2.font}/${s.h2.weight}`)
      check(s.sectionPadding === "24px", `${language} ${name} : padding de la section ${s.sectionPadding}`)
      for (const row of s.rows) {
        check(row.hint !== null, `${language} ${name} ${row.label} : aucune aide (classe hint) dans la rangee`)
        check(row.labelFont === "14px" && row.labelWeight === "400" && row.labelColorIsText, `${language} ${name} ${row.label} : libelle ${row.labelFont}/${row.labelWeight}/texte=${row.labelColorIsText}`)
        check(row.controlLeft === m.api.rows[0].controlLeft, `${language} ${name} ${row.label} : controle a ${row.controlLeft}`)
        check(Math.abs(row.actionRightToSection ?? row.controlRightToSection) < 0.6, `${language} ${name} ${row.label} : ${row.actionRightToSection === null ? "controle" : "action"} a ${row.actionRightToSection ?? row.controlRightToSection}px du bord droit`)
        if (row.hint) {
          check(row.hint.font === "12px" && row.hint.mutedColor && row.hint.whiteSpace === "pre-line", `${language} ${name} ${row.label} : aide ${JSON.stringify(row.hint)}`)
        }
        for (const e of row.elements.filter((x) => x.kind.startsWith("button"))) {
          check(/p-button-sm/.test(e.classes), `${language} ${name} ${row.label} : bouton ${e.text} sans size small`)
          check(e.cursor === "default" || e.cursor === "pointer" || e.cursor === "auto", `${language} ${name} ${e.text} : curseur ${e.cursor}`)
        }
      }
    }
  }
  return { failures, measures }
}
