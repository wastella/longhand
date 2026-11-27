//! Small commands that reach outside the page: a native confirmation dialog, opening a link
//! in the browser, the window's light or dark appearance, and reporting the self-test result.

use crate::workspace::{err, R};
use serde_json::Value;
use tauri::{AppHandle, Theme, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[tauri::command]
pub async fn confirm(app: AppHandle, message: String, action: String) -> bool {
    app.dialog().message(message).title("Longhand").buttons(MessageDialogButtons::OkCancelCustom(action, "Cancel".into())).blocking_show()
}

#[tauri::command]
pub fn open_external(url: String) -> R<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web links can be opened".into());
    }
    let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(opener).arg(url).spawn().map(|_| ()).map_err(err)
}

/// The native appearance for a theme setting; None follows the system.
fn native_theme(theme: &str) -> Option<Theme> {
    match theme {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    }
}

/// Matches the window's own appearance (its buttons, native dialogs) to the interface's theme
/// setting: 'light', 'dark' or 'system'.
#[tauri::command]
pub fn window_set_theme(window: WebviewWindow, theme: String) -> R<()> {
    window.set_theme(native_theme(&theme)).map_err(err)
}

/// Quits once the interface has asked every area whether anything would be lost (the Quit menu
/// item runs that check first; the system's own Quit cannot be intercepted).
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

/// The interface's self-test (LONGHAND_SMOKE=1) ends here: print the result and quit.
#[tauri::command]
pub fn smoke_result(app: AppHandle, result: Value) {
    println!("SMOKE {result}");
    if let Ok(path) = std::env::var("LONGHAND_SMOKE_OUT") {
        let _ = std::fs::write(path, result.to_string());
    }
    app.exit(if result["ok"] == true { 0 } else { 1 });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_settings_map_to_native_appearances() {
        assert_eq!(native_theme("light"), Some(Theme::Light));
        assert_eq!(native_theme("dark"), Some(Theme::Dark));
        assert_eq!(native_theme("system"), None);
    }
}
