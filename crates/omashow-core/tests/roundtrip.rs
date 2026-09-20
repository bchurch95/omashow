use omashow_core::*;
use office_toolkit::drawing::{ShapeProperties, TextBody, TextParagraph, TextRun, Transform2D};
use office_toolkit::powerpoint::{AutoShape, Picture, PictureFormat, Shape, Slide};

fn tb(s: &str) -> TextBody {
    TextBody::new().with_paragraph(TextParagraph::new().with_run(TextRun::text(s)))
}

/// Collect every piece of text in a slide's autoshapes, in order.
fn slide_shape_texts(pres: &Presentation, i: usize) -> Vec<String> {
    pres.slides[i]
        .shapes
        .iter()
        .filter_map(|sh| {
            if let Shape::AutoShape(a) = sh {
                a.text_body.as_ref().map(|t| {
                    t.paragraphs
                        .iter()
                        .map(|p| {
                            p.runs.iter()
                                .filter_map(|r| match r {
                                    TextRun::Regular { text, .. } => Some(text.clone()),
                                    _ => None,
                                })
                                .collect::<String>()
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                })
            } else {
                None
            }
        })
        .collect()
}

#[test]
fn lossless_title_edit_roundtrip() {
    let dir = std::env::temp_dir().join("omashow_roundtrip");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("deck.pptx").to_string_lossy().to_string();

    // 1) Build a deck with a title, a body box, and speaker notes.
    let title = AutoShape::new(2, "Title")
        .with_properties(ShapeProperties::new().with_transform(Transform2D::new()
            .with_offset(1_000_000, 1_000_000)
            .with_extent(7_772_400, 1_200_150)))
        .with_text_body(tb("Original Title"));
    let body = AutoShape::new(3, "Body")
        .with_properties(ShapeProperties::new().with_transform(Transform2D::new()
            .with_offset(1_000_000, 2_500_000)
            .with_extent(7_772_400, 4_000_000)))
        .with_text_body(tb("Body content must survive the edit"));
    let slide1 = Slide::new()
        .with_shape(Shape::AutoShape(title))
        .with_shape(Shape::AutoShape(body))
        .with_notes(tb("Speaker note that must survive"));
    let slide2 = Slide::new().with_shape(Shape::AutoShape(
        AutoShape::new(2, "Title").with_text_body(tb("Second slide")),
    ));
    let pres = Presentation::new().with_slide(slide1).with_slide(slide2);
    save_presentation(&path, &pres).unwrap();

    // 2) Reopen the full deck.
    let mut reopened = open_pptx_full(&path).unwrap();
    assert_eq!(reopened.slides.len(), 2);
    let model = model_of(&reopened);
    assert_eq!(model.slides[0].title.as_deref(), Some("Original Title"));

    // 3) Edit the title in place.
    set_slide_title(&mut reopened, 0, "Edited Title").unwrap();

    // 4) Save and reopen again.
    save_presentation(&path, &reopened).unwrap();
    let final_pres = open_pptx_full(&path).unwrap();
    let texts = slide_shape_texts(&final_pres, 0);

    // Title changed…
    assert!(texts.contains(&"Edited Title".to_string()), "title: {texts:?}");
    // …but the body and notes are still there (lossless).
    assert!(texts.contains(&"Body content must survive the edit".to_string()), "body: {texts:?}");
    let notes = final_pres.slides[0].notes.as_ref().map(|t| {
        t.paragraphs.iter()
            .flat_map(|p| p.runs.iter().filter_map(|r| match r {
                TextRun::Regular { text, .. } => Some(text.clone()),
                _ => None,
            }))
            .collect::<String>()
    });
    assert_eq!(notes.as_deref(), Some("Speaker note that must survive"));

    // Second slide untouched.
    assert_eq!(model_of(&final_pres).slides[1].title.as_deref(), Some("Second slide"));

    let _ = std::fs::remove_dir_all(&dir);
}

/// A 1×1 RGBA PNG, enough to exercise the image-part code path.
const TINY_PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 96, 248, 95, 15, 0, 2,
    135, 1, 128, 235, 71, 186, 146, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

#[test]
fn picture_survives_roundtrip() {
    let dir = std::env::temp_dir().join("omashow_pic");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("pic.pptx").to_string_lossy().to_string();

    let pic = Picture::new(7, "logo", TINY_PNG, PictureFormat::Png, 3_000_000, 3_000_000)
        .with_offset(1_000_000, 1_000_000);
    let slide = Slide::new()
        .with_shape(Shape::AutoShape(AutoShape::new(2, "Title").with_text_body(tb("Deck with image"))))
        .with_shape(Shape::Picture(pic));
    save_presentation(&path, &Presentation::new().with_slide(slide)).unwrap();

    let reopened = open_pptx_full(&path).unwrap();
    let has_picture = reopened.slides[0].shapes.iter().any(|s| {
        matches!(s, Shape::Picture(p) if p.data == TINY_PNG && p.format == PictureFormat::Png)
    });
    assert!(has_picture, "embedded picture lost on round-trip");

    let _ = std::fs::remove_dir_all(&dir);
}

/// Parts the model doesn't understand (themes, custom XML, legacy content) must be carried
/// through untouched — this is what makes a real .pptx round-trip lossless.
///
/// KNOWN GAP (office-toolkit 1.0): this currently FAILS. Round-tripping a real 46-part deck
/// drops ~22 parts (10 of 11 slide layouts, the thumbnail, printer settings, custom parts) and
/// re-serializes 21 others. office-toolkit 1.0 is model-preserving, not lossless. Ignored until
/// we add surgical part-preservation to the io layer (keep original bytes for parts the model
/// doesn't regenerate). See the round-trip verification notes.
#[ignore = "office-toolkit 1.0 is not lossless for real decks; needs surgical part preservation"]
#[test]
fn unknown_parts_survive_roundtrip() {
    let dir = std::env::temp_dir().join("omashow_parts");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("x.pptx").to_string_lossy().to_string();

    let slide = Slide::new().with_shape(Shape::AutoShape(
        AutoShape::new(2, "Title").with_text_body(tb("Theme test")),
    ));
    save_presentation(&path, &Presentation::new().with_slide(slide)).unwrap();

    // Inject a custom part the deck doesn't know about, with a registered content type
    // (as every real PowerPoint part has) — simulates an unknown theme/legacy part.
    let py = r#"
import zipfile, shutil, sys
p = sys.argv[1]; tmp = p + ".tmp"
with zipfile.ZipFile(p) as zin, zipfile.ZipFile(tmp, "w") as zout:
    for it in zin.infolist():
        data = zin.read(it.filename)
        if it.filename == "[Content_Types].xml":
            data = data.replace(
                b"</Types>",
                b'<Override PartName="/custom/branding.xml" ContentType="application/vnd.omashow.branding+xml"/></Types>',
            )
        zout.writestr(it, data)
    zout.writestr("custom/branding.xml", "<branding>omarchy</branding>")
shutil.move(tmp, p)
"#;
    let status = std::process::Command::new("python3")
        .arg("-c")
        .arg(py)
        .arg(&path)
        .status()
        .expect("python3 should be available");
    assert!(status.success(), "failed to inject custom part");

    // Round-trip through Omashow.
    let pres = open_pptx_full(&path).unwrap();
    save_presentation(&path, &pres).unwrap();

    let has = std::process::Command::new("python3")
        .arg("-c")
        .arg(format!(
            "import zipfile,sys; z=zipfile.ZipFile('{}'); sys.exit(0 if 'custom/branding.xml' in z.namelist() else 1)",
            path
        ))
        .status()
        .unwrap();
    assert!(has.success(), "custom part lost — round-trip is NOT lossless");

    // And the title is intact.
    let pres2 = open_pptx_full(&path).unwrap();
    assert_eq!(model_of(&pres2).slides[0].title.as_deref(), Some("Theme test"));

    let _ = std::fs::remove_dir_all(&dir);
}
