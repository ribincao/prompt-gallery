.PHONY: dev build icon clean install-cli
dev:
	cargo tauri dev
build:
	cargo tauri build --bundles app
icon:
	cargo tauri icon $(SRC)
clean:
	cargo clean --manifest-path src-tauri/Cargo.toml

install-cli:
	cargo install --path src-tauri --bin pgallery --locked
