// Section Matching des Reglages dans la fenetre Tauri : persistance reelle (store), gestes reels par
// `cdp.mjs --click` / `--press` / `--move` / `--release` / `--key` / `--type` aux coordonnees rendues
// ici, et commande `start_tagging` reelle. Jamais la methode du composant : c'est l'evenement du
// controle (curseur relache, champ perdu de focus) qui enregistre.
//   node cdp.mjs page/settings-matching.js open              onglet Reglages
//   node cdp.mjs page/settings-matching.js menu              centre de l'entree Matching et ordre du menu
//   node cdp.mjs page/settings-matching.js state             valeurs affichees, etat des controles, modele du composant, defauts du moteur
//   node cdp.mjs page/settings-matching.js x <champ> <n>     centre de la poignee de `floor` ou `ceiling` et abscisse de la valeur n sur sa piste
//   node cdp.mjs page/settings-matching.js field <champ>     centre du champ numerique
//   node cdp.mjs page/settings-matching.js reset             centre de « Valeurs par defaut », et son etat
//   node cdp.mjs page/settings-matching.js tooltip           tooltip ouvert (texte, position sous le bouton)
//   node cdp.mjs page/settings-matching.js store             `thresholds` du `preferences.json` reel (`absent` sans reglage)
//   node cdp.mjs page/settings-matching.js layout            mesures de mise en page (WebView2), a prendre avec --viewport 1024 700
//   node cdp.mjs page/settings-matching.js spy               releve les commandes sortantes du service (survit jusqu'au rechargement)
//   node cdp.mjs page/settings-matching.js sent              commandes relevees
//   node cdp.mjs page/settings-matching.js tagging <dossier> onglet Tagging, dossier pose, centre du bouton d'action
//   node cdp.mjs page/settings-matching.js run-state         etat du run (phase, lignes), apres `--click` sur le bouton
;(async () => {
  const [action, ...rest] = __args
  const px = (value) => Math.round(value * 10) / 10
  const center = (element) => {
    const r = element.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }
  const page = () => document.querySelector("app-settings-page")
  const slider = (field) => page().querySelector(`p-slider[data-field="${field}"]`)
  const resetButton = () => page().querySelector('[data-action="reset-thresholds"]')
  const numberInput = (field) => page().querySelectorAll("p-inputnumber input")[field === "floor" ? 0 : 1]

  if (action === "open") {
    const tabs = [...document.querySelectorAll("p-tab")]
    tabs[tabs.length - 1].click()
    await until(() => page() !== null, 5000)
    await wait(400)
    // Le menu est la cible du clic ; le geste reel se fait par `menu` puis `--click`
    return { url: location.pathname, h1: document.querySelector("main h1")?.textContent?.trim() }
  }

  if (action === "menu") {
    const items = [...page().querySelectorAll("p-menu .p-menu-item")]
    return {
      labels: items.map((item) => item.textContent.trim()),
      matching: center(items[1].querySelector(".p-menu-item-content")),
    }
  }

  if (action === "state") {
    const service = __sidecarService()
    const component = ng.getComponent(page())
    const rows = [...page().querySelectorAll("app-settings-row")].map((row) => {
      const input = row.querySelector("p-slider .p-slider-handle input")
      const field = row.querySelector("p-inputnumber input")
      return {
        label: row.querySelector("[rowLabel]").textContent.trim(),
        slider: Number(input.getAttribute("aria-valuenow")),
        min: Number(input.getAttribute("aria-valuemin")),
        max: Number(input.getAttribute("aria-valuemax")),
        sliderDisabled: row.querySelector("p-slider").classList.contains("p-disabled"),
        shown: field.value,
        fieldDisabled: field.disabled,
      }
    })
    return {
      lang: document.documentElement.lang,
      size: [innerWidth, innerHeight],
      rows,
      resetDisabled: resetButton()?.disabled ?? null,
      model: component.thresholdsChoice(),
      stored: component.storedThresholds() ?? null,
      sidecarDefaults: service.defaultThresholds(),
      focused: document.activeElement?.closest?.("p-slider, p-inputnumber")?.getAttribute?.("data-field") ?? document.activeElement?.tagName,
    }
  }

  if (action === "x") {
    const [field, value] = rest
    const root = slider(field)
    const input = root.querySelector(".p-slider-handle input")
    const min = Number(input.getAttribute("aria-valuemin"))
    const max = Number(input.getAttribute("aria-valuemax"))
    const track = root.querySelector(".p-slider-track").getBoundingClientRect()
    const handle = center(root.querySelector(".p-slider-handle"))
    return {
      handle,
      min,
      max,
      // La valeur v tombe a cette abscisse, a la ligne de la poignee
      target: { x: Math.round(track.left + ((Number(value) - min) / (max - min)) * track.width), y: handle.y },
      trackRight: Math.round(track.right),
    }
  }

  if (action === "field") return center(numberInput(rest[0]))

  if (action === "reset") {
    return { ...center(resetButton()), disabled: resetButton().disabled }
  }

  if (action === "tooltip") {
    await until(() => document.querySelector(".p-tooltip") !== null, 3000)
    const tip = document.querySelector(".p-tooltip")
    if (!tip) return null
    const button = resetButton().getBoundingClientRect()
    const r = tip.getBoundingClientRect()
    return {
      text: tip.textContent.trim(),
      below: Math.round(r.top - button.bottom),
      centerOffset: Math.round(r.left + r.width / 2 - (button.left + button.width / 2)),
    }
  }

  if (action === "store") {
    const rid = await __TAURI_INTERNALS__.invoke("plugin:store|load", { path: "preferences.json" })
    const [value, exists] = await __TAURI_INTERNALS__.invoke("plugin:store|get", { rid, key: "thresholds" })
    return { thresholds: exists ? value : "absent" }
  }

  if (action === "layout") {
    const host = page()
    const section = host.querySelector("section")
    const main = document.querySelector("main")
    const canvas = document.createElement("canvas").getContext("2d")
    const muted = (() => {
      const probe = document.createElement("span")
      probe.className = "text-muted-color"
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })()
    const rows = [...host.querySelectorAll("app-settings-row")].map((row) => {
      const control = row.querySelector("[rowControl]")
      const sliderBox = row.querySelector("p-slider")
      const number = row.querySelector("p-inputnumber")
      const input = number.querySelector("input")
      const hint = row.querySelector(".text-xs")
      const style = getComputedStyle(input)
      canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      return {
        label: row.querySelector("[rowLabel]").textContent.trim(),
        columns: getComputedStyle(row).gridTemplateColumns,
        controlGap: getComputedStyle(control).columnGap,
        sliderToInput: px(number.getBoundingClientRect().left - sliderBox.getBoundingClientRect().right),
        fieldWidth: px(number.getBoundingClientRect().width),
        clipped: input.scrollWidth > input.clientWidth,
        text100: px(canvas.measureText("100").width),
        inner: px(input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
        tabular: style.fontVariantNumeric,
        hintFont: getComputedStyle(hint).fontSize,
        hintColorIsMuted: getComputedStyle(hint).color === muted,
        hintWhiteSpace: getComputedStyle(hint).whiteSpace,
        hintLines: hint.innerText.split("\n").length,
        hintGap: px(hint.getBoundingClientRect().top - control.getBoundingClientRect().bottom),
        hintAlignedOnControl: hint.getBoundingClientRect().left === control.getBoundingClientRect().left,
      }
    })
    const button = resetButton()
    const wrapper = button.parentElement
    return {
      lang: document.documentElement.lang,
      size: [innerWidth, innerHeight],
      menu: [...host.querySelectorAll(".p-menu-item-label")].map((label) => label.textContent.trim()),
      h2: section.querySelector("h2").textContent.trim(),
      rows,
      grayZoneShown: /zone grise|gray zone|grey zone/i.test(section.innerText),
      button: {
        classes: [...button.classList].filter((c) => /^p-button/.test(c)).join(" "),
        justify: getComputedStyle(wrapper).justifyContent,
        rightToSection: px(section.getBoundingClientRect().right - button.getBoundingClientRect().right),
        height: px(button.getBoundingClientRect().height),
      },
      scroll: {
        page: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
        main: main.scrollHeight > main.clientHeight,
      },
    }
  }

  const service = __sidecarService()

  if (action === "spy") {
    if (!service.__spied) {
      const original = service.send.bind(service)
      window.__matchingSent = []
      service.send = (command, ...more) => {
        window.__matchingSent.push(JSON.parse(JSON.stringify(command)))
        return original(command, ...more)
      }
      service.__spied = true
    }
    return { spied: true, already: window.__matchingSent.length }
  }

  if (action === "sent") return window.__matchingSent ?? null

  if (action === "tagging") {
    const [folder] = rest
    if (!folder) throw new Error("dossier a re-tagger manquant")
    const tab = [...document.querySelectorAll("p-tab")].find((t) => /tagging/i.test(t.textContent || ""))
    tab.click()
    await wait(700)
    const tagging = document.querySelector("app-tagging-page")
    // Poser le dossier sur le composant : « Choisir » ouvrirait le selecteur natif de l'utilisateur
    ng.getComponent(tagging).folder.set(folder)
    await wait(300)
    const button = tagging.querySelector(".grid > button[data-action]")
    return { action: button.getAttribute("data-action"), disabled: button.disabled, ...center(button) }
  }

  if (action === "run-state") {
    const tracks = service.taggingTracks()
    return {
      running: service.tagging(),
      runId: service.taggingRunId(),
      tracks: tracks.map((t) => ({ id: t.trackId, state: t.state, source: t.source })),
      lastError: service.lastError?.() ?? null,
    }
  }

  throw new Error(`action inconnue : ${action}`)
})()
