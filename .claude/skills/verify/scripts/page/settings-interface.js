// Reglages en menu lateral et section Interface dans la fenetre Tauri, gestes reels par
// `cdp.mjs --click` / `--move` aux coordonnees rendues ici.
//   node cdp.mjs page/settings-interface.js size <w> <h>   taille interieure de la fenetre
//   node cdp.mjs page/settings-interface.js open           onglet Reglages
//   node cdp.mjs page/settings-interface.js state          menu, section affichee, defilement, controles
//   node cdp.mjs page/settings-interface.js item <n>       centre de l'entree n du menu (base 0)
//   node cdp.mjs page/settings-interface.js select         centre du select de langue
//   node cdp.mjs page/settings-interface.js options        options ouvertes du select et leurs centres
//   node cdp.mjs page/settings-interface.js toggle         centre de la bascule du son
//   node cdp.mjs page/settings-interface.js store          `language` et `sound_signal` du store
//   node cdp.mjs page/settings-interface.js beep           annonce une fin, compte bips et toasts
;(async () => {
  const [action, ...rest] = __args

  const center = (element) => {
    const r = element.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }
  const page = () => document.querySelector("app-settings-page")
  const items = () => [...(page()?.querySelectorAll("p-menu .p-menu-item") ?? [])]

  if (action === "size") {
    const [width, height] = rest.map(Number)
    try {
      await __TAURI_INTERNALS__.invoke("plugin:window|set_size", {
        label: "main",
        value: { Logical: { width, height } },
      })
    } catch (error) {
      return { error: String(error), inner: [innerWidth, innerHeight] }
    }
    await wait(500)
    return { inner: [innerWidth, innerHeight] }
  }

  if (action === "open") {
    const tabs = [...document.querySelectorAll("p-tab")]
    tabs[tabs.length - 1].click()
    await until(() => page() !== null, 5000)
    await wait(400)
    return { url: location.pathname, h1: document.querySelector("main h1")?.textContent?.trim() }
  }

  if (action === "state") {
    const main = document.querySelector("main")
    const section = page().querySelector("section")
    const select = page().querySelector('p-select[data-field="language"]')
    const toggle = page().querySelector('p-toggleswitch[data-field="sound"]')
    return {
      lang: document.documentElement.lang,
      size: [innerWidth, innerHeight],
      scroll: {
        page: [document.scrollingElement.scrollHeight, document.scrollingElement.clientHeight],
        main: [main.scrollHeight, main.clientHeight],
      },
      menu: {
        width: Math.round(page().querySelector("p-menu").getBoundingClientRect().width),
        items: items().map((item) => {
          const content = item.querySelector(".p-menu-item-content")
          const label = item.querySelector(".p-menu-item-label")
          return {
            label: label?.textContent?.trim(),
            // Coupe si le texte deborde de sa boite
            cut: label ? label.scrollWidth > label.clientWidth : null,
            emphasis: content.classList.contains("bg-emphasis"),
            background: getComputedStyle(content).backgroundColor,
            focus: item.classList.contains("p-focus"),
          }
        }),
      },
      h2: section?.querySelector("h2")?.textContent?.trim() ?? null,
      sectionCount: page().querySelectorAll("section").length,
      rows: [...page().querySelectorAll("app-settings-row")].map((row) =>
        row.querySelector("[rowLabel]")?.textContent?.trim(),
      ),
      language: select
        ? {
            width: Math.round(select.getBoundingClientRect().width),
            shown: select.querySelector(".p-select-label")?.textContent?.trim(),
            size: select.classList.contains("p-select-sm"),
          }
        : null,
      sound: toggle
        ? {
            checked: toggle.querySelector("input")?.checked ?? null,
            rightEdge: Math.round(toggle.getBoundingClientRect().right),
            rowRight: Math.round(toggle.closest("app-settings-row").getBoundingClientRect().right),
          }
        : null,
      hints: [...page().querySelectorAll("app-settings-row .text-xs")].map((hint) => hint.innerText),
    }
  }

  if (action === "item") {
    const item = items()[Number(rest[0])]
    return { label: item.textContent.trim(), ...center(item.querySelector(".p-menu-item-content")) }
  }

  if (action === "select") {
    return center(page().querySelector('p-select[data-field="language"]'))
  }

  if (action === "options") {
    await until(() => document.querySelector(".p-select-option") !== null, 3000)
    return [...document.querySelectorAll(".p-select-option")].map((option) => ({
      label: option.textContent.trim(),
      ...center(option),
    }))
  }

  if (action === "toggle") {
    return center(page().querySelector('p-toggleswitch[data-field="sound"]'))
  }

  if (action === "store") {
    const rid = await __TAURI_INTERNALS__.invoke("plugin:store|load", { path: "preferences.json" })
    const read = async (key) => {
      const [value, exists] = await __TAURI_INTERNALS__.invoke("plugin:store|get", { rid, key })
      return exists ? value : "absent"
    }
    return { language: await read("language"), sound_signal: await read("sound_signal") }
  }

  if (action === "beep") {
    // Compte les contextes audio crees : le bip en ouvre un, le silence aucun.
    const Original = globalThis.AudioContext
    let contexts = 0
    globalThis.AudioContext = class extends Original {
      constructor(...args) {
        super(...args)
        contexts += 1
      }
    }
    const before = document.querySelectorAll(".p-toast-message").length
    const root = ng.getInjector(document.querySelector("app-root"))
    let signal = null
    for (const injector of ng["ɵgetInjectorResolutionPath"](root)) {
      let providers
      try {
        providers = ng["ɵgetInjectorProviders"](injector)
      } catch {
        continue
      }
      for (const record of Object.values(providers)) {
        const provided = Object.values(record).find(
          (value) => typeof value === "function" && /CompletionSignalService$/.test(value.name),
        )
        if (provided) signal = injector.get(provided)
      }
      if (signal) break
    }
    await signal.announce("tagging.finished")
    await wait(300)
    globalThis.AudioContext = Original
    return { contexts, toasts: document.querySelectorAll(".p-toast-message").length - before }
  }

  throw new Error(`action inconnue : ${action}`)
})()
