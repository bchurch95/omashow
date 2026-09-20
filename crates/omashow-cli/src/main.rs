use clap::{Parser, Subcommand};
use omashow_core::{open_pptx, save_pptx, PresentationModel};

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    cmd: Commands,
}

#[derive(Subcommand)]
enum Commands {
    New { output: String },
    Open { input: String },
    Save { input: String, output: String },
    List { input: String },
    Export { input: String, output: String },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Commands::New { output } => {
            let model = PresentationModel { title: "Untitled".into(), slides: vec![] };
            save_pptx(&output, &model)?;
            println!("Created {}", output);
        }
        Commands::Open { input } => {
            let model = open_pptx(&input)?;
            println!("Opened {} with {} slides", input, model.slides.len());
        }
        Commands::Save { input, output } => {
            let model = open_pptx(&input)?;
            save_pptx(&output, &model)?;
            println!("Saved {} -> {}", input, output);
        }
        Commands::List { input } => {
            let model = open_pptx(&input)?;
            println!("Presentation: {}", model.title);
            for s in model.slides {
                println!("  Slide {}: {:?}", s.index + 1, s.title);
            }
        }
        Commands::Export { input, output } => {
            let model = open_pptx(&input)?;
            std::fs::write(&output, serde_json::to_string_pretty(&model)?)?;
            println!("Exported {} -> {}", input, output);
        }
    }
    Ok(())
}
