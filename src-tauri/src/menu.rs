//! The native menu bar. Each item's id is sent to the interface as a `menu` event, where the
//! area that registered a command with that id handles it.
//!
//! Every item made with `item` also goes into the keyboard shortcut reference (Help > Keyboard
//! Shortcuts), so the reference cannot drift from the menu. Each area's items sit in their own
//! commented block; add new items inside your area's block.

use serde::Serialize;
use std::cell::RefCell;
use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, MenuItemKind, SubmenuBuilder};
use tauri::{Emitter, Manager, State};

/// One line of the shortcut reference: the item's command id, its menu and label, and its keys
/// as written for Tauri (for example "CmdOrCtrl+Shift+F"; the interface draws the symbols).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Shortcut {
    id: String,
    menu: String,
    label: String,
    keys: String,
}

pub struct Shortcuts(Vec<Shortcut>);

/// The items that have shortcuts, in menu order. `menus` lists each menu's title with its item
/// ids in order; `recorded` is every (id, label, keys) made with `item`.
fn shortcut_table(menus: &[(String, Vec<String>)], recorded: &[(String, String, String)]) -> Vec<Shortcut> {
    let mut table = Vec::new();
    for (menu, ids) in menus {
        for id in ids {
            if let Some((_, label, keys)) = recorded.iter().find(|(recorded_id, _, keys)| recorded_id == id && !keys.is_empty()) {
                table.push(Shortcut { id: id.clone(), menu: menu.clone(), label: label.clone(), keys: keys.clone() });
            }
        }
    }
    table
}

pub fn build(app: &tauri::App) -> tauri::Result<()> {
    let recorded = RefCell::new(Vec::new());
    let item = |id: &str, label: &str, key: &str| {
        recorded.borrow_mut().push((id.to_string(), label.to_string(), key.to_string()));
        MenuItemBuilder::with_id(id, label).accelerator(key).build(app)
    };
    let plain = |id: &str, label: &str| MenuItemBuilder::with_id(id, label).build(app);
    // A native accelerator fires before the page sees the key, wherever focus is. A shortcut that
    // means something while typing elsewhere (in the terminal's shell Ctrl+G cancels a search and
    // Ctrl+- undoes) is left to the editor's own key bindings: its item gets no accelerator, shows the keys in its
    // label, and still goes into the shortcut reference.
    let hinted = |id: &str, label: &str, key: &str, shown: &str| {
        recorded.borrow_mut().push((id.to_string(), label.to_string(), key.to_string()));
        MenuItemBuilder::with_id(id, format!("{label} ({shown})")).build(app)
    };

    let about = AboutMetadataBuilder::new()
        .version(Some(app.package_info().version.to_string()))
        .comments(Some("A quiet code editor for students. You write the code; the tutor only reads."))
        .copyright(Some("Copyright © 2026 Longhand contributors. MIT License."))
        .build();
    let app_menu = SubmenuBuilder::new(app, "Longhand")
        .about(Some(about))
        .separator()
        // Shell
        .item(&item("settings", "Settings…", "CmdOrCtrl+,")?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        // Shell: a Quit the interface handles, so unsaved work is asked about first.
        .item(&item("quit", "Quit Longhand", "CmdOrCtrl+Q")?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        // Shell
        .item(&item("open-folder", "Open Folder…", "CmdOrCtrl+O")?)
        // Files
        .item(&item("new-file", "New File…", "CmdOrCtrl+N")?)
        .item(&item("quick-open", "Go to File…", "CmdOrCtrl+P")?)
        .separator()
        // Editor
        .item(&item("save", "Save", "CmdOrCtrl+S")?)
        .item(&item("close-tab", "Close Tab", "CmdOrCtrl+W")?)
        .separator()
        // Files
        .item(&item("find-in-files", "Find in Files…", "CmdOrCtrl+Shift+F")?)
        .separator()
        // Language servers: on or off for the open folder.
        .item(&plain("code-checking", "Code Checking for This Folder…")?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        // Editor (editor/index.js registers these commands)
        .separator()
        .item(&item("find", "Find…", "CmdOrCtrl+F")?)
        .item(&item("replace", "Replace…", "CmdOrCtrl+Alt+F")?)
        .item(&hinted("go-to-line", "Go to Line…", "Ctrl+G", "Ctrl+G")?)
        .item(&item("go-to-definition", "Go to Definition", "F12")?)
        .item(&hinted("go-back", "Go Back", "Ctrl+-", "Ctrl+-")?)
        .item(&item("toggle-comment", "Toggle Comment", "CmdOrCtrl+/")?)
        .separator()
        // With Cmd: Option+] and Option+[ alone type ‘ and “ on a Mac keyboard.
        .item(&item("next-note", "Next Note", "CmdOrCtrl+Alt+]")?)
        .item(&item("previous-note", "Previous Note", "CmdOrCtrl+Alt+[")?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        // Shell: panels
        .item(&item("toggle-files", "Show or Hide Files", "CmdOrCtrl+B")?)
        .item(&item("toggle-bottom", "Show or Hide Terminal and Tests", "CmdOrCtrl+J")?)
        .item(&item("toggle-tutor", "Show or Hide Tutor", "CmdOrCtrl+L")?)
        .separator()
        // Shell: focus
        .item(&item("focus-files", "Go to Files", "CmdOrCtrl+1")?)
        .item(&item("focus-editor", "Go to Editor", "CmdOrCtrl+2")?)
        .item(&item("focus-terminal", "Go to Terminal", "CmdOrCtrl+3")?)
        .item(&item("focus-tutor", "Go to Tutor", "CmdOrCtrl+4")?)
        .separator()
        // Shell: text size
        .item(&item("zoom-in", "Bigger Text", "CmdOrCtrl+=")?)
        .item(&item("zoom-out", "Smaller Text", "CmdOrCtrl+-")?)
        .item(&item("zoom-reset", "Default Text Size", "CmdOrCtrl+0")?)
        .separator()
        .fullscreen()
        .build()?;

    let run = SubmenuBuilder::new(app, "Run")
        // Terminal
        .item(&item("run-file", "Run File", "CmdOrCtrl+R")?)
        .item(&item("new-terminal", "New Terminal", "Ctrl+Shift+`")?)
        .separator()
        // Tests
        .item(&item("run-tests-file", "Run Tests in Current File", "CmdOrCtrl+T")?)
        .item(&item("run-tests", "Run All Tests", "CmdOrCtrl+Shift+T")?)
        .item(&item("rerun-failed-tests", "Rerun Failed Tests", "CmdOrCtrl+Shift+Y")?)
        .separator()
        // Notebooks: the keys are the notebook's own (notebook/view.js), so they only act in one.
        .item(&hinted("notebook-run-cell", "Run Cell", "Shift+Enter", "⇧↩")?)
        .item(&plain("notebook-run-all", "Run All Cells")?)
        .item(&plain("notebook-interrupt", "Interrupt Kernel")?)
        .item(&plain("notebook-restart", "Restart Kernel…")?)
        .build()?;

    // Tutor
    let tutor = SubmenuBuilder::new(app, "Tutor")
        .item(&item("lookup", "Look Up…", "CmdOrCtrl+Shift+K")?)
        .separator()
        .item(&item("ask-selection", "Explain Selection", "CmdOrCtrl+E")?)
        .item(&item("review-file", "Review Current File", "CmdOrCtrl+Shift+R")?)
        .item(&item("new-conversation", "New Conversation", "CmdOrCtrl+Shift+N")?)
        .build()?;

    // Shell: the system's Close Window would take ⌘W, which closes a tab here. Ours takes ⇧⌘W and
    // closes the window the usual way, so the interface can still ask about unsaved work.
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&item("close-window", "Close Window", "CmdOrCtrl+Shift+W")?)
        .build()?;

    // Shell
    let help = SubmenuBuilder::new(app, "Help").item(&plain("shortcuts", "Keyboard Shortcuts")?).build()?;

    let menu = MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &run, &tutor, &window, &help]).build()?;
    app.set_menu(menu.clone())?;
    #[cfg(target_os = "macos")]
    {
        window.set_as_windows_menu_for_nsapp()?;
        help.set_as_help_menu_for_nsapp()?;
    }

    let mut menus = Vec::new();
    for entry in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = entry {
            let ids = submenu.items()?.iter().filter_map(|i| i.as_menuitem().map(|m| m.id().0.clone())).collect();
            menus.push((submenu.text()?, ids));
        }
    }
    app.manage(Shortcuts(shortcut_table(&menus, &recorded.borrow())));

    app.on_menu_event(|app, event| {
        if event.id().0 == "close-window" {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
            return;
        }
        let _ = app.emit("menu", event.id().0.as_str());
    });
    Ok(())
}

/// Every menu item with a keyboard shortcut, for the reference in Help > Keyboard Shortcuts.
#[tauri::command]
pub fn shortcuts_list(shortcuts: State<Shortcuts>) -> Vec<Shortcut> {
    shortcuts.0.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(id: &str, menu: &str, label: &str, keys: &str) -> Shortcut {
        Shortcut { id: id.into(), menu: menu.into(), label: label.into(), keys: keys.into() }
    }

    #[test]
    fn the_table_follows_menu_order_and_skips_items_without_keys() {
        let recorded = [
            ("save".into(), "Save".into(), "CmdOrCtrl+S".into()),
            ("open-folder".into(), "Open Folder…".into(), "CmdOrCtrl+O".into()),
            ("quiet".into(), "No keys".into(), String::new()),
            ("zoom-in".into(), "Bigger Text".into(), "CmdOrCtrl+=".into()),
        ];
        let menus = [
            ("File".into(), vec!["open-folder".into(), "quiet".into(), "save".into()]),
            ("Help".into(), vec!["shortcuts".into()]),
            ("View".into(), vec!["zoom-in".into()]),
        ];
        assert_eq!(
            shortcut_table(&menus, &recorded),
            vec![
                s("open-folder", "File", "Open Folder…", "CmdOrCtrl+O"),
                s("save", "File", "Save", "CmdOrCtrl+S"),
                s("zoom-in", "View", "Bigger Text", "CmdOrCtrl+=")
            ]
        );
    }
}
