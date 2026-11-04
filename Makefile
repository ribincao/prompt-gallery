.PHONY: dev build icon clean
dev:
	cargo tauri dev
build:
	cargo tauri build --bundles app
icon:
	cargo tauri icon $(SRC)
clean:
	cargo clean --manifest-path src-tauri/Cargo.toml
