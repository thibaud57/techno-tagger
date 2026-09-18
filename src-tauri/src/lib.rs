use tauri::plugin::TauriPlugin;
use tauri::{Manager, Runtime};
use tauri_plugin_prevent_default::Flags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Doit rester le premier plugin : deux fenetres signifieraient deux
        // sidecars ecrivant le meme plan de run.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                // Les trois, dans cet ordre : sous Windows `set_focus` seul sur un
                // HWND minimise fait clignoter la barre des taches sans rien restaurer.
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(prevent_reload())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        // TODO: updater a l'etape 9, son init lit plugins.updater.pubkey, qui
        // n'existe pas tant que la paire de cles n'est pas generee.
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Coupe le rechargement de la webview en release : chaque rechargement relance le
/// sidecar sans arreter le precedent, qui poursuivrait un run que l'interface a oublie.
/// Le menu contextuel porte aussi « Recharger ». Le debug garde les deux, pour le live
/// reload, et les autres raccourcis restent actifs (`Shift+Tab`, zoom).
fn prevent_reload<R: Runtime>() -> TauriPlugin<R> {
    let flags = if cfg!(debug_assertions) {
        Flags::empty()
    } else {
        Flags::RELOAD | Flags::CONTEXT_MENU
    };

    tauri_plugin_prevent_default::with_flags(flags)
}
