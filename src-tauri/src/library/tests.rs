use super::*;
use tempfile::tempdir;
fn meta() -> PromptInput {
    PromptInput {
        title: "Portrait".into(),
        needs: vec!["single".into()],
        ..Default::default()
    }
}
#[test]
fn round_trip_copy_and_exact_text() {
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    assert!(root.join("library.json").exists());
    assert!(root.join("sources").is_dir());
    assert!(root.join("prompts").is_dir());
    let input = tempdir().unwrap();
    let original = input.path().join("Photo.JPG");
    fs::write(&original, b"original bytes").unwrap();
    let s = import_source(&root, Some(&original), None, vec!["single".into()]).unwrap();
    assert_eq!(fs::read(&original).unwrap(), b"original bytes");
    assert_eq!(
        fs::read(root.join("sources").join(&s.file)).unwrap(),
        b"original bytes"
    );
    assert!(s.file.ends_with(".JPG"));
    let text = "  exact text\n\nwith trailing space \n";
    let p = create_prompt(&root, meta(), text.into()).unwrap();
    let rid = add_result(
        &root,
        &p,
        Some(&original),
        None,
        ResultInput {
            source_photos: vec![s.id.clone()],
            chat_url: "https://chatgpt.com/c/test".into(),
            model: "ChatGPT".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let lib = load_library(&root).unwrap();
    assert!(lib.warnings.is_empty());
    assert_eq!(lib.sources.len(), 1);
    assert_eq!(lib.prompts[0].text, text);
    assert_eq!(lib.prompts[0].results[0].meta.id, rid);
    assert_eq!(
        lib.prompts[0].results[0].meta.fields.source_photos,
        vec![s.id]
    );
}
#[test]
fn malformed_records_are_preserved_and_reported() {
    let d = tempdir().unwrap();
    let r = open_library(d.path(), false).unwrap();
    let p = r.join("sources/20261104-120000-abcd.json");
    fs::write(&p, b"{bad").unwrap();
    let lib = load_library(&r).unwrap();
    assert!(lib.sources.is_empty());
    assert!(lib
        .warnings
        .iter()
        .any(|w| w.contains("20261104-120000-abcd.json")));
    assert_eq!(fs::read(&p).unwrap(), b"{bad");
    assert!(update_source(&r, "20261104-120000-abcd", vec![], "".into(), None).is_err());
    assert_eq!(fs::read(&p).unwrap(), b"{bad");
}
#[test]
fn atomic_writes_leave_no_temp_files() {
    let d = tempdir().unwrap();
    let p = d.path().join("record.json");
    atomic_write(&p, b"first").unwrap();
    atomic_write(&p, b"second").unwrap();
    assert_eq!(fs::read(p).unwrap(), b"second");
    assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
}
#[test]
fn nonempty_confirmation_and_bad_marker() {
    let d = tempdir().unwrap();
    fs::write(d.path().join("keep.txt"), "keep").unwrap();
    assert_eq!(
        open_library(d.path(), false).unwrap_err(),
        "CONFIRM_NONEMPTY"
    );
    open_library(d.path(), true).unwrap();
    fs::write(d.path().join("library.json"), "broken").unwrap();
    assert!(open_library(d.path(), true).is_err());
    assert_eq!(
        fs::read_to_string(d.path().join("library.json")).unwrap(),
        "broken"
    );
}
#[test]
fn rejects_path_traversal_and_symlinks() {
    let d = tempdir().unwrap();
    let r = open_library(d.path(), false).unwrap();
    assert!(safe(&r, "../escape").is_err());
    assert!(valid_id("../../file").is_err());
    #[cfg(unix)]
    {
        let outside = tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), r.join("sources/link")).unwrap();
        assert!(safe(&r, "sources/link/test.json").is_err());
    }
}
#[test]
fn edits_and_missing_source_reference_roundtrip() {
    let d = tempdir().unwrap();
    let r = open_library(d.path(), false).unwrap();
    let sid = import_source(&r, None, Some(b"\x89PNG\r\n\x1a\nfake"), vec![])
        .unwrap()
        .id;
    update_source(&r, &sid, vec!["custom".into()], "note".into(), None).unwrap();
    let p = create_prompt(&r, meta(), "old".into()).unwrap();
    let mut m = meta();
    m.favorite = true;
    update_prompt(&r, &p, m, "new".into()).unwrap();
    let rid = add_result(
        &r,
        &p,
        None,
        Some(b"\x89PNG\r\n\x1a\nfake"),
        ResultInput {
            source_photos: vec![sid],
            ..Default::default()
        },
    )
    .unwrap();
    update_result(
        &r,
        &p,
        &rid,
        ResultInput {
            source_photos: vec!["20261104-120000-dead".into()],
            favorite: true,
            ..Default::default()
        },
    )
    .unwrap();
    let lib = load_library(&r).unwrap();
    assert!(lib.tags.contains(&"custom".into()));
    assert_eq!(lib.sources[0].meta.note, "note");
    assert_eq!(lib.prompts[0].text, "new");
    assert!(lib.prompts[0].meta.fields.favorite);
    assert!(lib.prompts[0].results[0].meta.fields.favorite);
}

#[test]
fn metadata_matches_spec_without_ui_fields() {
    let d = tempdir().unwrap();
    let r = open_library(d.path(), false).unwrap();
    let s = import_source(&r, None, Some(b"\x89PNG\r\n\x1a\nfake"), vec![]).unwrap();
    let json: serde_json::Value = read(&r.join(format!("sources/{}.json", s.id))).unwrap();
    let keys: Vec<_> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        ["createdAt", "file", "id", "note", "originalName", "tags"]
    );
    let p = create_prompt(&r, meta(), "text".into()).unwrap();
    let json: serde_json::Value = read(&r.join(format!("prompts/{p}/meta.json"))).unwrap();
    assert!(json.get("fields").is_none());
    assert!(json.get("sourceUrl").is_some());
    assert!(json.get("updatedAt").is_some());
    assert!(json.get("text").is_none());
}

#[test]
fn corrupt_prompts_and_results_do_not_hide_valid_items() {
    let d = tempdir().unwrap();
    let r = open_library(d.path(), false).unwrap();
    let good = create_prompt(&r, meta(), "valid".into()).unwrap();
    let bad = create_prompt(&r, meta(), "invalid metadata".into()).unwrap();
    let bad_meta = r.join(format!("prompts/{bad}/meta.json"));
    fs::write(&bad_meta, "{bad").unwrap();
    let bad_result = r.join(format!("prompts/{good}/results/20261104-120000-abcd.json"));
    fs::write(&bad_result, "{bad").unwrap();
    let lib = load_library(&r).unwrap();
    assert_eq!(lib.prompts.len(), 1);
    assert_eq!(lib.prompts[0].meta.id, good);
    assert_eq!(lib.warnings.len(), 2);
    assert!(update_prompt(&r, &bad, meta(), "replacement".into()).is_err());
    assert_eq!(fs::read_to_string(bad_meta).unwrap(), "{bad");
    assert_eq!(fs::read_to_string(bad_result).unwrap(), "{bad");
}

#[test]
fn failed_atomic_write_cleans_only_its_own_temporary_file() {
    let d = tempdir().unwrap();
    let target = d.path().join("directory");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("keep"), "untouched").unwrap();
    assert!(atomic_write(&target, b"replacement").is_err());
    assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    assert_eq!(
        fs::read_to_string(target.join("keep")).unwrap(),
        "untouched"
    );
}

#[test]
fn dotfiles_and_hidden_directories_are_ignored_in_every_scan() {
    let d = tempdir().unwrap();
    let root = open_library(d.path(), false).unwrap();
    let p = create_prompt(&root, meta(), "valid".into()).unwrap();
    let s = import_source(&root, None, Some(b"\x89PNG\r\n\x1a\nfake"), vec![]).unwrap();
    let result = add_result(
        &root,
        &p,
        None,
        Some(b"\x89PNG\r\n\x1a\nfake"),
        ResultInput::default(),
    )
    .unwrap();
    for dir in [
        "sources".to_string(),
        "prompts".to_string(),
        format!("prompts/{p}/results"),
    ] {
        for hidden in [
            ".DS_Store",
            "._20261104-120000-abcd.json",
            ".write-incomplete.tmp",
        ] {
            fs::write(root.join(&dir).join(hidden), "not JSON").unwrap();
        }
        fs::create_dir(root.join(&dir).join(".hidden-folder")).unwrap();
    }
    let lib = load_library(&root).unwrap();
    assert!(lib.warnings.is_empty(), "{:?}", lib.warnings);
    assert_eq!(lib.sources[0].meta.id, s.id);
    assert_eq!(lib.prompts[0].meta.id, p);
    assert_eq!(lib.prompts[0].results[0].meta.id, result);
    assert!(root.join("prompts/.DS_Store").exists());
}

#[test]
fn stale_tag_lock_is_replaced() {
    use std::time::{Duration, SystemTime};
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    let path = root.join(".prompt-gallery.lock");
    fs::write(&path, "abandoned").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(SystemTime::now() - Duration::from_secs(31)))
        .unwrap();
    set_tags(&root, vec!["new".into()]).unwrap();
    assert!(marker(&root).unwrap().tags.contains(&"new".into()));
    assert!(!path.exists());
}
#[test]
fn simultaneous_tag_merges_keep_both() {
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let threads: Vec<_> = ["alpha", "beta"]
        .into_iter()
        .map(|tag| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                set_tags(&root, vec![tag.into()]).unwrap();
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    let tags = marker(&root).unwrap().tags;
    assert!(tags.contains(&"alpha".into()) && tags.contains(&"beta".into()));
    assert!(!root.join(".prompt-gallery.lock").exists());
}

#[test]
fn tag_lock_released_on_error() {
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    fs::write(root.join("library.json"), "corrupt").unwrap();
    assert!(set_tags(&root, vec!["tag".into()]).is_err());
    assert!(!root.join(".prompt-gallery.lock").exists());
    assert_eq!(
        fs::read_to_string(root.join("library.json")).unwrap(),
        "corrupt"
    );
}

fn tag_fixture(root: &Path) -> (Source, String) {
    let source = import_source(
        root,
        None,
        Some(b"\x89PNG\r\n\x1a\nfake"),
        vec!["old".into(), "target".into()],
    )
    .unwrap();
    let prompt = create_prompt(
        root,
        PromptInput {
            title: "Tagged".into(),
            needs: vec!["old".into(), "target".into()],
            tags: vec!["old".into(), "target".into(), "orphan".into()],
            ..Default::default()
        },
        "exact text".into(),
    )
    .unwrap();
    (source, prompt)
}
#[test]
fn remove_tag_strips_all_fields_and_stays_removed_on_load() {
    let d = tempdir().unwrap();
    let root = open_library(d.path(), false).unwrap();
    let (s, p) = tag_fixture(&root);
    let result_id = add_result(
        &root,
        &p,
        None,
        Some(b"\x89PNG\r\n\x1a\nfake"),
        ResultInput::default(),
    )
    .unwrap();
    let result = remove_tag(&root, "old").unwrap();
    assert_eq!((result.sources, result.prompts), (1, 1));
    let lib = load_library(&root).unwrap();
    assert!(!lib.tags.contains(&"old".into()));
    assert_eq!(lib.sources[0].meta.tags, vec!["target"]);
    assert_eq!(lib.prompts[0].meta.fields.needs, vec!["target"]);
    assert_eq!(lib.prompts[0].meta.fields.tags, vec!["target", "orphan"]);
    assert_eq!(lib.prompts[0].results[0].meta.id, result_id);
    assert!(root.join(format!("sources/{}", s.file)).exists());
    assert_eq!(
        fs::read_to_string(root.join(format!("prompts/{p}/prompt.md"))).unwrap(),
        "exact text"
    );
    assert_eq!(remove_tag(&root, "old").unwrap().prompts, 0);
}
#[test]
fn rename_tag_replaces_everywhere_and_rejects_empty_names() {
    let d = tempdir().unwrap();
    let root = open_library(d.path(), false).unwrap();
    tag_fixture(&root);
    let change = rename_tag(&root, "old", " new ").unwrap();
    assert_eq!((change.sources, change.prompts), (1, 1));
    let lib = load_library(&root).unwrap();
    assert!(lib.tags.contains(&"new".into()));
    assert!(!lib.tags.contains(&"old".into()));
    assert_eq!(lib.sources[0].meta.tags, vec!["new", "target"]);
    assert_eq!(lib.prompts[0].meta.fields.needs, vec!["new", "target"]);
    assert_eq!(
        lib.prompts[0].meta.fields.tags,
        vec!["new", "target", "orphan"]
    );
    assert!(rename_tag(&root, "new", "  ").is_err());
    assert!(rename_tag(&root, "", "new").is_err());
}
#[test]
fn merge_tag_deduplicates_and_preserves_order() {
    let d = tempdir().unwrap();
    let root = open_library(d.path(), false).unwrap();
    tag_fixture(&root);
    rename_tag(&root, "old", "target").unwrap();
    let lib = load_library(&root).unwrap();
    assert_eq!(lib.tags.iter().filter(|t| *t == "target").count(), 1);
    assert_eq!(lib.sources[0].meta.tags, vec!["target"]);
    assert_eq!(lib.prompts[0].meta.fields.needs, vec!["target"]);
    assert_eq!(lib.prompts[0].meta.fields.tags, vec!["target", "orphan"]);
}
#[test]
fn tag_counts_include_orphans_and_count_prompt_once_without_loading_media() {
    let d = tempdir().unwrap();
    let root = open_library(d.path(), false).unwrap();
    let (_, p) = tag_fixture(&root);
    fs::remove_file(root.join(format!("prompts/{p}/prompt.md"))).unwrap();
    let counts = tag_usage(&root).unwrap();
    let old = counts.iter().find(|r| r.tag == "old").unwrap();
    assert_eq!((old.sources, old.prompts), (1, 1));
    assert_eq!(
        counts.iter().find(|r| r.tag == "orphan").unwrap().prompts,
        1
    );
    assert_eq!(
        counts.iter().find(|r| r.tag == "single").unwrap().prompts,
        0
    );
    assert!(!marker(&root).unwrap().tags.contains(&"orphan".into()));
    rename_tag(&root, "orphan", "rescued").unwrap();
    assert!(marker(&root).unwrap().tags.contains(&"rescued".into()));
}
#[test]
fn tag_operations_wait_for_lock() {
    for op in 0..3 {
        let d = tempdir().unwrap();
        let root = open_library(d.path(), false).unwrap();
        let lock = TagLock::acquire(&root).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let thread_root = root.clone();
        let thread = std::thread::spawn(move || {
            match op {
                0 => {
                    tag_usage(&thread_root).unwrap();
                }
                1 => {
                    remove_tag(&thread_root, "single").unwrap();
                }
                _ => {
                    rename_tag(&thread_root, "single", "solo").unwrap();
                }
            }
            tx.send(()).unwrap();
        });
        assert!(rx
            .recv_timeout(std::time::Duration::from_millis(100))
            .is_err());
        drop(lock);
        rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap();
        thread.join().unwrap();
        assert!(!root.join(".prompt-gallery.lock").exists());
    }
}
#[test]
fn tag_mutation_reports_skips_and_preserves_corrupt_records() {
    let d = tempdir().unwrap();
    let root = open_library(d.path(), false).unwrap();
    tag_fixture(&root);
    let corrupt = root.join("sources/20261104-120000-abcd.json");
    fs::write(&corrupt, "{broken").unwrap();
    let change = remove_tag(&root, "old").unwrap();
    assert_eq!(change.warnings.len(), 1);
    assert!(change.warnings[0].contains("Skipped"));
    assert_eq!(fs::read_to_string(corrupt).unwrap(), "{broken");
}
#[test]
#[cfg(unix)]
fn tag_mutation_stops_with_partial_count_on_write_failure() {
    use std::os::unix::fs::PermissionsExt;
    let d = tempdir().unwrap();
    let root = open_library(d.path(), false).unwrap();
    let (_, p) = tag_fixture(&root);
    let folder = root.join(format!("prompts/{p}"));
    let original = fs::metadata(&folder).unwrap().permissions();
    fs::set_permissions(&folder, fs::Permissions::from_mode(0o555)).unwrap();
    let result = remove_tag(&root, "old");
    fs::set_permissions(&folder, original).unwrap();
    let error = result.unwrap_err();
    assert!(
        error.contains("1 records already updated (1 photos, 0 prompts)"),
        "{error}"
    );
    let lib = load_library(&root).unwrap();
    assert!(!lib.sources[0].meta.tags.contains(&"old".into()));
    assert!(lib.prompts[0].meta.fields.needs.contains(&"old".into()));
    assert!(lib.tags.contains(&"old".into()));
    assert!(!root.join(".prompt-gallery.lock").exists());
    assert_eq!(remove_tag(&root, "old").unwrap().prompts, 1);
}
#[test]
fn prompt_update_does_not_restore_missing_existing_needs_to_vocabulary() {
    let d = tempdir().unwrap();
    let root = open_library(d.path(), false).unwrap();
    let p = create_prompt(&root, meta(), "text".into()).unwrap();
    let mut marker = marker(&root).unwrap();
    marker.tags.retain(|t| t != "single");
    write_json(&root.join("library.json"), &marker).unwrap();
    let mut input = meta();
    input.tags.push("x".into());
    update_prompt(&root, &p, input, "text".into()).unwrap();
    assert!(!load_library(&root).unwrap().tags.contains(&"single".into()));
}

#[test]
fn display_names_preserve_storage_links_and_legacy_json() {
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    let s = import_source(
        &root,
        None,
        Some(b"\x89PNG\r\n\x1a\nsource bytes"),
        vec!["pet".into()],
    )
    .unwrap();
    let pid = create_prompt(&root, meta(), "prompt".into()).unwrap();
    let fields = ResultInput {
        source_photos: vec![s.id.clone()],
        note: "keep note".into(),
        ..Default::default()
    };
    let rid = add_result(
        &root,
        &pid,
        None,
        Some(b"\x89PNG\r\n\x1a\nresult bytes"),
        fields.clone(),
    )
    .unwrap();
    let sp = root.join(format!("sources/{}.json", s.id));
    let rp = root.join(format!("prompts/{pid}/results/{rid}.json"));
    // These records have the legacy shape: no name field at all.
    let before = [fs::read(&sp).unwrap(), fs::read(&rp).unwrap()];
    let modified = [
        fs::metadata(&sp).unwrap().modified().unwrap(),
        fs::metadata(&rp).unwrap().modified().unwrap(),
    ];
    assert!(!String::from_utf8_lossy(&before[0]).contains("\"name\""));
    assert!(!String::from_utf8_lossy(&before[1]).contains("\"name\""));
    let lib = load_library(&root).unwrap();
    assert_eq!(lib.sources[0].meta.name, None);
    assert_eq!(lib.prompts[0].results[0].meta.fields.name, None);
    for (i, p) in [&sp, &rp].iter().enumerate() {
        assert_eq!(fs::read(p).unwrap(), before[i]);
        assert_eq!(fs::metadata(p).unwrap().modified().unwrap(), modified[i]);
    }
    let thumb = root.join(format!(".thumbs/{}.jpg", s.id));
    fs::write(&thumb, b"existing thumbnail").unwrap();
    update_source(
        &root,
        &s.id,
        s.tags.clone(),
        s.note.clone(),
        Some("  Kujira in a bucket  ".into()),
    )
    .unwrap();
    update_result(
        &root,
        &pid,
        &rid,
        ResultInput {
            name: Some("  Painted Kujira  ".into()),
            ..fields.clone()
        },
    )
    .unwrap();
    let loaded: Source = read(&sp).unwrap();
    let result: ResultMeta = read(&rp).unwrap();
    assert_eq!(loaded.name.as_deref(), Some("Kujira in a bucket"));
    assert_eq!(result.fields.name.as_deref(), Some("Painted Kujira"));
    assert_eq!(loaded.original_name, s.original_name);
    assert_eq!(loaded.file, s.file);
    assert_eq!(loaded.id, s.id);
    assert_eq!(result.file, format!("{rid}.png"));
    assert_eq!(result.fields.source_photos, fields.source_photos);
    assert_eq!(result.fields.note, "keep note");
    assert_eq!(
        fs::read(root.join("sources").join(&s.file)).unwrap(),
        b"\x89PNG\r\n\x1a\nsource bytes"
    );
    assert_eq!(
        fs::read(root.join(format!("prompts/{pid}/results/{}", result.file))).unwrap(),
        b"\x89PNG\r\n\x1a\nresult bytes"
    );
    assert_eq!(fs::read(&thumb).unwrap(), b"existing thumbnail");
    let named = [fs::read(&sp).unwrap(), fs::read(&rp).unwrap()];
    assert!(update_source(
        &root,
        &s.id,
        vec![],
        "changed".into(),
        Some("a".repeat(201))
    )
    .is_err());
    assert!(update_result(
        &root,
        &pid,
        &rid,
        ResultInput {
            name: Some("a".repeat(201)),
            ..fields.clone()
        }
    )
    .is_err());
    assert_eq!(fs::read(&sp).unwrap(), named[0]);
    assert_eq!(fs::read(&rp).unwrap(), named[1]);
    update_source(&root, &s.id, s.tags, s.note, Some(" \n ".into())).unwrap();
    update_result(
        &root,
        &pid,
        &rid,
        ResultInput {
            name: Some("   ".into()),
            ..fields
        },
    )
    .unwrap();
    for p in [sp, rp] {
        let value: serde_json::Value = read(&p).unwrap();
        assert!(value.get("name").is_none());
    }
}

#[test]
fn names_count_unicode_characters_after_trimming() {
    assert_eq!(
        normalize_name(Some(format!("  {}  ", "猫".repeat(200)))).unwrap(),
        Some("猫".repeat(200))
    );
    assert!(normalize_name(Some("🐈".repeat(201))).is_err());
    assert_eq!(normalize_name(None).unwrap(), None);
}

#[test]
fn virtual_folders_are_metadata_only_and_locked() {
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    let old: LibraryMeta =
        serde_json::from_str(r#"{"app":"prompt-gallery","version":1,"tags":[]}"#).unwrap();
    assert!(old.folders.is_empty());
    let a = create_folder(&root, " Family ", false).unwrap();
    assert_eq!(a.name, "Family");
    valid_id(&a.id).unwrap();
    assert!(create_folder(&root, "family", false).is_err());
    assert!(create_folder(&root, " ", false).is_err());
    assert!(create_folder(&root, &"a".repeat(101), false).is_err());
    let b = create_folder(&root, "Work", false).unwrap();
    assert!(rename_folder(&root, &b.id, "FAMILY").is_err());
    rename_folder(&root, &a.id, "Home").unwrap();
    let s = import_source(&root, None, Some(b"\x89PNG\r\n\x1a\nfirst"), vec![]).unwrap();
    let t = import_source(&root, None, Some(b"\x89PNG\r\n\x1a\nsecond"), vec![]).unwrap();
    let original = fs::read(root.join("sources").join(&s.file)).unwrap();
    move_sources(&root, &[s.id.clone(), t.id.clone()], Some(a.id.clone())).unwrap();
    assert!(load_library(&root)
        .unwrap()
        .sources
        .iter()
        .all(|s| s.meta.folder.as_ref() == Some(&a.id)));
    delete_folder(&root, &a.id).unwrap();
    assert!(load_library(&root)
        .unwrap()
        .sources
        .iter()
        .all(|s| s.meta.folder.is_none()));
    assert_eq!(
        fs::read(root.join("sources").join(&s.file)).unwrap(),
        original
    );
    let lock = TagLock::acquire(&root).unwrap();
    let root2 = root.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let thread = std::thread::spawn(move || {
        tx.send(create_folder(&root2, "Waits", false)).unwrap();
    });
    assert!(rx
        .recv_timeout(std::time::Duration::from_millis(100))
        .is_err());
    drop(lock);
    assert!(rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap()
        .is_ok());
    thread.join().unwrap();
}
#[test]
fn video_import_and_extension_free_names_preserve_originals() {
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    let input = tempdir().unwrap();
    let movie = input.path().join("Clip.MOV");
    fs::write(&movie, b"video fixture").unwrap();
    let s = import_source(&root, Some(&movie), None, vec![]).unwrap();
    assert_eq!(s.kind.as_deref(), Some("video"));
    update_source(&root, &s.id, vec![], "".into(), Some(" Travel.mov ".into())).unwrap();
    let loaded = load_library(&root).unwrap();
    assert_eq!(loaded.sources[0].meta.name.as_deref(), Some("Travel"));
    assert_eq!(loaded.sources[0].meta.original_name, "Clip.MOV");
    let pid = create_prompt(&root, meta(), "movie".into()).unwrap();
    let rid = add_result(
        &root,
        &pid,
        Some(&movie),
        None,
        ResultInput {
            name: Some("Film.MOV".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let loaded = load_library(&root).unwrap();
    let r = &loaded.prompts[0].results[0].meta;
    assert_eq!(r.fields.name.as_deref(), Some("Film"));
    assert_eq!(r.kind.as_deref(), Some("video"));
    update_result(
        &root,
        &pid,
        &rid,
        ResultInput {
            name: Some("Edited.mov".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        load_library(&root).unwrap().prompts[0].results[0]
            .meta
            .fields
            .name
            .as_deref(),
        Some("Edited")
    );
    assert_eq!(
        normalize_media_name(Some("archive.v2.JPG".into()), "x.jpg")
            .unwrap()
            .as_deref(),
        Some("archive.v2")
    );
    assert_eq!(fs::read(movie).unwrap(), b"video fixture");
}

#[test]
fn thumbnail_timeout_kills_and_reaps_child() {
    let mut child = std::process::Command::new("/bin/sleep")
        .arg("30")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let started = std::time::Instant::now();
    assert!(
        wait_with_timeout(&mut child, std::time::Duration::from_millis(60))
            .unwrap()
            .is_none()
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
    // try_wait returns the cached reaped exit status rather than a running process.
    assert!(!child.try_wait().unwrap().unwrap().success());
}
#[test]
fn thumbnail_child_success_does_not_wait_for_timeout() {
    let mut child = std::process::Command::new("/usr/bin/true").spawn().unwrap();
    assert!(
        wait_with_timeout(&mut child, std::time::Duration::from_secs(1))
            .unwrap()
            .unwrap()
            .success()
    );
}
#[test]
fn missing_video_posters_are_attempted_once_per_session_and_library() {
    let attempts = std::sync::Mutex::new(std::collections::HashSet::new());
    let a = Path::new("/tmp/library-a/.thumbs/item.jpg");
    let b = Path::new("/tmp/library-b/.thumbs/item.jpg");
    assert!(claim_poster_attempt(&attempts, a));
    assert!(!claim_poster_attempt(&attempts, a));
    assert!(claim_poster_attempt(&attempts, b));
}

#[test]
fn audio_formats_import_as_sources_and_linked_results_without_changing_images() {
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    let inputs = tempdir().unwrap();
    let pid = create_prompt(&root, meta(), "Generate speech".into()).unwrap();
    for ext in ["MP3", "m4a", "AAC", "wav", "aif", "AIFF", "flac"] {
        let path = inputs.path().join(format!("Voice.{ext}"));
        fs::write(&path, b"audio fixture").unwrap();
        let source = import_source(&root, Some(&path), None, vec!["speech".into()]).unwrap();
        assert_eq!(source.kind.as_deref(), Some("audio"));
        let rid = add_result(
            &root,
            &pid,
            Some(&path),
            None,
            ResultInput {
                source_photos: vec![source.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        let loaded = load_library(&root).unwrap();
        let result = loaded.prompts[0]
            .results
            .iter()
            .find(|r| r.meta.id == rid)
            .unwrap();
        assert_eq!(result.meta.kind.as_deref(), Some("audio"));
        assert_eq!(result.meta.fields.source_photos, vec![source.id]);
        assert_eq!(fs::read(&path).unwrap(), b"audio fixture");
    }
    let image = import_source(&root, None, Some(b"\x89PNG\r\n\x1a\n"), vec![]).unwrap();
    assert_eq!(image.kind, None);
    assert_eq!(image.duration_seconds, None);
    let json: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("sources").join(format!("{}.json", image.id))).unwrap(),
    )
    .unwrap();
    assert!(json.get("kind").is_none());
}
