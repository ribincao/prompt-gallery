//! CLI orchestration; all library writes belong to library.rs.
use crate::library::{self, Outcome, PromptInput, ResultInput};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
};

pub fn config_path() -> Outcome<PathBuf> {
    if let Some(p) = env::var_os("PROMPT_GALLERY_CONFIG_DIR") {
        return Ok(PathBuf::from(p).join("config.json"));
    }
    let home = env::var_os("HOME").ok_or("HOME is not set")?;
    Ok(
        PathBuf::from(home)
            .join("Library/Application Support/com.ribin.prompt-gallery/config.json"),
    )
}
fn normalized(s: &str) -> String {
    s.replace("\r\n", "\n").trim().into()
}
fn merge(target: &mut Vec<String>, values: Vec<String>) {
    for v in values {
        if !target.contains(&v) {
            target.push(v);
        }
    }
}
pub fn run(args: Vec<String>) -> Outcome<Value> {
    let mut options: HashMap<String, Vec<String>> = HashMap::new();
    let mut command = None;
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        if arg == "--json" {
            continue;
        }
        if arg.starts_with("--") {
            let value = it
                .next()
                .ok_or_else(|| format!("Missing value for {arg}"))?;
            options.entry(arg).or_default().push(value);
        } else if command.replace(arg).is_some() {
            return Err("Expected one command: where, tags, list, add".into());
        }
    }
    let command =
        command.ok_or("Usage: pgallery [--library DIR] <where|tags|list|add> [--json]")?;
    let allowed: &[&str] = match command.as_str() {
        "where" | "tags" => &[],
        "list" => &["--limit"],
        "add" => &[
            "--prompt-text",
            "--prompt-file",
            "--title",
            "--needs",
            "--tags",
            "--source-url",
            "--result",
            "--source",
            "--source-tags",
            "--chat-url",
            "--model",
            "--note",
        ],
        _ => return Err(format!("Unknown command: {command}")),
    };
    for (key, values) in &options {
        if key != "--library" && !allowed.contains(&key.as_str()) {
            return Err(format!("Unknown option: {key}"));
        }
        if values.len() > 1 && key != "--source" && key != "--result" {
            return Err(format!("{key} may only appear once"));
        }
    }
    let one = |key: &str| options.get(key).and_then(|v| v.first()).cloned();
    let many = |key: &str| options.get(key).cloned().unwrap_or_default();
    let tags = |key: &str| -> Vec<String> {
        one(key)
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect()
    };
    // Validate add arguments before initializing or changing a library.
    let text = if command == "add" {
        let text = match (one("--prompt-text"), one("--prompt-file")) {
            (Some(t), None) => t,
            (None, Some(p)) => fs::read_to_string(p).map_err(|e| e.to_string())?,
            _ => return Err("Provide exactly one of --prompt-text or --prompt-file".into()),
        };
        if normalized(&text).is_empty() {
            return Err("Prompt text must not be empty".into());
        }
        if many("--result").is_empty() {
            return Err("Provide at least one --result image".into());
        }
        for p in many("--result").into_iter().chain(
            many("--source")
                .into_iter()
                .filter(|s| library::valid_id(s).is_err()),
        ) {
            if !Path::new(&p).is_file() {
                return Err(format!("Image file not found: {p}"));
            }
            if !Path::new(&p)
                .extension()
                .and_then(|s| s.to_str())
                .is_some_and(|s| {
                    ["jpg", "jpeg", "png", "webp", "heic", "gif"]
                        .contains(&s.to_lowercase().as_str())
                })
            {
                return Err(format!("Unsupported image format: {p}"));
            }
        }
        Some(text)
    } else {
        None
    };
    let config = config_path()?;
    let path = if let Some(p) = one("--library").or_else(|| {
        env::var("PROMPT_GALLERY_LIBRARY")
            .ok()
            .filter(|s| !s.is_empty())
    }) {
        p
    } else if config.exists() {
        let value: Value = serde_json::from_slice(&fs::read(&config).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Cannot read config: {e}"))?;
        value["libraryPath"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    } else {
        String::new()
    };
    if path.is_empty() {
        return Err("No library set. Open Prompt Gallery once to choose a library, or pass --library <dir>.".into());
    }
    if command == "where" {
        return Ok(json!({"libraryPath": path, "configPath": config}));
    }
    let limit = one("--limit")
        .map(|s| {
            s.parse::<usize>()
                .map_err(|_| "--limit must be a non-negative integer".to_string())
        })
        .transpose()?
        .unwrap_or(usize::MAX);
    let root = if command == "add" {
        library::open_library(Path::new(&path), false)?
    } else {
        fs::canonicalize(&path).map_err(|e| e.to_string())?
    };
    if command == "tags" {
        return Ok(json!(library::marker(&root)?.tags));
    }
    let mut lib = library::load_library(&root)?;
    for warning in &lib.warnings {
        eprintln!("Warning: {warning}");
    }
    if command == "list" {
        return Ok(json!(lib
            .prompts
            .iter()
            .take(limit)
            .map(|p| json!({
                "id":p.meta.id, "title":p.meta.fields.title, "needs":p.meta.fields.needs,
                "tags":p.meta.fields.tags, "resultCount":p.results.len()
            }))
            .collect::<Vec<_>>()));
    }
    let text = text.unwrap();
    let mut source_ids = Vec::new();
    let mut sources = Vec::new();
    for input in many("--source") {
        let (id, reused) = if library::valid_id(&input).is_ok() {
            let source = lib
                .sources
                .iter()
                .find(|s| s.meta.id == input)
                .ok_or_else(|| format!("Source ID not found: {input}"))?;
            library::owned_file(&root, Path::new(&source.path))?;
            (input, true)
        } else {
            let bytes = fs::read(&input).map_err(|e| e.to_string())?;
            let found = lib.sources.iter().find(|s| {
                let path = Path::new(&s.path);
                library::owned_file(&root, path).is_ok()
                    && fs::metadata(path).is_ok_and(|m| m.len() == bytes.len() as u64)
                    && fs::read(path).is_ok_and(|b| b == bytes)
            });
            if let Some(s) = found {
                (s.meta.id.clone(), true)
            } else {
                let s = library::import_source(
                    &root,
                    Some(Path::new(&input)),
                    None,
                    tags("--source-tags"),
                )?;
                let id = s.id.clone();
                // Refresh so repeated paths in this invocation also deduplicate.
                lib = library::load_library(&root)?;
                (id, false)
            }
        };
        merge(&mut source_ids, vec![id.clone()]);
        sources.push(json!({"id":id,"reused":reused}));
    }
    let needs = tags("--needs");
    let new_tags = tags("--tags");
    let (pid, created) = if let Some(p) = lib
        .prompts
        .iter()
        .find(|p| normalized(&p.text) == normalized(&text))
    {
        let mut fields = p.meta.fields.clone();
        merge(&mut fields.needs, needs.clone());
        merge(&mut fields.tags, new_tags.clone());
        if fields.needs != p.meta.fields.needs || fields.tags != p.meta.fields.tags {
            library::update_prompt(&root, &p.meta.id, fields, p.text.clone())?;
        }
        (p.meta.id.clone(), false)
    } else {
        let title = one("--title").unwrap_or_else(|| {
            text.split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(40)
                .collect()
        });
        (
            library::create_prompt(
                &root,
                PromptInput {
                    title,
                    needs: needs.clone(),
                    tags: new_tags.clone(),
                    source_url: one("--source-url").unwrap_or_default(),
                    ..Default::default()
                },
                text,
            )?,
            true,
        )
    };
    library::set_tags(
        &root,
        needs
            .into_iter()
            .chain(new_tags)
            .chain(tags("--source-tags"))
            .collect(),
    )?;
    let fields = ResultInput {
        source_photos: source_ids.clone(),
        chat_url: one("--chat-url").unwrap_or_default(),
        model: one("--model").unwrap_or_else(|| "agent".into()),
        note: one("--note").unwrap_or_default(),
        ..Default::default()
    };
    let mut results = Vec::new();
    for p in many("--result") {
        results.push(
            library::add_result(&root, &pid, Some(Path::new(&p)), None, fields.clone()).map_err(
                |e| {
                    format!(
                        "{e}; {} results already saved to prompt {pid}",
                        results.len()
                    )
                },
            )?,
        );
    }
    Ok(
        json!({"promptId":pid,"created":created,"resultIds":results,"sourceIds":source_ids,"sources":sources}),
    )
}
