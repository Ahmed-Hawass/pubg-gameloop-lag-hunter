// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // Win10 guarantee: if the WebView2 runtime is missing (machines cut off
  // from Windows Update), the app would show a blank window. Detect it up
  // front with a plain filesystem probe (the runtime's install location,
  // per Microsoft's docs) and give the user an actionable answer.
  // NOTE: no manual Win32 extern/linking here — an earlier registry-probe
  // version linked user32/advapi32 by hand and silently crashed the webview
  // creation on real machines.
  #[cfg(windows)]
  {
    if !webview2_installed() {
      let msg = "PUBG GameLoop Lag Hunter needs the Microsoft WebView2 runtime, which is missing on this PC.\n\n\
                 Press OK to open the official Microsoft download page in your browser, then run the installer and start this app again.\n\n\
                 (This is a one-time, free install from Microsoft. The download starts small but the full runtime needs a few hundred MB of disk space.)";
      let title = "PUBG GameLoop Lag Hunter";
      let action = unsafe {
        MessageBoxW(
          std::ptr::null_mut(),
          encode_utf16(msg).as_ptr(),
          encode_utf16(title).as_ptr(),
          MB_OKCANCEL | MB_ICONWARNING,
        )
      };
      if action == IDOK {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("cmd")
          .args(["/C", "start", "", "https://developer.microsoft.com/microsoft-edge/webview2/"])
          .creation_flags(0x0800_0000)
          .spawn();
      }
      std::process::exit(0);
    }
  }

  lag_hunter_lib::run();
}

/// Is the WebView2 runtime installed? Filesystem probe: the Evergreen runtime
/// always installs under "Microsoft\EdgeWebView\Application" (both Program
/// Files views), with a versioned subfolder. No registry, no Win32 linking.
#[cfg(windows)]
fn webview2_installed() -> bool {
  const BASES: [&str; 2] = [
    r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application",
    r"C:\Program Files\Microsoft\EdgeWebView\Application",
  ];
  for base in BASES {
    let dir = std::path::Path::new(base);
    if let Ok(entries) = std::fs::read_dir(dir) {
      // any versioned subfolder (e.g. "151.0.4129.107") = runtime present
      for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) && entry.path().is_dir() {
          return true;
        }
      }
    }
  }
  false
}

#[cfg(windows)]
fn encode_utf16(s: &str) -> Vec<u16> {
  use std::os::windows::ffi::OsStrExt;
  std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

// ---- only ONE binding: MessageBoxW from user32 (standard, safe) ----
#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
  fn MessageBoxW(hwnd: *mut core::ffi::c_void, text: *const u16, caption: *const u16, utype: u32) -> i32;
}

#[cfg(windows)]
const MB_OKCANCEL: u32 = 0x0000_0001;
#[cfg(windows)]
const MB_ICONWARNING: u32 = 0x0000_0030;
#[cfg(windows)]
const IDOK: i32 = 1;
