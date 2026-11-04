use crate::library::Outcome;
use std::path::Path;

#[cfg(target_os = "macos")]
pub fn copy_image(path: &Path) -> Outcome<()> {
    use objc2::{runtime::ProtocolObject, AllocAnyThread};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSPasteboard, NSPasteboardItem,
        NSPasteboardTypeFileURL, NSPasteboardTypePNG, NSPasteboardWriting,
    };
    use objc2_foundation::{NSArray, NSDictionary, NSString, NSURL};
    let filename = NSString::from_str(&path.to_string_lossy());
    let url = NSURL::fileURLWithPath(&filename)
        .absoluteString()
        .ok_or("Could not encode file URL")?;
    let item = NSPasteboardItem::new();
    // These AppKit constants live for the process lifetime.
    let mut valid = unsafe { item.setString_forType(&url, NSPasteboardTypeFileURL) };
    if !crate::library::is_streamed_media(path) {
        let image = NSImage::initWithContentsOfFile(NSImage::alloc(), &filename)
            .ok_or("macOS could not decode this image")?;
        let tiff = image
            .TIFFRepresentation()
            .ok_or("Could not read image pixels")?;
        let bitmap =
            NSBitmapImageRep::imageRepWithData(&tiff).ok_or("Could not decode image pixels")?;
        // An empty options dictionary is valid for PNG encoding. No files are written.
        let png = unsafe {
            bitmap.representationUsingType_properties(
                NSBitmapImageFileType::PNG,
                &NSDictionary::new(),
            )
        }
        .ok_or("Could not encode PNG")?;
        valid = valid && unsafe { item.setData_forType(&png, NSPasteboardTypePNG) };
    }
    if !valid {
        return Err("Could not prepare clipboard image".into());
    }
    let objects: objc2::rc::Retained<NSArray<ProtocolObject<dyn NSPasteboardWriting>>> =
        NSArray::from_slice(&[ProtocolObject::from_ref(&*item)]);
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    if board.writeObjects(&objects) {
        Ok(())
    } else {
        Err("Clipboard is busy; try again".into())
    }
}
#[cfg(not(target_os = "macos"))]
pub fn copy_image(_path: &Path) -> Outcome<()> {
    Err("Copy image requires macOS".into())
}

#[cfg(target_os = "macos")]
pub fn clipboard_chat_url() -> Outcome<String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    let text = unsafe { NSPasteboard::generalPasteboard().stringForType(NSPasteboardTypeString) }
        .map(|s| s.to_string())
        .unwrap_or_default();
    let text = text.trim();
    Ok(tauri::Url::parse(text)
        .ok()
        .filter(|u| u.scheme() == "https" && u.host_str() == Some("chatgpt.com"))
        .map(|_| text.to_string())
        .unwrap_or_default())
}
#[cfg(not(target_os = "macos"))]
pub fn clipboard_chat_url() -> Outcome<String> {
    Ok(String::new())
}
