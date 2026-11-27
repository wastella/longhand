//! The native menu bar. Each item's id is sent to the interface as a `menu` event, where the
//! area that registered a command with that id handles it.

use crate::workspace::choose_folder;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

pub fn build(app: &tauri::App) -> tauri::Result<()> {
    let item = |id: &str, label: &str, key: &str| MenuItemBuilder::with_id(id, label).accelerator(key).build(app);
    let app_menu =
        SubmenuBuilder::new(app, "Longhand").about(None).separator().hide().hide_others().show_all().separator().quit().build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("open-folder", "Open Folder…", "CmdOrCtrl+O")?)
        .item(&item("new-file", "New File…", "CmdOrCtrl+N")?)
        .item(&item("quick-open", "Go to File…", "CmdOrCtrl+P")?)
        .separator()
        .item(&item("save", "Save", "CmdOrCtrl+S")?)
        .item(&item("close-tab", "Close Tab", "CmdOrCtrl+W")?)
        .separator()
        .item(&item("find-in-files", "Find in Files…", "CmdOrCtrl+Shift+F")?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("toggle-files", "Toggle Files", "CmdOrCtrl+B")?)
        .item(&item("toggle-bottom", "Toggle Terminal", "CmdOrCtrl+J")?)
        .item(&item("toggle-tutor", "Toggle Tutor", "CmdOrCtrl+L")?)
        .separator()
        .item(&item("zoom-in", "Bigger Text", "CmdOrCtrl+=")?)
        .item(&item("zoom-out", "Smaller Text", "CmdOrCtrl+-")?)
        .item(&item("zoom-reset", "Default Text Size", "CmdOrCtrl+0")?)
        .separator()
        .fullscreen()
        .build()?;
    let run = SubmenuBuilder::new(app, "Run")
        // The terminal's items.
        .item(&item("run-file", "Run File", "CmdOrCtrl+R")?)
        .item(&item("new-terminal", "New Terminal", "Ctrl+Shift+`")?)
        .separator()
        .item(&item("run-tests-file", "Run Tests in Current File", "CmdOrCtrl+T")?)
        .item(&item("run-tests", "Run All Tests", "CmdOrCtrl+Shift+T")?)
        .build()?;
    let tutor = SubmenuBuilder::new(app, "Tutor")
        .item(&item("ask-selection", "Explain Selection", "CmdOrCtrl+E")?)
        .item(&item("review-file", "Review Current File", "CmdOrCtrl+Shift+R")?)
        .item(&item("new-conversation", "New Conversation", "CmdOrCtrl+Shift+N")?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;
    let menu = MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &run, &tutor, &window]).build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().0.as_str();
        if id == "open-folder" {
            choose_folder(app);
        } else {
            let _ = app.emit("menu", id);
        }
    });
    Ok(())
}
