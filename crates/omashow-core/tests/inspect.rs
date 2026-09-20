//! Headless slide inspection: metadata, text runs, and bounding boxes —
//! including group-child remapping — verified in memory and through a real
//! PPTX file roundtrip.

use std::io::Cursor;

use omashow_core::{get_slide_shapes, slide_count, slide_dimensions, BoundingBox, PptxDocument};
use office_toolkit::drawing::{
    ShapeProperties, TextBody, TextParagraph, TextRun, TextRunProperties, Transform2D,
};
use office_toolkit::powerpoint::{
    AutoShape, Picture, PictureFormat, Placeholder, PlaceholderKind, Presentation, Shape,
    ShapeGroup, Slide,
};

fn title_body() -> TextBody {
    let p0 = TextParagraph::new()
        .with_run(TextRun::Regular {
            text: "Hello ".to_string(),
            properties: TextRunProperties::new()
                .with_bold(true)
                .with_font_size_points(24.0)
                .with_font_family("Calibri"),
        })
        .with_run(TextRun::Regular {
            text: "World".to_string(),
            properties: TextRunProperties::new().with_italic(true),
        });
    let p1 = TextParagraph::new()
        .with_run(TextRun::Regular {
            text: "Second".to_string(),
            properties: TextRunProperties::new(),
        })
        .with_run(TextRun::LineBreak { properties: None })
        .with_run(TextRun::Regular {
            text: "line".to_string(),
            properties: TextRunProperties::new(),
        });
    TextBody::new().with_paragraph(p0).with_paragraph(p1)
}

/// A two-slide deck: a titled slide with a text box, a picture, and a
/// 2×-scaled group (child space 1000×500 mapped into a 2000×1000 box at
/// (1000000, 2000000)), plus an empty second slide.
fn fixture_deck() -> Presentation {
    let title = AutoShape::new(2, "Title")
        .with_text_box(true)
        .with_placeholder(Placeholder::new(PlaceholderKind::Title))
        .with_properties(
            ShapeProperties::new().with_transform(
                Transform2D::new()
                    .with_offset(1_000_000, 3_000_000)
                    .with_extent(4_000_000, 1_000_000),
            ),
        )
        .with_text_body(title_body());

    let box_shape = AutoShape::new(3, "Box")
        .with_text_box(true)
        .with_properties(
            ShapeProperties::new().with_transform(
                Transform2D::new().with_offset(500, 300).with_extent(200, 100),
            ),
        )
        .with_text_body(TextBody::new().with_paragraph(TextParagraph::new().with_run(
            TextRun::text("Box"),
        )));

    let pic = Picture::new(
        4,
        "pic",
        [0u8; 3],
        PictureFormat::Png,
        1_000_000,
        2_000_000,
    )
    .with_offset(10_000_000, 5_000_000);

    let child = AutoShape::new(5, "Child").with_properties(
        ShapeProperties::new().with_transform(
            Transform2D::new().with_offset(100, 50).with_extent(100, 100),
        ),
    );
    let group = ShapeGroup::new(6, "Group")
        .with_transform(
            (1_000_000, 2_000_000),
            (2_000_000, 1_000_000),
            (0, 0),
            (1_000_000, 500_000),
        )
        .with_shape(Shape::AutoShape(child));

    let slide1 = Slide::new()
        .with_shape(Shape::AutoShape(title))
        .with_shape(Shape::AutoShape(box_shape))
        .with_shape(Shape::Picture(pic))
        .with_shape(Shape::Group(group));
    Presentation::new()
        .with_slide(slide1)
        .with_slide(Slide::new())
}

#[test]
fn deck_metadata() {
    let pres = fixture_deck();
    assert_eq!(slide_count(&pres), 2);
    let dims = slide_dimensions(&pres);
    assert_eq!((dims.width_emu, dims.height_emu), (12_192_000, 6_858_000));
    assert!((dims.width_inches() - 13.333).abs() < 0.01);
    assert!((dims.height_inches() - 7.5).abs() < 0.01);

    let custom = Presentation::new().with_slide_size(9_144_000, 6_858_000);
    let dims = slide_dimensions(&custom);
    assert_eq!((dims.width_emu, dims.height_emu), (9_144_000, 6_858_000));
}

#[test]
fn out_of_range_slide_errors() {
    let pres = fixture_deck();
    assert!(get_slide_shapes(&pres, 2).is_err());
}

fn assert_slide0_inspection(pres: &Presentation) {
    let shapes = get_slide_shapes(pres, 0).expect("slide 0 exists");
    assert_eq!(shapes.len(), 4);

    // Title placeholder: kind, role, bounds, and run properties.
    let title = &shapes[0];
    assert_eq!(title.kind, "autoshape");
    assert_eq!(title.placeholder, Some("title"));
    assert_eq!(
        title.bounds,
        Some(BoundingBox {
            x_emu: 1_000_000,
            y_emu: 3_000_000,
            width_emu: 4_000_000,
            height_emu: 1_000_000,
        })
    );
    assert_eq!(title.text.as_deref(), Some("Hello World\nSecond\nline"));
    assert_eq!(title.runs.len(), 5);
    assert_eq!(title.runs[0].text, "Hello ");
    assert!(title.runs[0].bold);
    assert!(!title.runs[0].italic);
    assert_eq!(title.runs[0].font_size_pt, Some(24.0));
    assert_eq!(title.runs[0].font_family.as_deref(), Some("Calibri"));
    assert_eq!(title.runs[0].paragraph, 0);
    assert_eq!(title.runs[1].text, "World");
    assert!(title.runs[1].italic);
    assert_eq!(title.runs[1].font_size_pt, None);
    assert_eq!(title.runs[2].text, "Second");
    assert_eq!(title.runs[2].paragraph, 1);
    assert_eq!(title.runs[3].text, "\n");
    assert_eq!(title.runs[3].paragraph, 1);
    assert_eq!(title.runs[4].text, "line");

    // Text box.
    let box_shape = &shapes[1];
    assert_eq!(box_shape.kind, "autoshape");
    assert_eq!(box_shape.placeholder, None);
    assert_eq!(
        box_shape.bounds,
        Some(BoundingBox {
            x_emu: 500,
            y_emu: 300,
            width_emu: 200,
            height_emu: 100,
        })
    );
    assert_eq!(box_shape.text.as_deref(), Some("Box"));
    assert_eq!(box_shape.runs.len(), 1);

    // Picture.
    let pic = &shapes[2];
    assert_eq!(pic.kind, "picture");
    assert_eq!(
        pic.bounds,
        Some(BoundingBox {
            x_emu: 10_000_000,
            y_emu: 5_000_000,
            width_emu: 1_000_000,
            height_emu: 2_000_000,
        })
    );
    assert_eq!(pic.text, None);

    // Group: own bounds, plus the child remapped 2× out of its 1000×500 space.
    let group = &shapes[3];
    assert_eq!(group.kind, "group");
    assert_eq!(
        group.bounds,
        Some(BoundingBox {
            x_emu: 1_000_000,
            y_emu: 2_000_000,
            width_emu: 2_000_000,
            height_emu: 1_000_000,
        })
    );
    let children = group.children.as_deref().expect("group has children");
    assert_eq!(children.len(), 1);
    assert_eq!(children[0].name, "Child");
    assert_eq!(
        children[0].bounds,
        Some(BoundingBox {
            x_emu: 1_000_200,
            y_emu: 2_000_100,
            width_emu: 200,
            height_emu: 200,
        })
    );

    // Empty second slide.
    assert!(get_slide_shapes(pres, 1).unwrap().is_empty());
}

#[test]
fn in_memory_inspection() {
    assert_slide0_inspection(&fixture_deck());
}

#[test]
fn inspection_survives_pptx_roundtrip() {
    let buf = fixture_deck()
        .write_to(Cursor::new(Vec::new()))
        .expect("serialize deck");
    let reopened = Presentation::read_from(Cursor::new(buf.get_ref())).expect("read deck back");
    assert_slide0_inspection(&reopened);
}

#[test]
fn pptx_document_inspection_methods() {
    let mut doc = PptxDocument::new();
    doc.add_slide(Some("First".to_string())).unwrap();
    doc.add_slide(None).unwrap();

    assert_eq!(doc.slide_count(), 2);
    let dims = doc.slide_dimensions();
    assert_eq!((dims.width_emu, dims.height_emu), (12_192_000, 6_858_000));

    let shapes = doc.get_slide_shapes(0).unwrap();
    assert_eq!(shapes.len(), 1);
    assert_eq!(shapes[0].placeholder, Some("title"));
    assert_eq!(shapes[0].text.as_deref(), Some("First"));

    assert!(doc.get_slide_shapes(9).is_err());
}
