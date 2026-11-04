use serde_json::Value;
use std::{
    fs,
    process::{Command, Output},
};
use tempfile::{tempdir, TempDir};

fn run(config: &TempDir, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_pgallery"))
        .env("PROMPT_GALLERY_DISABLE_POSTERS", "1")
        .env_remove("PROMPT_GALLERY_LIBRARY")
        .env("PROMPT_GALLERY_CONFIG_DIR", config.path())
        .args(args)
        .output()
        .unwrap()
}
fn ok(config: &TempDir, args: &[&str]) -> Value {
    let out = run(config, args);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}
#[test]
fn add_matches_deduplicates_and_preserves_metadata() {
    let config = tempdir().unwrap();
    let library = tempdir().unwrap();
    let inputs = tempdir().unwrap();
    let image = inputs.path().join("image.png");
    let duplicate = inputs.path().join("duplicate.png");
    // Real 1x1 PNG, so the executable can generate thumbnails on macOS.
    let png: &[u8] = &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4,
        0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248, 15, 0, 1, 5,
        1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];
    fs::write(&image, png).unwrap();
    fs::write(&duplicate, png).unwrap();
    let root = library.path().to_str().unwrap();
    let image = image.to_str().unwrap();
    let first = ok(
        &config,
        &[
            "add",
            "--library",
            root,
            "--json",
            "--prompt-text",
            "  hello\r\nworld  ",
            "--title",
            "Original",
            "--result",
            image,
            "--source",
            image,
            "--source-tags",
            "reference",
            "--tags",
            "style",
            "--needs",
            "custom",
            "--model",
            "test-model",
            "--note",
            "result note",
        ],
    );
    assert_eq!(first["created"], true);
    let sid = first["sourceIds"][0].as_str().unwrap();
    let second = ok(
        &config,
        &[
            "--library",
            root,
            "add",
            "--json",
            "--prompt-text",
            "hello\nworld",
            "--title",
            "Ignored",
            "--source-url",
            "https://ignored.example",
            "--result",
            image,
            "--source",
            duplicate.to_str().unwrap(),
            "--source",
            sid,
            "--tags",
            "second",
            "--needs",
            "other",
        ],
    );
    assert_eq!(second["created"], false);
    assert_eq!(first["promptId"], second["promptId"]);
    assert_eq!(second["sourceIds"].as_array().unwrap().len(), 1);
    assert!(second["sources"]
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["reused"] == true));
    let list = ok(&config, &["--library", root, "list", "--json"]);
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["resultCount"], 2);
    assert_eq!(list[0]["title"], "Original");
    let lib = prompt_gallery_lib::library::load_library(library.path()).unwrap();
    assert_eq!(lib.prompts[0].text, "  hello\r\nworld  ");
    assert_eq!(lib.prompts[0].meta.fields.source_url, "");
    assert_eq!(lib.sources.len(), 1);
    assert_eq!(fs::read(image).unwrap(), png);
    for tag in ["reference", "style", "custom", "second", "other"] {
        assert!(lib.tags.contains(&tag.into()));
    }
    assert!(lib.prompts[0]
        .results
        .iter()
        .all(|r| r.meta.fields.source_photos == [sid]));
    let vocabulary = ok(&config, &["--library", root, "tags", "--json"]);
    assert!(vocabulary
        .as_array()
        .unwrap()
        .contains(&Value::from("second")));
    assert_eq!(
        ok(
            &config,
            &["--library", root, "list", "--limit", "0", "--json"]
        ),
        serde_json::json!([])
    );
}
#[test]
fn resolution_and_errors() {
    let config = tempdir().unwrap();
    let missing = run(&config, &["list", "--json"]);
    assert!(!missing.status.success());
    assert!(
        serde_json::from_slice::<Value>(&missing.stderr).unwrap()["error"]
            .as_str()
            .unwrap()
            .contains("--library")
    );
    let library = tempdir().unwrap();
    fs::write(
        config.path().join("config.json"),
        serde_json::json!({"libraryPath":library.path()}).to_string(),
    )
    .unwrap();
    let where_ = ok(&config, &["where", "--json"]);
    assert_eq!(where_["libraryPath"], library.path().to_str().unwrap());
    assert_eq!(
        where_["configPath"],
        config.path().join("config.json").to_str().unwrap()
    );
    let override_ = tempdir().unwrap();
    assert_eq!(
        ok(
            &config,
            &[
                "where",
                "--library",
                override_.path().to_str().unwrap(),
                "--json"
            ]
        )["libraryPath"],
        override_.path().to_str().unwrap()
    );
    let env_out = Command::new(env!("CARGO_BIN_EXE_pgallery"))
        .env("PROMPT_GALLERY_DISABLE_POSTERS", "1")
        .env("PROMPT_GALLERY_CONFIG_DIR", config.path())
        .env("PROMPT_GALLERY_LIBRARY", override_.path())
        .args(["where", "--json"])
        .output()
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&env_out.stdout).unwrap()["libraryPath"],
        override_.path().to_str().unwrap()
    );
    for args in [
        vec!["add", "--prompt-text", "x", "--prompt-file", "x"],
        vec!["add", "--prompt-text", "x"],
        vec!["list", "--limit", "bad"],
        vec!["tags", "--unknown", "x"],
    ] {
        assert!(!run(&config, &args).status.success());
    }
    assert!(!library.path().join("library.json").exists());
}

#[test]
fn concurrent_processes_merge_tags_and_prompt_file_is_exact() {
    let config = tempdir().unwrap();
    let dir = tempdir().unwrap();
    let inputs = tempdir().unwrap();
    prompt_gallery_lib::library::open_library(dir.path(), false).unwrap();
    let image = inputs.path().join("result.png");
    fs::write(&image, b"test image bytes").unwrap();
    let prompt_file = inputs.path().join("prompt.txt");
    fs::write(&prompt_file, " exact\r\nfile text ").unwrap();
    let children: Vec<_> = ["alpha", "beta"]
        .into_iter()
        .map(|tag| {
            Command::new(env!("CARGO_BIN_EXE_pgallery"))
                .env("PROMPT_GALLERY_DISABLE_POSTERS", "1")
                .env_remove("PROMPT_GALLERY_LIBRARY")
                .env("PROMPT_GALLERY_CONFIG_DIR", config.path())
                .args([
                    "--library",
                    dir.path().to_str().unwrap(),
                    "add",
                    "--json",
                    "--prompt-file",
                    prompt_file.to_str().unwrap(),
                    "--result",
                    image.to_str().unwrap(),
                    "--tags",
                    tag,
                ])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap()
        })
        .collect();
    for child in children {
        let out = child.wait_with_output().unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let _: Value = serde_json::from_slice(&out.stdout).unwrap();
    }
    let lib = prompt_gallery_lib::library::load_library(dir.path()).unwrap();
    assert!(lib.tags.contains(&"alpha".into()) && lib.tags.contains(&"beta".into()));
    assert_eq!(
        lib.prompts.iter().map(|p| p.results.len()).sum::<usize>(),
        2
    );
    assert!(lib.prompts.iter().all(|p| p.text == " exact\r\nfile text "));
}

#[test]
fn cli_tags_follow_removal_rename_and_explicit_add() {
    use prompt_gallery_lib::library;
    let config = tempdir().unwrap();
    let dir = tempdir().unwrap();
    let root = library::open_library(dir.path(), false).unwrap();
    library::remove_tag(&root, "single").unwrap();
    library::rename_tag(&root, "couple", "duo").unwrap();
    let tags = ok(&config, &["tags", "--library", root.to_str().unwrap()]);
    assert!(!tags
        .as_array()
        .unwrap()
        .contains(&serde_json::json!("single")));
    assert!(!tags
        .as_array()
        .unwrap()
        .contains(&serde_json::json!("couple")));
    assert!(tags.as_array().unwrap().contains(&serde_json::json!("duo")));
    let input = tempdir().unwrap();
    let image = input.path().join("test.png");
    fs::write(&image, b"\x89PNG\r\n\x1a\nfake").unwrap();
    ok(
        &config,
        &[
            "add",
            "--library",
            root.to_str().unwrap(),
            "--prompt-text",
            "test",
            "--tags",
            "x",
            "--result",
            image.to_str().unwrap(),
        ],
    );
    let tags = ok(&config, &["tags", "--library", root.to_str().unwrap()]);
    assert!(tags.as_array().unwrap().contains(&serde_json::json!("x")));
    assert!(!tags
        .as_array()
        .unwrap()
        .contains(&serde_json::json!("single")));
}

#[test]
fn name_flags_pair_paths_and_preserve_reused_sources() {
    use prompt_gallery_lib::library;
    let config = tempdir().unwrap();
    let dir = tempdir().unwrap();
    let inputs = tempdir().unwrap();
    let a = inputs.path().join("a.png");
    let b = inputs.path().join("b.png");
    fs::write(&a, b"image a").unwrap();
    fs::write(&b, b"image b").unwrap();
    let root = dir.path().to_str().unwrap();
    let a = a.to_str().unwrap();
    let b = b.to_str().unwrap();
    let first = ok(
        &config,
        &[
            "add",
            "--library",
            root,
            "--prompt-text",
            "names",
            "--result",
            a,
            "--source",
            a,
            "--source-name",
            "  Original cat  ",
        ],
    );
    let sid = first["sourceIds"][0].as_str().unwrap();
    let second = ok(
        &config,
        &[
            "add",
            "--library",
            root,
            "--prompt-text",
            "names",
            "--result",
            a,
            "--result",
            b,
            "--result-name",
            "  First painting  ",
            "--result-name",
            "Second painting",
            "--source",
            sid,
            "--source",
            a,
            "--source",
            b,
            "--source-name",
            "Must not overwrite",
            "--source-name",
            "New cat",
        ],
    );
    let lib = library::load_library(dir.path()).unwrap();
    assert_eq!(
        lib.sources
            .iter()
            .find(|s| s.meta.id == sid)
            .unwrap()
            .meta
            .name
            .as_deref(),
        Some("Original cat")
    );
    assert_eq!(
        lib.sources
            .iter()
            .find(|s| s.meta.id != sid)
            .unwrap()
            .meta
            .name
            .as_deref(),
        Some("New cat")
    );
    for (i, name) in ["First painting", "Second painting"].iter().enumerate() {
        let rid = second["resultIds"][i].as_str().unwrap();
        assert_eq!(
            lib.prompts[0]
                .results
                .iter()
                .find(|r| r.meta.id == rid)
                .unwrap()
                .meta
                .fields
                .name
                .as_deref(),
            Some(*name)
        );
    }
    for flags in [
        vec!["--result-name", "x", "--result-name", "y"],
        vec!["--source-name", "no path"],
        vec!["--result-name", &"x".repeat(201)],
    ] {
        let untouched = tempdir().unwrap();
        let mut args = vec![
            "add",
            "--library",
            untouched.path().to_str().unwrap(),
            "--prompt-text",
            "names",
            "--result",
            a,
        ];
        args.extend(flags);
        assert!(!run(&config, &args).status.success());
        assert_eq!(fs::read_dir(untouched.path()).unwrap().count(), 0);
    }
}

#[test]
fn video_folder_flag_preserves_reused_source_folder() {
    let config = tempdir().unwrap();
    let library = tempdir().unwrap();
    let input = tempdir().unwrap();
    let video = input.path().join("video.MP4");
    fs::write(&video, b"video fixture").unwrap();
    let root = library.path().to_str().unwrap();
    let path = video.to_str().unwrap();
    let first = ok(
        &config,
        &[
            "add",
            "--library",
            root,
            "--prompt-text",
            "video",
            "--result",
            path,
            "--source",
            path,
            "--source-folder",
            "Family",
            "--source-name",
            "Clip.mp4",
            "--json",
        ],
    );
    let folders = ok(&config, &["folders", "--library", root, "--json"]);
    assert_eq!(folders[0]["name"], "Family");
    let source_path = library
        .path()
        .join("sources")
        .join(format!("{}.json", first["sourceIds"][0].as_str().unwrap()));
    let source: Value = serde_json::from_slice(&fs::read(&source_path).unwrap()).unwrap();
    assert_eq!(source["folder"], folders[0]["id"]);
    assert_eq!(source["kind"], "video");
    assert_eq!(source["name"], "Clip");
    ok(
        &config,
        &[
            "add",
            "--library",
            root,
            "--prompt-text",
            "video",
            "--result",
            path,
            "--source",
            path,
            "--source-folder",
            "Other",
            "--json",
        ],
    );
    let after: Value = serde_json::from_slice(&fs::read(source_path).unwrap()).unwrap();
    assert_eq!(after, source);
}
