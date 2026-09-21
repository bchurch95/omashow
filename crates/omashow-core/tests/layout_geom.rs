//! Placeholder geometry inheritance (slide → layout → master), the case
//! python-pptx produces: the slide's placeholder carries no `<p:spPr>` of its
//! own, and the box lives on the master's matching placeholder.

use std::io::{Read, Write};

use omashow_core::PptxDocument;

/// Builds a one-slide deck via the public API (valid OPC, full rels chain),
/// then rewrites the package so the deck uses layout/master inheritance
/// exactly like a python-pptx file:
///
/// - the slide's title placeholder loses its explicit geometry,
/// - the slide master gains a title placeholder with the canonical
///   python-pptx box (off 457200,274638 ext 8229600,1143000) plus a
///   `<p:txStyles>` title size of 44pt.
fn build_inheriting_deck(path: &std::path::Path) {
    let mut doc = PptxDocument::new();
    doc.add_slide(Some("Inherited title".into())).unwrap();
    doc.save(path).unwrap();

    let src = std::fs::read(path).unwrap();
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(src)).unwrap();
    let mut entries = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).unwrap();
        let name = entry.name().to_string();
        let mut data = Vec::new();
        entry.read_to_end(&mut data).unwrap();
        entries.push((name, data));
    }

    let slide = entries
        .iter_mut()
        .find(|(n, _)| n.as_str() == "ppt/slides/slide1.xml")
        .unwrap();
    // Strip the title shape's explicit geometry → it now inherits.
    let xml = String::from_utf8(slide.1.clone()).unwrap();
    let sppr_open = xml.find("<p:spPr>").expect("slide has its own spPr");
    let sppr_close = xml[sppr_open..].find("</p:spPr>").unwrap() + "</p:spPr>".len();
    let mut new_xml = xml.clone();
    new_xml.replace_range(sppr_open..sppr_open + sppr_close, "<p:spPr/>");
    slide.1 = new_xml.into_bytes();

    let master = entries
        .iter_mut()
        .find(|(n, _)| n.as_str() == "ppt/slideMasters/slideMaster1.xml")
        .unwrap();
    let xml = String::from_utf8(master.1.clone()).unwrap();
    let sp_tree_close = xml.find("</p:spTree>").expect("master has spTree");
    let title_ph = concat!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"100\" name=\"Title 1\"/><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr>",
        "<p:spPr><a:xfrm><a:off x=\"457200\" y=\"274638\"/><a:ext cx=\"8229600\" cy=\"1143000\"/></a:xfrm>",
        "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr>",
        "<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>"
    );
    let tx_styles = concat!(
        "<p:txStyles><p:titleStyle><a:lvl1pPr algn=\"l\"><a:defRPr sz=\"4400\"/></a:lvl1pPr></p:titleStyle>",
        "<p:bodyStyle><a:lvl1pPr><a:defRPr sz=\"2400\"/></a:lvl1pPr></p:bodyStyle>",
        "<p:otherStyle><a:lvl1pPr><a:defRPr sz=\"1200\"/></a:lvl1pPr></p:otherStyle></p:txStyles>"
    );
    let mut new_xml = xml.clone();
    new_xml.insert_str(sp_tree_close, title_ph);
    let cslid_close = new_xml.find("</p:cSld>").unwrap() + "</p:cSld>".len();
    new_xml.insert_str(cslid_close, tx_styles);
    master.1 = new_xml.into_bytes();

    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        for (name, data) in entries {
            zip.start_file(name.as_str(), zip::write::FileOptions::<()>::default())
                .unwrap();
            zip.write_all(&data).unwrap();
        }
        zip.finish().unwrap();
    }
    std::fs::write(path, buf).unwrap();
}

#[test]
fn slide_placeholder_inherits_geometry_and_size_from_master() {
    let dir = std::env::temp_dir().join("omashow-geomtest");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("inheriting.pptx");
    build_inheriting_deck(&path);

    let doc = PptxDocument::open(&path).expect("inheriting deck opens");
    let shapes = doc.get_slide_shapes(0).expect("shapes resolve");
    let title = shapes
        .iter()
        .find(|s| s.placeholder == Some("title"))
        .expect("title placeholder present");

    // The slide's own XML carries no box; the master's does.
    assert_eq!(
        title.bounds,
        Some(omashow_core::BoundingBox {
            x_emu: 457_200,
            y_emu: 274_638,
            width_emu: 8_229_600,
            height_emu: 1_143_000
        }),
        "placeholder bounds must come from the slide master"
    );

    // The slide text run declares no size; the master's titleStyle does.
    assert_eq!(title.runs.len(), 1);
    assert_eq!(title.runs[0].text, "Inherited title");
    assert_eq!(
        title.runs[0].font_size_pt,
        Some(44.0),
        "run size must fall back to the master's titleStyle default"
    );
}

#[test]
fn explicit_geometry_wins_over_inheritance() {
    // A deck built in-session carries explicit geometry on its placeholders;
    // the (geometry-less) writer master must not clobber it.
    let mut doc = PptxDocument::new();
    doc.add_slide(Some("Own box".into())).unwrap();
    let shapes = doc.get_slide_shapes(0).unwrap();
    let title = shapes
        .iter()
        .find(|s| s.placeholder == Some("title"))
        .unwrap();
    assert_eq!(
        title.bounds,
        Some(omashow_core::BoundingBox {
            x_emu: 685_800,
            y_emu: 342_900,
            width_emu: 10_820_400,
            height_emu: 1_325_555
        })
    );
}
