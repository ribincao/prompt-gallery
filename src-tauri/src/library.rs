//! Plain-file storage. All mutation paths are checked, including symlink components.
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

pub type Outcome<T> = Result<T, String>;
pub const BUILTIN_TAGS: &[&str] = &[
    "single",
    "couple",
    "group",
    "pet",
    "landscape",
    "character-sheet",
    "object",
];
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub created_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LibraryMeta {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folders: Vec<Folder>,
    pub app: String,
    pub version: u32,
    pub tags: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    pub original_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub tags: Vec<String>,
    pub note: String,
    pub created_at: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptInput {
    pub title: String,
    pub needs: Vec<String>,
    pub tags: Vec<String>,
    pub source_url: String,
    pub notes: String,
    pub favorite: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptMeta {
    pub id: String,
    #[serde(flatten)]
    pub fields: PromptInput,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub source_photos: Vec<String>,
    pub chat_url: String,
    pub model: String,
    pub note: String,
    pub favorite: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultMeta {
    pub id: String,
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(flatten)]
    pub fields: ResultInput,
    pub created_at: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct ImageRecord<T> {
    #[serde(flatten)]
    pub meta: T,
    pub path: String,
    pub thumbnail: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct PromptRecord {
    #[serde(flatten)]
    pub meta: PromptMeta,
    pub text: String,
    pub results: Vec<ImageRecord<ResultMeta>>,
}
#[derive(Debug, Serialize)]
pub struct Library {
    pub folders: Vec<Folder>,
    pub root: String,
    pub tags: Vec<String>,
    pub sources: Vec<ImageRecord<Source>>,
    pub prompts: Vec<PromptRecord>,
    pub warnings: Vec<String>,
}
fn now() -> String {
    Local::now().to_rfc3339()
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn valid_id(id: &str) -> Outcome<()> {
    let b = id.as_bytes();
    if b.len() == 20
        && b[8] == b'-'
        && b[15] == b'-'
        && b[..8].iter().chain(b[9..15].iter()).all(u8::is_ascii_digit)
        && b[16..].iter().all(u8::is_ascii_hexdigit)
    {
        Ok(())
    } else {
        Err("Invalid item ID".into())
    }
}
pub fn safe(root: &Path, relative: impl AsRef<Path>) -> Outcome<PathBuf> {
    let relative = relative.as_ref();
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Unsafe library path".into());
    }
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err(format!(
                    "Symlinks are not allowed inside the library: {}",
                    path.display()
                ))
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(err(e)),
        }
    }
    Ok(path)
}
pub fn owned_file(root: &Path, path: &Path) -> Outcome<PathBuf> {
    let rel = path
        .strip_prefix(root)
        .map_err(|_| "Path is outside the current library")?;
    let p = safe(root, rel)?;
    if !p.is_file() {
        return Err("Image file is missing".into());
    }
    Ok(p)
}
fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Outcome<T> {
    let bytes = fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display()))
}
// Temporary files are exclusively created in the destination directory. Only our own
// unfinished temporary file can be removed; library records are never hard-deleted.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Outcome<()> {
    let parent = path.parent().ok_or("Missing parent directory")?;
    let (temp, mut file) = loop {
        let p = parent.join(format!(".write-{:016x}.tmp", rand::random::<u64>()));
        match fs::OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(f) => break (p, f),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(err(e)),
        }
    };
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        fs::File::open(parent)?.sync_all()
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(err)
}
fn write_json(path: &Path, data: &impl Serialize) -> Outcome<()> {
    atomic_write(path, &serde_json::to_vec_pretty(data).map_err(err)?)
}
pub fn marker(root: &Path) -> Outcome<LibraryMeta> {
    let m: LibraryMeta = read(&safe(root, "library.json")?)?;
    if m.app != "prompt-gallery" || m.version != 1 {
        return Err("This is not a supported Prompt Gallery v1 library".into());
    }
    Ok(m)
}
pub fn open_library(path: &Path, confirm_nonempty: bool) -> Outcome<PathBuf> {
    let root = fs::canonicalize(path).map_err(err)?;
    if !root.is_dir() {
        return Err("Choose a folder".into());
    }
    let marker_path = safe(&root, "library.json")?;
    if marker_path.exists() {
        marker(&root)?;
    } else {
        if fs::read_dir(&root).map_err(err)?.next().is_some() && !confirm_nonempty {
            return Err("CONFIRM_NONEMPTY".into());
        }
        for dir in ["sources", "prompts", ".thumbs"] {
            let p = safe(&root, dir)?;
            if p.exists() && !p.is_dir() {
                return Err(format!("{dir} is not a directory"));
            }
        }
        for dir in ["sources", "prompts", ".thumbs"] {
            fs::create_dir_all(safe(&root, dir)?).map_err(err)?;
        }
        write_json(
            &marker_path,
            &LibraryMeta {
                folders: vec![],
                app: "prompt-gallery".into(),
                version: 1,
                tags: BUILTIN_TAGS.iter().map(|s| s.to_string()).collect(),
            },
        )?;
    }
    for dir in ["sources", "prompts", ".thumbs"] {
        fs::create_dir_all(safe(&root, dir)?).map_err(err)?;
    }
    Ok(root)
}
fn id(root: &Path) -> Outcome<String> {
    loop {
        let candidate = format!(
            "{}-{:04x}",
            Local::now().format("%Y%m%d-%H%M%S"),
            rand::random::<u16>()
        );
        let mut taken = safe(root, format!("sources/{candidate}.json"))?.exists()
            || safe(root, format!("prompts/{candidate}"))?.exists()
            || safe(root, format!(".thumbs/{candidate}.jpg"))?.exists();
        for p in fs::read_dir(safe(root, "prompts")?).map_err(err)? {
            let p = p.map_err(err)?;
            if p.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            if p.file_type().map_err(err)?.is_dir()
                && p.path()
                    .join("results")
                    .join(format!("{candidate}.json"))
                    .exists()
            {
                taken = true;
            }
        }
        if !taken {
            return Ok(candidate);
        }
    }
}
fn image_name(id: &str, file: &str) -> Outcome<()> {
    let p = Path::new(file);
    if p.components().count() != 1 || p.file_stem().and_then(|x| x.to_str()) != Some(id) {
        return Err("Image filename does not match its ID".into());
    }
    extension(p).map(|_| ())
}
fn extension(path: &Path) -> Outcome<String> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .ok_or("Media has no extension")?;
    if ![
        "jpg", "jpeg", "png", "webp", "heic", "gif", "mp4", "mov", "m4v", "mp3", "m4a", "aac",
        "wav", "aif", "aiff", "flac",
    ]
    .contains(&ext.to_lowercase().as_str())
    {
        return Err("Unsupported media format".into());
    }
    Ok(ext.into())
}
// Poll instead of output()/wait_with_output(): Quick Look can stop responding forever.
// Null streams avoid pipe backpressure and keeping a descendant's output pipe open.
fn wait_with_timeout(
    child: &mut std::process::Child,
    timeout: std::time::Duration,
) -> std::io::Result<Option<std::process::ExitStatus>> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(Some(status)),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(
                    std::time::Duration::from_millis(20)
                        .min(deadline.saturating_duration_since(std::time::Instant::now())),
                );
            }
            Ok(None) => {
                // kill may race with natural completion; wait still reaps the child.
                let _ = child.kill();
                child.wait()?;
                return Ok(None);
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }
    }
}
#[cfg(all(target_os = "macos", not(test)))]
fn run_thumbnail_command(
    command: &mut std::process::Command,
    deadline: std::time::Instant,
) -> Outcome<bool> {
    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
    if remaining.is_zero() {
        return Ok(false);
    }
    let mut child = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(err)?;
    Ok(wait_with_timeout(&mut child, remaining)
        .map_err(err)?
        .is_some_and(|s| s.success()))
}
fn claim_poster_attempt(
    attempts: &std::sync::Mutex<std::collections::HashSet<PathBuf>>,
    path: &Path,
) -> bool {
    attempts
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(path.to_path_buf())
}
#[cfg(all(target_os = "macos", not(test)))]
static POSTER_ATTEMPTS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<PathBuf>>> =
    std::sync::OnceLock::new();

fn thumbnail(root: &Path, id: &str, image: &Path) -> Outcome<Option<String>> {
    fs::create_dir_all(safe(root, ".thumbs")?).map_err(err)?;
    let target = safe(root, format!(".thumbs/{id}.jpg"))?;
    if target.exists() {
        return Ok(Some(target.to_string_lossy().into()));
    }
    #[cfg(all(target_os = "macos", not(test)))]
    {
        // Integration-test binaries are built without cfg(test), so they explicitly
        // disable real poster subprocesses through this seam as well.
        let video = is_streamed_media(image);
        if video
            && (std::env::var_os("PROMPT_GALLERY_DISABLE_POSTERS").is_some()
                || !claim_poster_attempt(POSTER_ATTEMPTS.get_or_init(Default::default), &target))
        {
            return Ok(None);
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        let scratch = safe(
            root,
            format!(".thumbs/.video-{id}-{:016x}", rand::random::<u64>()),
        )?;
        let staged = safe(
            root,
            format!(".thumbs/.poster-{id}-{:016x}.jpg", rand::random::<u64>()),
        )?;
        let result = (|| -> Outcome<Option<String>> {
            let input = if video {
                fs::create_dir(&scratch).map_err(err)?;
                if !run_thumbnail_command(
                    std::process::Command::new("/usr/bin/qlmanage")
                        .args(["-t", "-s", "480", "-o"])
                        .arg(&scratch)
                        .arg(image),
                    deadline,
                )? {
                    return Ok(None);
                }
                let Some(poster) = fs::read_dir(&scratch)
                    .map_err(err)?
                    .filter_map(Result::ok)
                    .map(|e| e.path())
                    .find(|p| p.is_file())
                else {
                    return Ok(None);
                };
                poster
            } else {
                image.to_path_buf()
            };
            // Conversion shares the same eight-second budget, including for images.
            if !run_thumbnail_command(
                std::process::Command::new("/usr/bin/sips")
                    .args(["-Z", "480", "-s", "format", "jpeg"])
                    .arg(&input)
                    .arg("--out")
                    .arg(&staged),
                deadline,
            )? {
                return Ok(None);
            }
            fs::rename(&staged, &target).map_err(err)?;
            Ok(Some(target.to_string_lossy().into()))
        })();
        // The child has exited or been killed and reaped before cleanup.
        let _ = fs::remove_file(&staged);
        if video {
            let _ = fs::remove_dir_all(&scratch);
        }
        result
    }
    #[cfg(any(not(target_os = "macos"), test))]
    {
        let _ = image;
        Ok(None)
    }
}
fn image_record<T>(
    root: &Path,
    id: &str,
    file: &str,
    dir: &str,
    meta: T,
    warnings: &mut Vec<String>,
) -> Outcome<ImageRecord<T>> {
    image_name(id, file)?;
    let path = safe(root, format!("{dir}/{file}"))?;
    if !path.is_file() {
        warnings.push(format!("Image missing: {}", path.display()));
    }
    let thumb = if path.is_file() {
        match thumbnail(root, id, &path) {
            Ok(t) => t,
            Err(e) => {
                warnings.push(e);
                None
            }
        }
    } else {
        None
    };
    Ok(ImageRecord {
        meta,
        path: path.to_string_lossy().into(),
        thumbnail: thumb,
    })
}
fn entries(root: &Path, dir: &str, warnings: &mut Vec<String>) -> Vec<PathBuf> {
    match safe(root, dir).and_then(|p| fs::read_dir(p).map_err(err)) {
        Ok(it) => it
            .filter_map(|e| match e {
                Ok(e) if e.file_name().to_string_lossy().starts_with('.') => None,
                Ok(e) => Some(e.path()),
                Err(e) => {
                    warnings.push(err(e));
                    None
                }
            })
            .collect(),
        Err(e) => {
            warnings.push(e);
            vec![]
        }
    }
}
pub fn load_library(root: &Path) -> Outcome<Library> {
    let m = marker(root)?;
    let mut lib = Library {
        root: root.to_string_lossy().into(),
        folders: m.folders,
        tags: m.tags,
        sources: vec![],
        prompts: vec![],
        warnings: vec![],
    };
    for p in entries(root, "sources", &mut lib.warnings) {
        if p.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let result = (|| {
            owned_file(root, &p)?;
            let mut s: Source = read(&p)?;
            if matches!(s.kind.as_deref(), Some("video" | "audio")) && s.duration_seconds.is_none()
            {
                s.duration_seconds = media_duration(&safe(root, format!("sources/{}", s.file))?);
            }
            valid_id(&s.id)?;
            if p.file_stem().and_then(|s| s.to_str()) != Some(&s.id) {
                return Err("Source ID does not match filename".into());
            }
            image_record(
                root,
                &s.id.clone(),
                &s.file.clone(),
                "sources",
                s,
                &mut lib.warnings,
            )
        })();
        match result {
            Ok(s) => lib.sources.push(s),
            Err(e) => lib.warnings.push(format!("Skipped {}: {e}", p.display())),
        }
    }
    for p in entries(root, "prompts", &mut lib.warnings) {
        let result: Outcome<PromptRecord> = (|| {
            let pid = p
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or("Invalid prompt folder")?;
            valid_id(pid)?;
            let m: PromptMeta = read(&safe(root, format!("prompts/{pid}/meta.json"))?)?;
            if m.id != pid {
                return Err("Prompt ID does not match folder".into());
            }
            let text =
                fs::read_to_string(safe(root, format!("prompts/{pid}/prompt.md"))?).map_err(err)?;
            let mut results = vec![];
            let dir = format!("prompts/{pid}/results");
            for r in entries(root, &dir, &mut lib.warnings) {
                if r.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                let result = (|| {
                    owned_file(root, &r)?;
                    let mut m: ResultMeta = read(&r)?;
                    if matches!(m.kind.as_deref(), Some("video" | "audio"))
                        && m.duration_seconds.is_none()
                    {
                        m.duration_seconds =
                            media_duration(&safe(root, format!("{dir}/{}", m.file))?);
                    }
                    valid_id(&m.id)?;
                    if r.file_stem().and_then(|s| s.to_str()) != Some(&m.id) {
                        return Err("Result ID does not match filename".into());
                    }
                    image_record(
                        root,
                        &m.id.clone(),
                        &m.file.clone(),
                        &dir,
                        m,
                        &mut lib.warnings,
                    )
                })();
                match result {
                    Ok(r) => results.push(r),
                    Err(e) => lib.warnings.push(format!("Skipped {}: {e}", r.display())),
                }
            }
            results.sort_by(|a, b| b.meta.created_at.cmp(&a.meta.created_at));
            Ok(PromptRecord {
                meta: m,
                text,
                results,
            })
        })();
        match result {
            Ok(p) => lib.prompts.push(p),
            Err(e) => lib.warnings.push(format!("Skipped {}: {e}", p.display())),
        }
    }
    lib.sources
        .sort_by(|a, b| b.meta.created_at.cmp(&a.meta.created_at));
    lib.prompts
        .sort_by(|a, b| b.meta.updated_at.cmp(&a.meta.updated_at));
    Ok(lib)
}
pub fn set_tags(root: &Path, tags: Vec<String>) -> Outcome<()> {
    let _lock = TagLock::acquire(root)?;
    let mut m = marker(root)?;
    m.tags.extend(
        tags.into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>(),
    );
    m.tags.sort();
    m.tags.dedup();
    write_json(&safe(root, "library.json")?, &m)
}
#[derive(Debug, Serialize)]
pub struct TagUsage {
    pub tag: String,
    pub sources: usize,
    pub prompts: usize,
}
#[derive(Debug, Default, Serialize)]
pub struct TagChange {
    pub sources: usize,
    pub prompts: usize,
    pub warnings: Vec<String>,
}
// Read metadata independently of images, prompt text and results: missing media must
// not prevent a tag from being counted or removed. Keep the loader's path/ID guards.
fn tag_records(
    root: &Path,
    warnings: &mut Vec<String>,
    lock: &TagLock,
) -> Outcome<Vec<(PathBuf, serde_json::Value, bool)>> {
    let mut records = vec![];
    for (dir, is_prompt) in [("sources", false), ("prompts", true)] {
        let mut paths = entries(root, dir, warnings);
        paths.sort();
        for entry in paths {
            lock.renew()?;
            if !is_prompt && entry.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let path = if is_prompt {
                entry.join("meta.json")
            } else {
                entry
            };
            let result: Outcome<serde_json::Value> = (|| {
                owned_file(root, &path)?;
                let value: serde_json::Value = read(&path)?;
                let id = if is_prompt {
                    let meta: PromptMeta = serde_json::from_value(value.clone()).map_err(err)?;
                    meta.id
                } else {
                    let meta: Source = serde_json::from_value(value.clone()).map_err(err)?;
                    meta.id
                };
                valid_id(&id)?;
                let name = if is_prompt {
                    path.parent().and_then(Path::file_name)
                } else {
                    path.file_stem()
                };
                if name.and_then(|s| s.to_str()) != Some(&id) {
                    return Err("Record ID does not match path".into());
                }
                Ok(value)
            })();
            match result {
                Ok(value) => records.push((path, value, is_prompt)),
                Err(e) => warnings.push(format!("Skipped {}: {e}", path.display())),
            }
        }
    }
    Ok(records)
}
pub fn tag_usage(root: &Path) -> Outcome<Vec<TagUsage>> {
    let lock = TagLock::acquire(root)?;
    let mut counts = std::collections::BTreeMap::<String, (usize, usize)>::new();
    for tag in marker(root)?.tags {
        counts.entry(tag).or_default();
    }
    let mut warnings = vec![];
    for (_, value, is_prompt) in tag_records(root, &mut warnings, &lock)? {
        lock.renew()?;
        let mut seen = std::collections::HashSet::new();
        for field in if is_prompt {
            &["needs", "tags"][..]
        } else {
            &["tags"][..]
        } {
            for tag in value[field].as_array().unwrap() {
                let tag = tag.as_str().unwrap();
                if seen.insert(tag) {
                    let count = counts.entry(tag.into()).or_default();
                    if is_prompt {
                        count.1 += 1;
                    } else {
                        count.0 += 1;
                    }
                }
            }
        }
    }
    for warning in warnings {
        eprintln!("{warning}");
    }
    Ok(counts
        .into_iter()
        .map(|(tag, (sources, prompts))| TagUsage {
            tag,
            sources,
            prompts,
        })
        .collect())
}
fn replace_tag(tags: &mut Vec<String>, from: &str, to: Option<&str>) {
    let mut seen = std::collections::HashSet::new();
    *tags = tags
        .iter()
        .filter_map(|tag| {
            let tag = if tag == from { to? } else { tag.as_str() };
            seen.insert(tag.to_string()).then(|| tag.to_string())
        })
        .collect();
}
pub fn remove_tag(root: &Path, tag: &str) -> Outcome<TagChange> {
    change_tag(root, tag, None)
}
pub fn rename_tag(root: &Path, from: &str, to: &str) -> Outcome<TagChange> {
    let to = to.trim();
    if to.is_empty() {
        return Err("Tag names cannot be empty".into());
    }
    change_tag(root, from, Some(to))
}
fn change_tag(root: &Path, from: &str, to: Option<&str>) -> Outcome<TagChange> {
    if from.trim().is_empty() {
        return Err("Tag names cannot be empty".into());
    }
    let lock = TagLock::acquire(root)?;
    let mut meta = marker(root)?;
    let mut change = TagChange::default();
    let records = tag_records(root, &mut change.warnings, &lock)
        .map_err(|e| tag_change_error(&change, root, &e))?;
    let mut found = meta.tags.iter().any(|t| t == from);
    for (path, mut value, is_prompt) in records {
        lock.renew()
            .map_err(|e| tag_change_error(&change, &path, &e))?;
        let mut changed = false;
        for field in if is_prompt {
            &["needs", "tags"][..]
        } else {
            &["tags"][..]
        } {
            let old: Vec<String> = serde_json::from_value(value[field].clone()).map_err(err)?;
            if !old.iter().any(|t| t == from) {
                continue;
            }
            found = true;
            let mut tags = old.clone();
            replace_tag(&mut tags, from, to);
            if tags != old {
                value[field] = serde_json::json!(tags);
                changed = true;
            }
        }
        if !changed {
            continue;
        }
        if is_prompt {
            value["updatedAt"] = serde_json::json!(now());
        }
        write_json(&path, &value).map_err(|e| tag_change_error(&change, &path, &e))?;
        if is_prompt {
            change.prompts += 1;
        } else {
            change.sources += 1;
        }
    }
    let old = meta.tags.clone();
    replace_tag(&mut meta.tags, from, to);
    if found {
        if let Some(to) = to {
            if !meta.tags.iter().any(|t| t == to) {
                meta.tags.push(to.into());
            }
        }
    }
    if meta.tags != old {
        lock.renew()
            .map_err(|e| tag_change_error(&change, root, &e))?;
        let path = safe(root, "library.json").map_err(|e| tag_change_error(&change, root, &e))?;
        write_json(&path, &meta).map_err(|e| tag_change_error(&change, &path, &e))?;
    }
    Ok(change)
}
fn tag_change_error(change: &TagChange, path: &Path, error: &str) -> String {
    format!("Stopped at {}: {error}. {} records already updated ({} photos, {} prompts); reload before retrying. The failed write may have reached disk if directory sync failed. Warnings: {}",
        path.display(), change.sources + change.prompts, change.sources, change.prompts, change.warnings.join("; "))
}

fn add_tags(root: &Path, tags: &[String]) -> Outcome<()> {
    set_tags(root, tags.to_vec())
}
fn copy_image(
    root: &Path,
    dir: &str,
    id: &str,
    path: Option<&Path>,
    bytes: Option<&[u8]>,
) -> Outcome<(String, String)> {
    let (ext, name, data) = match (path, bytes) {
        (Some(p), None) => (
            extension(p)?,
            p.file_name()
                .ok_or("Invalid filename")?
                .to_string_lossy()
                .into_owned(),
            fs::read(p).map_err(err)?,
        ),
        (None, Some(b)) if b.starts_with(b"\x89PNG\r\n\x1a\n") => {
            ("png".into(), "Pasted image.png".into(), b.to_vec())
        }
        _ => return Err("Provide one image path or PNG image bytes".into()),
    };
    let file = format!("{id}.{ext}");
    let target = safe(root, format!("{dir}/{file}"))?;
    if target.exists() {
        return Err("Image already exists; retry import".into());
    }
    atomic_write(&target, &data)?;
    Ok((file, name))
}
pub fn import_source(
    root: &Path,
    path: Option<&Path>,
    bytes: Option<&[u8]>,
    tags: Vec<String>,
) -> Outcome<Source> {
    marker(root)?;
    let id = id(root)?;
    let (file, original_name) = copy_image(root, "sources", &id, path, bytes)?;
    let s = Source {
        folder: None,
        kind: media_kind(&file),
        duration_seconds: media_duration(&safe(root, format!("sources/{file}"))?),
        id,
        file,
        original_name,
        name: None,
        tags,
        note: String::new(),
        created_at: now(),
    };
    write_json(&safe(root, format!("sources/{}.json", s.id))?, &s)?;
    add_tags(root, &s.tags)?;
    let _ = thumbnail(root, &s.id, &safe(root, format!("sources/{}", s.file))?);
    Ok(s)
}
pub fn normalize_name(name: Option<String>) -> Outcome<Option<String>> {
    let name = name.unwrap_or_default().trim().to_string();
    if name.chars().count() > 200 {
        return Err("Names must be 200 characters or fewer".into());
    }
    Ok((!name.is_empty()).then_some(name))
}
pub fn update_source(
    root: &Path,
    id: &str,
    tags: Vec<String>,
    note: String,
    name: Option<String>,
) -> Outcome<()> {
    valid_id(id)?;
    let path = safe(root, format!("sources/{id}.json"))?;
    let mut s: Source = read(&path)?;
    if s.id != id {
        return Err("Source ID mismatch".into());
    }
    s.name = normalize_media_name(name, &s.file)?;
    s.tags = tags;
    s.note = note;
    write_json(&path, &s)?;
    add_tags(root, &s.tags)
}
fn validate_prompt(m: &PromptInput) -> Outcome<()> {
    if m.title.trim().is_empty() {
        Err("A prompt title is required".into())
    } else {
        Ok(())
    }
}
pub fn create_prompt(root: &Path, meta: PromptInput, text: String) -> Outcome<String> {
    marker(root)?;
    validate_prompt(&meta)?;
    let id = id(root)?;
    fs::create_dir(safe(root, format!("prompts/{id}"))?).map_err(err)?;
    fs::create_dir(safe(root, format!("prompts/{id}/results"))?).map_err(err)?;
    let m = PromptMeta {
        id: id.clone(),
        fields: meta,
        created_at: now(),
        updated_at: now(),
    };
    atomic_write(
        &safe(root, format!("prompts/{id}/prompt.md"))?,
        text.as_bytes(),
    )?;
    write_json(&safe(root, format!("prompts/{id}/meta.json"))?, &m)?;
    add_tags(root, &m.fields.needs)?;
    Ok(id)
}
pub fn update_prompt(root: &Path, id: &str, meta: PromptInput, text: String) -> Outcome<()> {
    valid_id(id)?;
    validate_prompt(&meta)?;
    let path = safe(root, format!("prompts/{id}/meta.json"))?;
    let mut m: PromptMeta = read(&path)?;
    if m.id != id {
        return Err("Prompt ID mismatch".into());
    }
    let new_needs: Vec<_> = meta
        .needs
        .iter()
        .filter(|t| !m.fields.needs.contains(t))
        .cloned()
        .collect();
    m.fields = meta;
    m.updated_at = now();
    atomic_write(
        &safe(root, format!("prompts/{id}/prompt.md"))?,
        text.as_bytes(),
    )?;
    write_json(&path, &m)?;
    add_tags(root, &new_needs)
}
pub fn add_result(
    root: &Path,
    prompt_id: &str,
    path: Option<&Path>,
    bytes: Option<&[u8]>,
    mut fields: ResultInput,
) -> Outcome<String> {
    fields.name = normalize_media_name(
        fields.name,
        path.and_then(|p| p.to_str()).unwrap_or("pasted.png"),
    )?;
    valid_id(prompt_id)?;
    let _: PromptMeta = read(&safe(root, format!("prompts/{prompt_id}/meta.json"))?)?;
    for sid in &fields.source_photos {
        valid_id(sid)?;
        let _: Source = read(&safe(root, format!("sources/{sid}.json"))?)?;
    }
    let id = id(root)?;
    let dir = format!("prompts/{prompt_id}/results");
    let (file, _) = copy_image(root, &dir, &id, path, bytes)?;
    fields.name = normalize_media_name(fields.name, &file)?;
    write_json(
        &safe(root, format!("{dir}/{id}.json"))?,
        &ResultMeta {
            kind: media_kind(&file),
            duration_seconds: media_duration(&safe(root, format!("{dir}/{file}"))?),
            id: id.clone(),
            file: file.clone(),
            fields,
            created_at: now(),
        },
    )?;
    let _ = thumbnail(root, &id, &safe(root, format!("{dir}/{file}"))?);
    Ok(id)
}
pub fn update_result(
    root: &Path,
    prompt_id: &str,
    id: &str,
    mut fields: ResultInput,
) -> Outcome<()> {
    valid_id(prompt_id)?;
    valid_id(id)?;
    let path = safe(root, format!("prompts/{prompt_id}/results/{id}.json"))?;
    let mut m: ResultMeta = read(&path)?;
    if m.id != id {
        return Err("Result ID mismatch".into());
    }
    for sid in &fields.source_photos {
        valid_id(sid)?;
    }
    fields.name = normalize_media_name(fields.name, &m.file)?;
    m.fields = fields;
    write_json(&path, &m)
}
pub fn trash_item(root: &Path, kind: &str, id: &str, prompt_id: Option<&str>) -> Outcome<()> {
    marker(root)?;
    valid_id(id)?;
    let mut paths = vec![];
    match kind {
        "prompt" => {
            let p = safe(root, format!("prompts/{id}"))?;
            let _: PromptMeta = read(&p.join("meta.json"))?;
            paths.push(p);
        }
        "source" => {
            let p = safe(root, format!("sources/{id}.json"))?;
            let m: Source = read(&p)?;
            image_name(id, &m.file)?;
            paths.push(safe(root, format!("sources/{}", m.file))?);
            paths.push(p);
        }
        "result" => {
            let pid = prompt_id.ok_or("Missing prompt ID")?;
            valid_id(pid)?;
            let dir = format!("prompts/{pid}/results");
            let p = safe(root, format!("{dir}/{id}.json"))?;
            let m: ResultMeta = read(&p)?;
            image_name(id, &m.file)?;
            paths.push(safe(root, format!("{dir}/{}", m.file))?);
            paths.push(p);
        }
        _ => return Err("Unknown item kind".into()),
    }
    paths.retain(|p| p.exists());
    trash::delete_all(paths).map_err(err)
}

#[cfg(test)]
mod tests;

// Cross-process lease for vocabulary writes and tag-wide metadata operations.
struct TagLock {
    path: PathBuf,
    token: String,
}
impl TagLock {
    fn renew(&self) -> Outcome<()> {
        if fs::read_to_string(&self.path).map_err(err)? != self.token {
            return Err("Tag lock ownership changed; retry shortly".into());
        }
        fs::File::options()
            .write(true)
            .open(&self.path)
            .map_err(err)?
            .set_times(fs::FileTimes::new().set_modified(std::time::SystemTime::now()))
            .map_err(err)
    }
    fn acquire(root: &Path) -> Outcome<Self> {
        use std::time::{Duration, Instant};
        let start = Instant::now();
        loop {
            let path = safe(root, ".prompt-gallery.lock")?;
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    let lock = Self {
                        path,
                        token: format!("{:016x}", rand::random::<u64>()),
                    };
                    if let Err(error) = file.write_all(lock.token.as_bytes()) {
                        drop(file);
                        let _ = fs::remove_file(&lock.path);
                        return Err(err(error));
                    }
                    return Ok(lock);
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let stale = fs::symlink_metadata(&path)
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.elapsed().ok())
                        .is_some_and(|age| age > Duration::from_secs(30));
                    if stale {
                        match fs::remove_file(&path) {
                            Ok(()) => continue,
                            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                            Err(e) => return Err(err(e)),
                        }
                    }
                    if start.elapsed() >= Duration::from_secs(5) {
                        return Err(
                            "Timed out waiting for .prompt-gallery.lock; retry shortly".into()
                        );
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(e) => return Err(err(e)),
            }
        }
    }
}
impl Drop for TagLock {
    fn drop(&mut self) {
        // Never remove a successor's lease if ours expired during a stalled process.
        if fs::read_to_string(&self.path).ok().as_deref() == Some(&self.token) {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ["mp4", "mov", "m4v"].contains(&e.to_ascii_lowercase().as_str()))
}
pub fn is_audio(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
        ["mp3", "m4a", "aac", "wav", "aif", "aiff", "flac"]
            .contains(&e.to_ascii_lowercase().as_str())
    })
}
pub fn is_streamed_media(path: &Path) -> bool {
    is_video(path) || is_audio(path)
}
fn media_kind(file: &str) -> Option<String> {
    if is_audio(Path::new(file)) {
        Some("audio".into())
    } else {
        is_video(Path::new(file)).then(|| "video".into())
    }
}
fn media_duration(path: &Path) -> Option<f64> {
    if !is_streamed_media(path) {
        return None;
    }
    let out = std::process::Command::new("/usr/bin/mdls")
        .args(["-raw", "-name", "kMDItemDurationSeconds"])
        .arg(path)
        .output()
        .ok()?;
    let n: f64 = String::from_utf8_lossy(&out.stdout).trim().parse().ok()?;
    (n.is_finite() && n >= 0.0).then_some(n)
}
pub fn normalize_media_name(name: Option<String>, file: &str) -> Outcome<Option<String>> {
    let mut name = name.unwrap_or_default().trim().to_string();
    if let Some(ext) = Path::new(file).extension().and_then(|s| s.to_str()) {
        let suffix = format!(".{ext}");
        while name.to_lowercase().ends_with(&suffix.to_lowercase()) {
            name.truncate(name.len() - suffix.len());
            name = name.trim().into();
        }
    }
    normalize_name(Some(name))
}
pub fn folder_name(name: &str) -> Outcome<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err("Folder names must contain 1–100 characters".into());
    }
    Ok(name.into())
}
pub fn create_folder(root: &Path, name: &str, reuse: bool) -> Outcome<Folder> {
    let name = folder_name(name)?;
    let _lock = TagLock::acquire(root)?;
    let mut m = marker(root)?;
    if let Some(f) = m
        .folders
        .iter()
        .find(|f| f.name.to_lowercase() == name.to_lowercase())
    {
        return if reuse {
            Ok(f.clone())
        } else {
            Err("Folder name already exists".into())
        };
    }
    let fid = loop {
        let candidate = id(root)?;
        if !m.folders.iter().any(|f| f.id == candidate) {
            break candidate;
        }
    };
    let folder = Folder {
        id: fid,
        name,
        created_at: now(),
    };
    m.folders.push(folder.clone());
    write_json(&safe(root, "library.json")?, &m)?;
    Ok(folder)
}
pub fn rename_folder(root: &Path, id: &str, name: &str) -> Outcome<()> {
    let name = folder_name(name)?;
    let _lock = TagLock::acquire(root)?;
    let mut m = marker(root)?;
    if m.folders
        .iter()
        .any(|f| f.id != id && f.name.to_lowercase() == name.to_lowercase())
    {
        return Err("Folder name already exists".into());
    }
    m.folders
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or("Folder not found")?
        .name = name;
    write_json(&safe(root, "library.json")?, &m)
}
pub fn move_sources(root: &Path, ids: &[String], folder: Option<String>) -> Outcome<()> {
    let lock = TagLock::acquire(root)?;
    let m = marker(root)?;
    if folder
        .as_ref()
        .is_some_and(|id| !m.folders.iter().any(|f| &f.id == id))
    {
        return Err("Folder not found".into());
    }
    let mut records = vec![];
    for id in ids {
        valid_id(id)?;
        let path = safe(root, format!("sources/{id}.json"))?;
        let mut value: serde_json::Value = read(&path)?;
        let source: Source = serde_json::from_value(value.clone()).map_err(err)?;
        if source.id != *id {
            return Err("Source ID mismatch".into());
        }
        if let Some(f) = &folder {
            value["folder"] = f.clone().into();
        } else {
            value.as_object_mut().unwrap().remove("folder");
        }
        records.push((path, value));
    }
    for (n, (path, value)) in records.iter().enumerate() {
        lock.renew()?;
        write_json(path, value)
            .map_err(|e| format!("{e}; {n} sources already moved; reload before retrying"))?;
    }
    Ok(())
}
pub fn delete_folder(root: &Path, id: &str) -> Outcome<()> {
    let lock = TagLock::acquire(root)?;
    let mut m = marker(root)?;
    if !m.folders.iter().any(|f| f.id == id) {
        return Err("Folder not found".into());
    }
    let mut warnings = vec![];
    let records = tag_records(root, &mut warnings, &lock)?;
    if !warnings.is_empty() {
        return Err(warnings.join("; "));
    }
    let mut count = 0;
    for (path, mut value, is_prompt) in records {
        lock.renew()?;
        if !is_prompt && value["folder"].as_str() == Some(id) {
            value.as_object_mut().unwrap().remove("folder");
            write_json(&path, &value)
                .map_err(|e| format!("{e}; {count} sources already unfiled"))?;
            count += 1;
        }
    }
    m.folders.retain(|f| f.id != id);
    write_json(&safe(root, "library.json")?, &m)
}
