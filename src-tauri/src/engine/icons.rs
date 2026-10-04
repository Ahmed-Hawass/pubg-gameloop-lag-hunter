// icons.rs — real program artwork for Top Processes rows.
//
// One extraction per unique exe path (cached by path, like display
// names): the poll never extracts, the UI asks only for new PIDs and
// keeps the answers. Glyph-first loading in the UI covers every miss
// (protected processes, UWP without a readable icon, monochrome art).
//
// SHGetFileInfoW hands us the HICON, GetDIBits hands us 32-bit pixels,
// and the png crate turns them into a data URL with real transparency
// (BMP cannot carry the alpha: every badge wore a black tile). Only
// base64 stays hand-rolled (a crate for 5KB badges is the worse trade).

use std::collections::HashMap;
use std::sync::Mutex;

/// One resolved icon: the PID it was asked for plus the paintable URL.
/// PIDs (numbers) cross the bridge, never paths (paths can contain the
/// user name — the same rule as the top-process rows themselves).
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProcessIcon {
    pub pid: u32,
    pub url: String,
}

/// path -> data URL cache (steady state extracts nothing; updates rename
/// files, so the map resets past a ceiling instead of growing forever).
static ICON_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
const CACHE_CEILING: usize = 500;

/// Icons for PIDs: best-effort per PID, misses simply absent (the UI
/// keeps the glyph). Duplicates asked once.
pub fn process_icons(pids: &[u32]) -> Vec<ProcessIcon> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for &pid in pids {
        if pid == 0 || !seen.insert(pid) {
            continue;
        }
        if let Some(url) = icon_for_pid(pid) {
            out.push(ProcessIcon { pid, url });
        }
    }
    out
}

/// Data URL for one PID: path resolve (cached) then extract (cached).
#[cfg(windows)]
fn icon_for_pid(pid: u32) -> Option<String> {
    let path = process_path_of(pid)?;
    {
        let cache = ICON_CACHE.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(map) = cache.as_ref() {
            if let Some(url) = map.get(&path) {
                return Some(url.clone());
            }
        }
    }
    let url = icon_for_path(&path)?;
    let mut cache = ICON_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    let map = cache.get_or_insert_with(HashMap::new);
    if map.len() > CACHE_CEILING {
        map.clear();
    }
    map.insert(path, url.clone());
    Some(url)
}

#[cfg(not(windows))]
fn icon_for_pid(_pid: u32) -> Option<String> {
    None
}

/// Full image path of a PID (own-user processes; protected ones refuse
/// and read as None, never an error).
#[cfg(windows)]
fn process_path_of(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut size = 1024u32;
        let mut buf = vec![0u16; size as usize];
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
        CloseHandle(handle);
        if ok == 0 {
            return None;
        }
        String::from_utf16(&buf[..size as usize]).ok()
    }
}

/// Data URL for one exe path: system icon extraction with alpha kept.
#[cfg(windows)]
fn icon_for_path(path: &str) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let mut info: SHFILEINFOW = std::mem::zeroed();
        let got = SHGetFileInfoW(
            wide.as_ptr(),
            0,
            &mut info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON,
        );
        if got == 0 || info.h_icon.is_null() {
            return None;
        }
        let url = hicon_to_data_url(info.h_icon);
        DestroyIcon(info.h_icon);
        url
    }
}

/// HICON -> PNG data URL via its 32-bit color bitmap. Monochrome-only
/// icons (null color bitmap) read as None: the glyph covers them.
#[cfg(windows)]
fn hicon_to_data_url(hicon: *mut core::ffi::c_void) -> Option<String> {
    unsafe {
        let mut ii: ICONINFO = std::mem::zeroed();
        if GetIconInfo(hicon, &mut ii) == 0 || ii.hbm_color.is_null() {
            if !ii.hbm_mask.is_null() {
                DeleteObject(ii.hbm_mask);
            }
            return None;
        }
        let mut bm: BITMAP = std::mem::zeroed();
        if GetObjectW(
            ii.hbm_color,
            std::mem::size_of::<BITMAP>() as i32,
            &mut bm as *mut _ as *mut core::ffi::c_void,
        ) == 0
        {
            DeleteObject(ii.hbm_color);
            DeleteObject(ii.hbm_mask);
            return None;
        }
        let (w, h) = (bm.bm_width.max(1) as u32, bm.bm_height.max(1) as u32);
        // 40-byte info header asking for 32-bit bottom-up pixels
        let mut info = [0u8; 40];
        info[0..4].copy_from_slice(&40u32.to_le_bytes());
        info[4..8].copy_from_slice(&w.to_le_bytes());
        info[8..12].copy_from_slice(&h.to_le_bytes());
        info[12..14].copy_from_slice(&1u16.to_le_bytes());
        info[14..16].copy_from_slice(&32u16.to_le_bytes());
        let mut pixels = vec![0u8; (w * h * 4) as usize];
        let hdc = GetDC(std::ptr::null_mut());
        let lines = GetDIBits(
            hdc,
            ii.hbm_color,
            0,
            h,
            pixels.as_mut_ptr() as *mut core::ffi::c_void,
            info.as_mut_ptr() as *mut core::ffi::c_void,
            DIB_RGB_COLORS,
        );
        if !hdc.is_null() {
            ReleaseDC(std::ptr::null_mut(), hdc);
        }
        DeleteObject(ii.hbm_color);
        DeleteObject(ii.hbm_mask);
        if lines == 0 {
            return None;
        }
        png_data_url(w, h, &pixels)
    }
}

/// 32-bit BGRA bottom-up pixels (as GetDIBits hands them) -> PNG data
/// URL with real transparency (BMP cannot carry the alpha: every badge
/// wore a black tile). Pure pixels in, paintable URL out.
fn png_data_url(w: u32, h: u32, bgra_bottom_up: &[u8]) -> Option<String> {
    let rgba = rgba_top_down(w, h, bgra_bottom_up)?;
    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(&rgba).ok()?;
    }
    Some(format!("data:image/png;base64,{}", base64_encode(&buf)))
}

/// Bottom-up BGRA -> top-down RGBA (row flip plus channel swap). None
/// on short buffers, never a partial image.
fn rgba_top_down(w: u32, h: u32, bgra: &[u8]) -> Option<Vec<u8>> {
    let row = (w as usize).checked_mul(4)?;
    let img = row.checked_mul(h as usize)?;
    if bgra.len() < img || img == 0 {
        return None;
    }
    let mut out = vec![0u8; img];
    for y in 0..h as usize {
        let src = &bgra[y * row..(y + 1) * row];
        let dst = &mut out[(h as usize - 1 - y) * row..(h as usize - y) * row];
        for (s, d) in src.chunks_exact(4).zip(dst.chunks_exact_mut(4)) {
            d[0] = s[2];
            d[1] = s[1];
            d[2] = s[0];
            d[3] = s[3];
        }
    }
    Some(out)
}

/// Standard base64 with padding. Pure (no crate for 5KB badges).
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHA: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | (*chunk.get(2).unwrap_or(&0) as u32);
        out.push(ALPHA[(n >> 18) as usize & 63] as char);
        out.push(ALPHA[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { ALPHA[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { ALPHA[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(windows)]
const SHGFI_ICON: u32 = 0x0000_0100;
#[cfg(windows)]
const DIB_RGB_COLORS: u32 = 0;

/// Canonical Win32 spellings (hence the deliberate acronym allows,
/// same precedent as SHELLEXECUTEINFOW in elevate.rs).
#[cfg(windows)]
#[allow(clippy::upper_case_acronyms)]
#[repr(C)]
struct SHFILEINFOW {
    h_icon: *mut core::ffi::c_void,
    i_icon: i32,
    dw_attributes: u32,
    sz_display_name: [u16; 260],
    sz_type_name: [u16; 80],
}

#[cfg(windows)]
#[allow(clippy::upper_case_acronyms)]
#[repr(C)]
struct ICONINFO {
    f_icon: i32,
    x_hotspot: u32,
    y_hotspot: u32,
    hbm_mask: *mut core::ffi::c_void,
    hbm_color: *mut core::ffi::c_void,
}

#[cfg(windows)]
#[allow(clippy::upper_case_acronyms)]
#[repr(C)]
struct BITMAP {
    bm_type: i32,
    bm_width: i32,
    bm_height: i32,
    bm_width_bytes: i32,
    bm_planes: u16,
    bm_bits_pixel: u16,
    bm_bits: *mut core::ffi::c_void,
}

#[cfg(windows)]
#[link(name = "shell32")]
extern "system" {
    fn SHGetFileInfoW(
        path: *const u16,
        attrs: u32,
        info: *mut SHFILEINFOW,
        info_size: u32,
        flags: u32,
    ) -> usize;
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn GetIconInfo(hicon: *mut core::ffi::c_void, info: *mut ICONINFO) -> i32;
    fn DestroyIcon(hicon: *mut core::ffi::c_void) -> i32;
    fn GetDC(hwnd: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
    fn ReleaseDC(hwnd: *mut core::ffi::c_void, hdc: *mut core::ffi::c_void) -> i32;
}

#[cfg(windows)]
#[link(name = "gdi32")]
extern "system" {
    fn GetObjectW(handle: *mut core::ffi::c_void, size: i32, out: *mut core::ffi::c_void) -> i32;
    fn GetDIBits(
        hdc: *mut core::ffi::c_void,
        hbm: *mut core::ffi::c_void,
        start: u32,
        lines: u32,
        bits: *mut core::ffi::c_void,
        info: *mut core::ffi::c_void,
        usage: u32,
    ) -> i32;
    fn DeleteObject(obj: *mut core::ffi::c_void) -> i32;
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(desired: u32, inherit: i32, pid: u32) -> *mut core::ffi::c_void;
    fn CloseHandle(handle: *mut core::ffi::c_void) -> i32;
    fn QueryFullProcessImageNameW(
        handle: *mut core::ffi::c_void,
        flags: u32,
        name: *mut u16,
        size: *mut u32,
    ) -> i32;
}

#[cfg(windows)]
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn png_url_carries_real_transparency() {
        // 2x2 half-transparent red quad: PNG magic up front, then bytes
        let quad = [0u8, 0, 255, 128].repeat(4);
        let rgba = super::rgba_top_down(2, 2, &quad).unwrap();
        // channel swap held, alpha untouched
        assert_eq!(&rgba[0..4], &[255, 0, 0, 128]);
        let url = super::png_data_url(2, 2, &quad).unwrap();
        // PNG magic "\x89PNG\r\n\x1a\n" base64s to iVBORw0KGgo, always
        assert!(url.starts_with("data:image/png;base64,iVBORw0KGgo"));
        // short buffers refuse, never a partial image
        assert!(super::rgba_top_down(2, 2, &[0u8; 8]).is_none());
        assert!(super::png_data_url(2, 2, &[0u8; 8]).is_none());
    }

    #[test]
    fn pid_zero_resolves_nothing_without_side_effects() {
        assert!(process_icons(&[]).is_empty());
        assert!(process_icons(&[0, 0]).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn own_process_carries_a_paintable_icon() {
        // our own exe ships artwork: the live path must resolve it
        let icons = process_icons(&[std::process::id()]);
        assert_eq!(icons.len(), 1);
        assert!(icons[0].url.starts_with("data:image/png;base64,iVBORw0KGgo"));
    }
}
