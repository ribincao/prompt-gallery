fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = args.iter().any(|a| a == "--json");
    match prompt_gallery_lib::cli::run(args) {
        Ok(value) => println!(
            "{}",
            if json {
                value.to_string()
            } else {
                serde_json::to_string_pretty(&value).unwrap()
            }
        ),
        Err(error) => {
            if json {
                eprintln!("{}", serde_json::json!({"error": error}));
            } else {
                eprintln!("pgallery: {error}");
            }
            std::process::exit(1);
        }
    }
}
