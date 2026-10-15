// Section Matching des Reglages sous `ng serve`, sidecar simule sur l'instance du service, FR puis EN
// a 1024 x 700 (plancher) : rangees grisees avant `version`, defauts apres, mise en page mesuree,
// gestes a la souris et au clavier reels de Playwright, bornes croisees, champ vide. Le store Tauri
// est indisponible sous `ng serve` : un reglage s'applique a la page sans etre retenu, ce que la
// sonde relit par le bouton « Valeurs par defaut ». La persistance et `start_tagging` se prouvent
// dans la fenetre (`page/settings-matching.js`). Lance par `run_page.mjs`, `just dev-ui` servant :4200 ;
// `SHOTS_DIR` designe le dossier des captures (scratchpad).
async (page) => {
  const failures = []
  const measures = {}
  const shots = process.env.SHOTS_DIR ?? ".playwright-mcp/verify-matching"
  const check = (ok, message) => {
    if (!ok) failures.push(message)
  }
  await page.setViewportSize({ width: 1024, height: 700 })

  // Lit les deux rangees et le bouton : valeurs affichees, etat des controles, aide.
  const read = async () => {
    // Zoneless : le rendu suit l'evenement d'un tick
    await page.waitForTimeout(150)
    return page.evaluate(() => {
      const host = document.querySelector("app-settings-page")
      const rows = [...host.querySelectorAll("app-settings-row")].map((row) => {
        const slider = row.querySelector("p-slider")
        const handle = row.querySelector(".p-slider-handle input")
        const input = row.querySelector("p-inputnumber input")
        return {
          label: row.querySelector("[rowLabel]").textContent.trim(),
          slider: Number(handle?.getAttribute("aria-valuenow")),
          sliderMin: Number(handle?.getAttribute("aria-valuemin")),
          sliderMax: Number(handle?.getAttribute("aria-valuemax")),
          sliderDisabled: slider?.classList.contains("p-disabled"),
          input: input?.value,
          inputDisabled: input?.disabled,
        }
      })
      const button = host.querySelector('[data-action="reset-thresholds"]')
      // Le modele que le composant tient (build de dev), pour le comparer a ce que les champs montrent
      const component = ng.getComponent(host)
      return { rows, resetDisabled: button?.disabled ?? null, model: component.thresholdsChoice(), stored: component.storedThresholds() }
    })
  }

  for (const [language, tag] of [
    ["fr", "fr-FR"],
    ["en", "en-US"],
  ]) {
    await page.addInitScript((value) => {
      Object.defineProperty(Navigator.prototype, "language", { get: () => value, configurable: true })
    }, tag)
    await page.goto("http://localhost:4200/settings")
    await page.waitForFunction(() => typeof ng !== "undefined" && document.querySelector("app-root")?.children.length > 0)
    // Sidecar disponible mais muet : aucun `version`, donc aucun defaut connu
    await page.evaluate(() => {
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
      window.__sent = []
      window.__svc._available.set(true)
      window.__svc.send = async (command) => {
        window.__sent.push(command)
      }
    })
    const out = { language }
    const hasMenu = await page.waitForSelector("app-settings-page p-menu .p-menu-item", { timeout: 5000 }).then(
      () => true,
      () => false,
    )
    out.menuBeforeVersion = hasMenu
    if (hasMenu) {
      await page.locator("app-settings-page p-menu .p-menu-item-content").nth(1).click()
      await page.waitForTimeout(300)
      out.beforeVersion = await read()
      check(
        out.beforeVersion.rows.every((row) => row.sliderDisabled && row.inputDisabled),
        `${language} avant version : rangees non grisees ${JSON.stringify(out.beforeVersion.rows)}`,
      )
      await page.screenshot({ path: `${shots}/matching-${language}-0-before-version.png` })
    } else {
      failures.push(`${language} avant version : pas de menu (ecran bloquant ?)`)
    }

    // `version` arrive : defauts du moteur ; l'interface lit sa propre version pour ne pas etre bloquee
    await page.evaluate(() => {
      const line = (version) =>
        JSON.stringify({
          event: "version",
          version,
          api_key_configured: true,
          default_thresholds: { floor: 70, ceiling: 90 },
          log_file: "C:/Users/Jane Doe/logs/tagger.log",
        })
      window.__svc.handleLine(line("0.0.0-probe"))
      window.__svc.handleLine(line(window.__svc.versionMismatch().ui))
    })
    await page.waitForSelector("app-settings-page p-menu .p-menu-item")
    const menu = await page.locator("app-settings-page p-menu .p-menu-item-content")
    out.menu = await page.evaluate(() =>
      [...document.querySelectorAll("app-settings-page .p-menu-item-label")].map((label) => label.textContent.trim()),
    )
    check(
      out.menu.join() === (language === "fr" ? "API,Matching,Interface,Administration" : "API,Matching,Interface,Administration"),
      `${language} menu : ${out.menu}`,
    )
    await menu.nth(1).click()
    await page.waitForTimeout(300)
    await page.waitForFunction(() => document.querySelector('app-settings-page [data-field="floor"]'))
    out.defaults = await read()
    check(
      out.defaults.rows.map((row) => `${row.slider}/${row.input}`).join() === "70/70,90/90",
      `${language} defauts : ${JSON.stringify(out.defaults.rows)}`,
    )
    check(out.defaults.rows.every((row) => !row.sliderDisabled && !row.inputDisabled), `${language} defauts : rangees grisees`)
    check(out.defaults.resetDisabled === true, `${language} defauts : « Valeurs par defaut » actif sans reglage`)

    // Champ vide puis blur sur les defauts, avant tout autre geste (aucun reglage enregistre)
    {
      const first = page.locator("p-inputnumber input").nth(0)
      await first.click()
      await page.keyboard.press("Control+A")
      await page.keyboard.press("Backspace")
      // Une frappe puis le blur separes d'un geste humain : en dessous de ~50ms (Tab dans la meme tick que
      // la suppression), le champ reste vide alors que le modele et le curseur sont restaures
      await page.waitForTimeout(150)
      await page.keyboard.press("Tab")
      out.coldEmpty = await read()
      out.coldEmpty.shown = await first.inputValue()
      check(
        out.coldEmpty.shown === "70" && out.coldEmpty.model.floor === 70 && out.coldEmpty.stored === null,
        `${language} champ vide sur les defauts : affiche « ${out.coldEmpty.shown} », modele ${JSON.stringify(out.coldEmpty.model)}, enregistre ${JSON.stringify(out.coldEmpty.stored)}`,
      )
    }

    // Observation, pas un controle : blur dans la meme tick que la suppression (geste de script)
    {
      const first = page.locator("p-inputnumber input").nth(0)
      await first.click()
      await page.keyboard.press("Control+A")
      await page.keyboard.press("Backspace")
      await page.keyboard.press("Tab")
      out.fastBlurEmpty = await read()
      out.fastBlurEmpty.shown = await first.inputValue()
      // Remet le champ d'aplomb pour la suite : saisie puis blur a vitesse humaine
      await first.click()
      await page.keyboard.press("Control+A")
      await page.keyboard.type("70")
      await page.waitForTimeout(150)
      await page.keyboard.press("Tab")
      await page.waitForTimeout(150)
    }

    // Mise en page
    out.layout = await page.evaluate(() => {
      const host = document.querySelector("app-settings-page")
      const section = host.querySelector("section")
      const px = (value) => Math.round(value * 10) / 10
      const rect = (element) => element.getBoundingClientRect()
      const rows = [...host.querySelectorAll("app-settings-row")]
      const canvas = document.createElement("canvas").getContext("2d")
      const info = rows.map((row) => {
        const label = row.querySelector("[rowLabel]")
        const control = row.querySelector("[rowControl]")
        const slider = row.querySelector("p-slider")
        const number = row.querySelector("p-inputnumber")
        const input = number.querySelector("input")
        const hint = row.querySelector(".text-xs")
        const style = getComputedStyle(input)
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const hintStyle = getComputedStyle(hint)
        const hintLines = hint.innerText.split("\n")
        return {
          label: label.textContent.trim(),
          labelFont: getComputedStyle(label).fontSize,
          labelColor: getComputedStyle(label).color,
          rowPadding: [getComputedStyle(row).paddingTop, getComputedStyle(row).paddingBottom],
          rowColumns: getComputedStyle(row).gridTemplateColumns,
          columnGap: getComputedStyle(row).columnGap,
          rowBorder: getComputedStyle(row).borderBottomWidth,
          controlGap: getComputedStyle(control).columnGap,
          sliderToInput: px(rect(number).left - rect(slider).right),
          sliderWidth: px(rect(slider).width),
          inputHostWidth: px(rect(number).width),
          inputWidth: px(rect(input).width),
          inputClip: input.scrollWidth > input.clientWidth,
          // Largeur du texte « 100 » face a l'espace interieur du champ
          text100: px(canvas.measureText("100").width),
          innerWidth: px(input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
          tabular: style.fontVariantNumeric,
          inputFont: style.fontSize,
          inputHeight: px(rect(input).height),
          hintFont: hintStyle.fontSize,
          hintColor: hintStyle.color,
          hintWhiteSpace: hintStyle.whiteSpace,
          hintLines,
          hintBelowControl: px(rect(hint).top - rect(control).bottom),
          hintLeftMinusControlLeft: px(rect(hint).left - rect(control).left),
          labelCol: px(rect(label).width),
          labelLeft: px(rect(label).left - rect(row).left),
          controlLeft: px(rect(control).left - rect(row).left),
          rowRight: px(rect(row).right),
          controlRight: px(rect(control).right),
          rowHeight: px(rect(row).height),
        }
      })
      // Curseur et champ face au code de la maquette (fiches Slider et InputNumber) : poignee 16px pleine
      // `primary` cerclee de 2px `surface-950`, piste de 3px `surface-800`, hauteur 20px ; champ de 4.5rem avec
      // fleches, en `text-base`
      const sliderOf = (field) => {
        const root = host.querySelector(`p-slider[data-field="${field}"]`)
        const handleBox = root.querySelector(".p-slider-handle")
        const trackBox = root.querySelector(".p-slider-track")
        const rangeBox = root.querySelector(".p-slider-range")
        const handleStyle = getComputedStyle(handleBox)
        const trackStyle = getComputedStyle(trackBox)
        return {
          rootHeight: px(rect(root).height),
          trackHeight: px(rect(trackBox).height),
          trackBackground: trackStyle.backgroundColor,
          trackRadius: trackStyle.borderRadius,
          rangeBackground: getComputedStyle(rangeBox).backgroundColor,
          handle: [px(rect(handleBox).width), px(rect(handleBox).height)],
          handleBackground: handleStyle.backgroundColor,
          handleBorder: `${handleStyle.borderTopWidth} ${handleStyle.borderTopStyle} ${handleStyle.borderTopColor}`,
        }
      }
      const numberOf = (index) => {
        const input = host.querySelectorAll("p-inputnumber")[index]
        const field = input.querySelector("input")
        const style = getComputedStyle(field)
        return {
          buttons: input.querySelectorAll("button").length,
          fontSize: style.fontSize,
          padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
          radius: style.borderRadius,
          border: style.borderTopColor,
          background: style.backgroundColor,
          height: px(rect(field).height),
        }
      }
      const widgets = { floorSlider: sliderOf("floor"), ceilingSlider: sliderOf("ceiling"), floorNumber: numberOf(0), ceilingNumber: numberOf(1) }
      const button = host.querySelector('[data-action="reset-thresholds"]')
      const wrapper = button.parentElement
      const lastRow = rows[rows.length - 1]
      const main = document.querySelector("main")
      const mutedProbe = document.createElement("span")
      mutedProbe.className = "text-muted-color"
      document.body.append(mutedProbe)
      const muted = getComputedStyle(mutedProbe).color
      mutedProbe.remove()
      return {
        h2: section.querySelector("h2").textContent.trim(),
        h2Font: getComputedStyle(section.querySelector("h2")).fontSize,
        sectionGap: getComputedStyle(section).rowGap,
        mutedColor: muted,
        rows: info,
        widgets,
        button: {
          text: button.textContent.trim(),
          classes: [...button.classList].filter((c) => /^p-button/.test(c)).join(" "),
          disabled: button.disabled,
          justify: getComputedStyle(wrapper).justifyContent,
          rightEdgeToSection: px(rect(section).right - rect(button).right),
          gapAfterLastRow: px(rect(wrapper).top - rect(lastRow).bottom),
          height: px(rect(button).height),
          font: getComputedStyle(button).fontSize,
        },
        scroll: {
          page: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
          main: main.scrollHeight > main.clientHeight,
          bottomRoom: px(main.getBoundingClientRect().bottom - rect(wrapper).bottom),
          section: section.scrollHeight > section.clientHeight,
        },
        text: section.innerText,
      }
    })
    const layout = out.layout
    for (const row of layout.rows) {
      check(row.rowColumns.startsWith("256px"), `${language} ${row.label} : colonne de gauche ${row.rowColumns}`)
      check(row.controlGap === "16px", `${language} ${row.label} : ecart curseur / champ ${row.controlGap}`)
      check(row.sliderToInput === 16, `${language} ${row.label} : curseur a ${row.sliderToInput}px du champ`)
      check(row.inputHostWidth === 64, `${language} ${row.label} : champ a ${row.inputHostWidth}px`)
      check(!row.inputClip && row.text100 <= row.innerWidth, `${language} ${row.label} : « 100 » coupe (${row.text100} > ${row.innerWidth})`)
      check(/tabular-nums/.test(row.tabular), `${language} ${row.label} : chiffres ${row.tabular}`)
      check(row.hintFont === "12px", `${language} ${row.label} : aide ${row.hintFont}`)
      check(row.hintColor === layout.mutedColor, `${language} ${row.label} : aide ${row.hintColor} au lieu de ${layout.mutedColor}`)
      check(row.hintWhiteSpace === "pre-line", `${language} ${row.label} : aide en ${row.hintWhiteSpace}`)
      check(row.hintLeftMinusControlLeft === 0 && row.hintBelowControl > 0, `${language} ${row.label} : aide mal placee ${row.hintBelowControl}/${row.hintLeftMinusControlLeft}`)
      check(row.labelFont === "14px", `${language} ${row.label} : libelle ${row.labelFont}`)
    }
    check(layout.rows[0].hintLines.length === 2, `${language} aide du plancher : ${layout.rows[0].hintLines.length} lignes`)
    check(layout.rows[1].hintLines.length === 3, `${language} aide du seuil haut : ${layout.rows[1].hintLines.length} lignes`)
    check(!/zone grise|gray zone|grey zone/i.test(layout.text), `${language} « zone grise » affichee`)
    check(
      layout.button.classes.includes("p-button-sm") &&
        layout.button.classes.includes("p-button-outlined") &&
        layout.button.classes.includes("p-button-secondary"),
      `${language} bouton : ${layout.button.classes}`,
    )
    check(layout.button.justify === "flex-end" && layout.button.rightEdgeToSection === 0, `${language} bouton non cale a droite`)
    check(!layout.scroll.page && !layout.scroll.main && !layout.scroll.section, `${language} defilement ${JSON.stringify(layout.scroll)}`)
    await page.screenshot({ path: `${shots}/matching-${language}-1-defaults.png` })

    // Tooltip du bouton grise : sous l'element, apres le delai
    const resetBox = await page.locator('[data-action="reset-thresholds"]').boundingBox()
    await page.mouse.move(resetBox.x + resetBox.width / 2, resetBox.y + resetBox.height / 2)
    await page.waitForSelector(".p-tooltip", { timeout: 3000 }).catch(() => undefined)
    out.tooltip = await page.evaluate(() => {
      const tip = document.querySelector(".p-tooltip")
      const button = document.querySelector('[data-action="reset-thresholds"]').getBoundingClientRect()
      if (!tip) return null
      const r = tip.getBoundingClientRect()
      return {
        text: tip.textContent.trim(),
        below: Math.round(r.top - button.bottom),
        centerOffset: Math.round(r.left + r.width / 2 - (button.left + button.width / 2)),
      }
    })
    check(out.tooltip !== null && out.tooltip.below >= 0, `${language} tooltip : ${JSON.stringify(out.tooltip)}`)
    await page.screenshot({ path: `${shots}/matching-${language}-2-tooltip.png` })
    await page.mouse.move(5, 5)

    // Gestes. Curseur du seuil haut : glisse la poignee a la souris vers 95 (plage plancher..100)
    const handle = page.locator('p-slider[data-field="ceiling"] .p-slider-handle')
    const track = page.locator('p-slider[data-field="ceiling"] .p-slider-track')
    const h = await handle.boundingBox()
    const t = await track.boundingBox()
    // 90 sur la plage 70..100
    const xAt = (value) => t.x + ((value - 70) / 30) * t.width
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(xAt(95), h.y + h.height / 2, { steps: 8 })
    await page.mouse.up()
    out.afterDrag = await read()
    // La souris pose la valeur a l'unite pres : on ajuste aux fleches si le pixel tombe a cote
    let value = out.afterDrag.rows[1].slider
    out.dragLanded = value
    const arrows = []
    while (value !== 95 && arrows.length < 6) {
      const key = value < 95 ? "ArrowRight" : "ArrowLeft"
      await page.keyboard.press(key)
      arrows.push(key)
      value += key === "ArrowRight" ? 1 : -1
    }
    out.arrows = arrows
    await page.keyboard.press("Tab")
    await page.waitForTimeout(200)
    out.ceiling95 = await read()
    check(out.ceiling95.rows[1].slider === 95 && out.ceiling95.rows[1].input === "95", `${language} seuil haut 95 : ${JSON.stringify(out.ceiling95.rows[1])}`)
    check(out.ceiling95.rows[0].slider === 70, `${language} plancher bouge avec le seuil haut : ${out.ceiling95.rows[0].slider}`)
    check(out.ceiling95.resetDisabled === false, `${language} reglage pose : « Valeurs par defaut » reste grise`)
    await page.screenshot({ path: `${shots}/matching-${language}-3-ceiling95.png` })

    // Bornes croisees, curseur : plancher pousse a la souris au-dela du seuil haut
    const floorHandle = page.locator('p-slider[data-field="floor"] .p-slider-handle')
    const floorTrack = page.locator('p-slider[data-field="floor"] .p-slider-track')
    const fh = await floorHandle.boundingBox()
    const ft = await floorTrack.boundingBox()
    await page.mouse.move(fh.x + fh.width / 2, fh.y + fh.height / 2)
    await page.mouse.down()
    await page.mouse.move(ft.x + ft.width + 60, fh.y + fh.height / 2, { steps: 10 })
    await page.mouse.up()
    out.floorPushed = await read()
    check(
      out.floorPushed.rows[0].slider === 95 && out.floorPushed.rows[0].input === "95",
      `${language} plancher pousse au-dela : ${JSON.stringify(out.floorPushed.rows[0])}`,
    )
    check(out.floorPushed.rows[0].sliderMax === 95, `${language} max du plancher ${out.floorPushed.rows[0].sliderMax}`)
    check(out.floorPushed.rows[1].sliderMin === 95, `${language} min du seuil haut ${out.floorPushed.rows[1].sliderMin}`)
    await page.screenshot({ path: `${shots}/matching-${language}-4-floor-pushed.png` })

    // Bornes croisees, champ : 99 dans le plancher, 10 dans le seuil haut
    const floorInput = page.locator('p-inputnumber input').nth(0)
    const ceilingInput = page.locator('p-inputnumber input').nth(1)
    await floorInput.click()
    await floorInput.fill("99")
    await page.keyboard.press("Tab")
    await page.waitForTimeout(150)
    out.floorField99 = await read()
    check(out.floorField99.rows[0].input === "95", `${language} champ plancher 99 : ${out.floorField99.rows[0].input}`)
    await ceilingInput.click()
    await ceilingInput.fill("10")
    await page.keyboard.press("Tab")
    await page.waitForTimeout(150)
    out.ceilingField10 = await read()
    check(out.ceilingField10.rows[1].input === "95", `${language} champ seuil haut 10 : ${out.ceilingField10.rows[1].input}`)

    // Champ vide puis blur, au clavier : valeurs affichees restaurees, rien d'invalide retenu
    await floorInput.click()
    await page.keyboard.press("Control+A")
    await page.keyboard.press("Backspace")
    out.emptyDuring = await floorInput.inputValue()
    await page.waitForTimeout(150)
    await page.keyboard.press("Tab")
    out.emptyAfter = await read()
    out.emptyAfter.shown = await floorInput.inputValue()
    check(out.emptyDuring === "", `${language} champ vide : saisie non videe (${out.emptyDuring})`)
    check(
      out.emptyAfter.model.floor === 95 && out.emptyAfter.rows[0].slider === 95,
      `${language} champ vide : modele ${JSON.stringify(out.emptyAfter.model)}`,
    )
    check(
      out.emptyAfter.shown === "95",
      `${language} champ vide puis blur : le champ affiche « ${out.emptyAfter.shown} » alors que le modele et le curseur valent ${out.emptyAfter.model.floor}`,
    )

    // Retour aux defauts
    await page.locator('[data-action="reset-thresholds"]').click()
    await page.waitForTimeout(200)
    out.afterReset = await read()
    check(
      out.afterReset.rows.map((row) => `${row.slider}/${row.input}`).join() === "70/70,90/90" && out.afterReset.resetDisabled === true,
      `${language} apres retour aux defauts : ${JSON.stringify(out.afterReset)}`,
    )

    // Defauts retapes a la main : le bouton se grise de lui-meme (le reglage vaut `null`)
    await ceilingInput.click()
    await ceilingInput.fill("95")
    await page.keyboard.press("Tab")
    await page.waitForTimeout(150)
    out.customAgain = await read()
    await ceilingInput.click()
    await ceilingInput.fill("90")
    await page.keyboard.press("Tab")
    await page.waitForTimeout(150)
    out.backToDefaults = await read()
    check(out.customAgain.resetDisabled === false, `${language} 95 retape : bouton reste grise`)
    check(
      out.backToDefaults.resetDisabled === true && out.backToDefaults.rows[1].input === "90",
      `${language} defauts retapes : ${JSON.stringify(out.backToDefaults)}`,
    )

    // Plancher : plusieurs unites a la fleche, une seule ecriture en fin de geste ; le seuil haut
    // suit la borne
    await page.locator('p-slider[data-field="floor"] .p-slider-handle input').focus()
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight")
    out.floorArrows = await read()
    check(out.floorArrows.rows[0].slider === 75, `${language} plancher 5 crans : ${out.floorArrows.rows[0].slider}`)
    check(out.floorArrows.rows[1].sliderMin === 75, `${language} min du seuil haut apres plancher 75 : ${out.floorArrows.rows[1].sliderMin}`)
    await page.keyboard.press("Tab")
    await page.waitForTimeout(200)
    out.floorBlurred = await read()
    check(out.floorBlurred.resetDisabled === false, `${language} plancher 75 apres blur : bouton grise`)

    out.commandsSent = await page.evaluate(() => window.__sent.map((command) => command.command))
    measures[language] = out
  }
  return { failures, measures }
}
