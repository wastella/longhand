//! Small commands that reach outside the window: a native confirmation dialog, opening a link
//! in the browser, and reporting the self-test result.

use crate::workspace::{err, R};
use serde_json::Value;
use tauri::AppHandle;
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

/// The interface's self-test (LONGHAND_SMOKE=1) ends here: print the result and quit.
#[tauri::command]
pub fn smoke_result(app: AppHandle, result: Value) {
    println!("SMOKE {result}");
    if let Ok(path) = std::env::var("LONGHAND_SMOKE_OUT") {
        let _ = std::fs::write(path, result.to_string());
    }
    app.exit(if result["ok"] == true { 0 } else { 1 });
}
