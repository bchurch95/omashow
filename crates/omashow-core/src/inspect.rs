//! Read-only slide inspection: deck metadata, per-slide shapes, text runs, and
//! bounding boxes — the headless view behind the CLI `inspect` command and the
//! Tauri slide viewer.
//!
//! Everything here is derived from the in-memory [`Presentation`]; nothing in
//! this module mutates or re-serializes the deck.

use base64::Engine as _;
use serde::Serialize;

use office_toolkit::drawing::{
    Color, Fill, Line, TextAlign, TextBody, TextRun, TextRunProperties,
};
use office_toolkit::powerpoint::{
    EMU_PER_INCH, PlaceholderKind, Picture, PictureFormat, Presentation, Shape, ShapeGroup,
};

use crate::error::Error;
use crate::model::text_body_to_string;

/// Slide canvas size in EMUs (`<p:sldSz cx=".." cy="..">`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SlideDimensions {
    pub width_emu: i64,
    pub height_emu: i64,
}

impl SlideDimensions {
    pub fn width_inches(&self) -> f64 {
        self.width_emu as f64 / EMU_PER_INCH as f64
    }

    pub fn height_inches(&self) -> f64 {
        self.height_emu as f64 / EMU_PER_INCH as f64
    }
}

/// Number of slides in the deck.
pub fn slide_count(pres: &Presentation) -> usize {
    pres.slides.len()
}

/// Slide canvas size in EMUs.
pub fn slide_dimensions(pres: &Presentation) -> SlideDimensions {
    SlideDimensions {
        width_emu: pres.slide_width_emu,
        height_emu: pres.slide_height_emu,
    }
}

/// Axis-aligned bounding box in slide coordinates (top-left origin, x right,
/// y down), in EMUs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct BoundingBox {
    pub x_emu: i64,
    pub y_emu: i64,
    pub width_emu: i64,
    pub height_emu: i64,
}

/// One text run, flattened across the shape's paragraphs in document order.
/// Line breaks inside a paragraph appear as their own run with text `"\n"`.
#[derive(Debug, Clone, Serialize)]
pub struct TextRunInfo {
    /// 0-based index of the paragraph the run belongs to.
    pub paragraph: usize,
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    /// `sz` in points (e.g. `18.0`); `None` when the run inherits its size.
    pub font_size_pt: Option<f64>,
    pub font_family: Option<String>,
    /// Text color as a CSS value (see [`color_to_css`]); `None` when the run
    /// inherits its color from the paragraph/shape defaults.
    pub color: Option<String>,
    /// Paragraph alignment as a CSS value (`"left"`, `"center"`, `"right"`,
    /// `"justify"`); `None` when the paragraph inherits the default (left).
    pub alignment: Option<String>,
}

/// A shape's outline stroke.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LineInfo {
    /// Stroke width in EMUs; `None` when the shape uses the default width.
    pub width_emu: Option<i64>,
    /// Stroke color as a CSS value; `None` when the shape has no explicit line.
    pub color: Option<String>,
}

/// Embedded image data of a picture shape, resolved from the deck's media
/// parts (`ppt/media/*`) through the shape's `r:embed` relationship.
#[derive(Debug, Clone, Serialize)]
pub struct PicInfo {
    /// Image format: "png", "jpeg", "gif", or "bmp".
    pub format: &'static str,
    /// The raw image bytes as a `data:` URI, ready for an `<img src>`.
    pub data_uri: String,
    /// Size of the raw image in bytes.
    pub size_bytes: usize,
}

/// Serializable view of one shape. For a group, `children` holds the nested
/// shapes with their bounds already remapped out of the group's child
/// coordinate space into slide coordinates.
#[derive(Debug, Clone, Serialize)]
pub struct ShapeInfo {
    pub id: u32,
    pub name: String,
    /// One of `"autoshape"`, `"picture"`, `"chart"`, `"group"`, `"connector"`,
    /// `"table"`, `"media"`.
    pub kind: &'static str,
    /// Placeholder role (`"title"`, `"body"`, ...), when the shape is one.
    pub placeholder: Option<&'static str>,
    /// Bounds in slide coordinates. `None` for placeholder autoshapes whose
    /// geometry is inherited from the slide layout (not modeled).
    pub bounds: Option<BoundingBox>,
    /// The shape's full text, paragraphs joined by `\n`; `None` when the
    /// shape carries no text body.
    pub text: Option<String>,
    /// Interior fill as a CSS color (solid fills) or a token ("none",
    /// "gradient", "pattern", "image"); `None` when the shape inherits its
    /// fill from the theme/layout.
    pub fill: Option<String>,
    /// Outline stroke, when the shape declares one.
    pub line: Option<LineInfo>,
    /// Text runs in document order.
    pub runs: Vec<TextRunInfo>,
    /// Embedded image data, only for a `picture` shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pic: Option<PicInfo>,
    /// Nested shapes, only for a group.
    pub children: Option<Vec<ShapeInfo>>,
}

/// Serializable view of every shape on slide `slide`, in document order.
///
/// Group children stay nested under their group, but with bounds remapped
/// into slide coordinates, so a flat consumer never has to re-derive the
/// group transform.
pub fn get_slide_shapes(pres: &Presentation, slide: usize) -> Result<Vec<ShapeInfo>, Error> {
    let slide = pres
        .slides
        .get(slide)
        .ok_or(Error::OutOfRange(slide))?;
    Ok(slide
        .shapes
        .iter()
        .map(|s| shape_info(s, &GroupContext::identity()))
        .collect())
}

/// How a group's child coordinate space maps into slide coordinates, per
/// axis: `slide = (child - c) * num / den + o`. Kept as a rational so nested
/// groups compose without intermediate rounding.
#[derive(Clone, Copy)]
struct GroupContext {
    cx: i128,
    cy: i128,
    ox: i128,
    oy: i128,
    num_x: i128,
    den_x: i128,
    num_y: i128,
    den_y: i128,
}

impl GroupContext {
    fn identity() -> Self {
        Self {
            cx: 0,
            cy: 0,
            ox: 0,
            oy: 0,
            num_x: 1,
            den_x: 1,
            num_y: 1,
            den_y: 1,
        }
    }

    fn map_axis(v: i128, c: i128, o: i128, num: i128, den: i128) -> i128 {
        if den == 0 {
            return v + o;
        }
        div_round((v - c) * num, den) + o
    }

    fn map_box(&self, x: i64, y: i64, w: i64, h: i64) -> BoundingBox {
        BoundingBox {
            x_emu: Self::map_axis(x as i128, self.cx, self.ox, self.num_x, self.den_x) as i64,
            y_emu: Self::map_axis(y as i128, self.cy, self.oy, self.num_y, self.den_y) as i64,
            width_emu: Self::map_axis(w as i128, 0, 0, self.num_x, self.den_x) as i64,
            height_emu: Self::map_axis(h as i128, 0, 0, self.num_y, self.den_y) as i64,
        }
    }

    /// Compose this context with a group's own child-space transform.
    fn nested(&self, g: &ShapeGroup) -> Self {
        let (ox_g, oy_g) = (g.offset_emu.0 as i128, g.offset_emu.1 as i128);
        let (ex_g, ey_g) = (g.extent_emu.0 as i128, g.extent_emu.1 as i128);
        let (cx_g, cy_g) = (g.child_offset_emu.0 as i128, g.child_offset_emu.1 as i128);
        let (cex_g, cey_g) = (g.child_extent_emu.0 as i128, g.child_extent_emu.1 as i128);

        // Composed scale: (child - cx_g) * ex_g / cex_g, then this context.
        // A zero child extent is degenerate — skip the rescale on that axis.
        let (num_x, den_x) = if cex_g == 0 {
            (self.num_x, self.den_x)
        } else {
            (self.num_x * ex_g, self.den_x * cex_g)
        };
        let (num_y, den_y) = if cey_g == 0 {
            (self.num_y, self.den_y)
        } else {
            (self.num_y * ey_g, self.den_y * cey_g)
        };

        Self {
            cx: cx_g,
            cy: cy_g,
            ox: Self::map_axis(ox_g, self.cx, self.ox, self.num_x, self.den_x),
            oy: Self::map_axis(oy_g, self.cy, self.oy, self.num_y, self.den_y),
            num_x,
            den_x,
            num_y,
            den_y,
        }
    }
}

/// Nearest-integer division (ties away from zero); caller guarantees `d != 0`.
fn div_round(n: i128, d: i128) -> i128 {
    let (q, r) = (n / d, n % d);
    let twice = r * 2;
    if twice >= d {
        q + 1
    } else if -twice >= d {
        q - 1
    } else {
        q
    }
}

fn shape_info(shape: &Shape, ctx: &GroupContext) -> ShapeInfo {
    match shape {
        Shape::AutoShape(a) => ShapeInfo {
            id: a.id,
            name: a.name.clone(),
            kind: "autoshape",
            placeholder: a.placeholder.as_ref().map(|p| placeholder_token(&p.kind)),
            bounds: a
                .properties
                .transform
                .as_ref()
                .and_then(|t| match (t.offset, t.extent) {
                    (Some((x, y)), Some((w, h))) => Some(ctx.map_box(x, y, w, h)),
                    _ => None,
                }),
            text: a.text_body.as_ref().map(text_body_to_string),
            fill: a.properties.fill.as_ref().map(fill_to_css),
            line: a.properties.line.as_ref().map(line_info),
            runs: a
                .text_body
                .as_ref()
                .map(flatten_runs)
                .unwrap_or_default(),
            pic: None,
            children: None,
        },
        Shape::Picture(p) => ShapeInfo {
            id: p.id,
            name: p.name.clone(),
            kind: "picture",
            placeholder: None,
            bounds: Some(ctx.map_box(
                p.offset_emu.0,
                p.offset_emu.1,
                p.extent_emu.0,
                p.extent_emu.1,
            )),
            text: None,
            fill: p
                .shape_properties
                .as_ref()
                .and_then(|sp| sp.fill.as_ref())
                .map(fill_to_css),
            line: p
                .shape_properties
                .as_ref()
                .and_then(|sp| sp.line.as_ref())
                .map(line_info),
            runs: Vec::new(),
            pic: Some(pic_info(p)),
            children: None,
        },
        Shape::Chart(c) => ShapeInfo {
            id: c.id,
            name: c.name.clone(),
            kind: "chart",
            placeholder: None,
            bounds: Some(ctx.map_box(
                c.offset_emu.0,
                c.offset_emu.1,
                c.extent_emu.0,
                c.extent_emu.1,
            )),
            text: None,
            fill: None,
            line: None,
            runs: Vec::new(),
            pic: None,
            children: None,
        },
        Shape::Group(g) => {
            let children = g
                .shapes
                .iter()
                .map(|s| shape_info(s, &ctx.nested(g)))
                .collect();
            ShapeInfo {
                id: g.id,
                name: g.name.clone(),
                kind: "group",
                placeholder: None,
                bounds: Some(ctx.map_box(
                    g.offset_emu.0,
                    g.offset_emu.1,
                    g.extent_emu.0,
                    g.extent_emu.1,
                )),
                text: None,
                fill: None,
                line: None,
                runs: Vec::new(),
                pic: None,
                children: Some(children),
            }
        }
        Shape::Connector(c) => ShapeInfo {
            id: c.id,
            name: c.name.clone(),
            kind: "connector",
            placeholder: None,
            bounds: c
                .properties
                .transform
                .as_ref()
                .and_then(|t| match (t.offset, t.extent) {
                    (Some((x, y)), Some((w, h))) => Some(ctx.map_box(x, y, w, h)),
                    _ => None,
                }),
            text: None,
            fill: c.properties.fill.as_ref().map(fill_to_css),
            line: c.properties.line.as_ref().map(line_info),
            runs: Vec::new(),
            pic: None,
            children: None,
        },
        Shape::Table(t) => ShapeInfo {
            id: t.id,
            name: t.name.clone(),
            kind: "table",
            placeholder: None,
            bounds: Some(ctx.map_box(
                t.offset_emu.0,
                t.offset_emu.1,
                t.extent_emu.0,
                t.extent_emu.1,
            )),
            text: None,
            fill: None,
            line: None,
            runs: Vec::new(),
            pic: None,
            children: None,
        },
        Shape::Media(m) => ShapeInfo {
            id: m.id,
            name: m.name.clone(),
            kind: "media",
            placeholder: None,
            bounds: Some(ctx.map_box(
                m.offset_emu.0,
                m.offset_emu.1,
                m.extent_emu.0,
                m.extent_emu.1,
            )),
            text: None,
            fill: None,
            line: None,
            runs: Vec::new(),
            pic: None,
            children: None,
        },
    }
}

fn pic_info(p: &Picture) -> PicInfo {
    let format = match p.format {
        PictureFormat::Png => "png",
        PictureFormat::Jpeg => "jpeg",
        PictureFormat::Gif => "gif",
        PictureFormat::Bmp => "bmp",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&p.data);
    PicInfo {
        format,
        data_uri: format!("data:image/{format};base64,{b64}"),
        size_bytes: p.data.len(),
    }
}

fn placeholder_token(kind: &PlaceholderKind) -> &'static str {
    match kind {
        PlaceholderKind::Title => "title",
        PlaceholderKind::Body => "body",
        PlaceholderKind::CenterTitle => "ctrTitle",
        PlaceholderKind::SubTitle => "subTitle",
        PlaceholderKind::DateTime => "dateTime",
        PlaceholderKind::SlideNumber => "slideNumber",
        PlaceholderKind::Footer => "footer",
        PlaceholderKind::Header => "header",
        PlaceholderKind::Object => "object",
        PlaceholderKind::SlideImage => "sldImg",
        PlaceholderKind::Other(_) => "other",
    }
}

fn flatten_runs(tb: &TextBody) -> Vec<TextRunInfo> {
    let default_props = TextRunProperties::new();
    let mut runs = Vec::new();
    for (para_idx, para) in tb.paragraphs.iter().enumerate() {
        let alignment = para
            .properties
            .as_ref()
            .and_then(|p| p.alignment)
            .map(alignment_to_css);
        for run in &para.runs {
            let (text, properties) = match run {
                TextRun::Regular { text, properties } => (text.as_str(), properties),
                TextRun::LineBreak { properties } => {
                    ("\n", properties.as_ref().unwrap_or(&default_props))
                }
                TextRun::Field { cached_text, properties, .. } => (cached_text.as_str(), properties),
            };
            runs.push(run_info(para_idx, alignment.clone(), text, properties));
        }
    }
    runs
}

fn run_info(
    paragraph: usize,
    alignment: Option<String>,
    text: &str,
    p: &TextRunProperties,
) -> TextRunInfo {
    TextRunInfo {
        paragraph,
        text: text.to_string(),
        bold: p.bold,
        italic: p.italic,
        font_size_pt: p.font_size_100ths_point.map(|sz| sz as f64 / 100.0),
        font_family: p.font_family.clone(),
        color: p.fill.as_ref().map(fill_to_css),
        alignment,
    }
}

/// Render a paragraph alignment as the matching CSS `text-align` value.
fn alignment_to_css(alignment: TextAlign) -> String {
    match alignment {
        TextAlign::Left => "left".to_string(),
        TextAlign::Center => "center".to_string(),
        TextAlign::Right => "right".to_string(),
        TextAlign::Justified | TextAlign::JustifiedLow | TextAlign::Distributed | TextAlign::ThaiDistributed => {
            "justify".to_string()
        }
    }
}

/// Render an OpenXML color as a CSS value the frontend can use directly.
fn color_to_css(color: &Color) -> String {
    match color {
        Color::Rgb(hex) => format!("#{hex}"),
        Color::RgbPercent { red, green, blue } => {
            let to_byte = |v: i64| (v.clamp(0, 100_000) * 255 + 50_000) / 100_000;
            format!("#{:02x}{:02x}{:02x}", to_byte(*red), to_byte(*green), to_byte(*blue))
        }
        Color::Hsl { hue_60000ths, saturation_1000ths_percent, luminance_1000ths_percent } => {
            format!(
                "hsl({}, {}%, {}%)",
                hue_60000ths / 60_000,
                saturation_1000ths_percent / 1_000,
                luminance_1000ths_percent / 1_000
            )
        }
        Color::System { value, last_color } => last_color
            .as_deref()
            .map(|c| format!("#{c}"))
            .unwrap_or_else(|| value.clone()),
        Color::Preset(name) => name.clone(),
    }
}

/// Render a fill as a CSS color for solid fills; non-solid fills degrade to a
/// short token the renderer can branch on ("none", "gradient", "pattern",
/// "image").
fn fill_to_css(fill: &Fill) -> String {
    match fill {
        Fill::None => "none".to_string(),
        Fill::Solid(color) => color_to_css(color),
        Fill::Gradient(_) => "gradient".to_string(),
        Fill::Pattern(_) => "pattern".to_string(),
        Fill::Image(_) => "image".to_string(),
    }
}

fn line_info(line: &Line) -> LineInfo {
    LineInfo {
        width_emu: line.width_emu,
        color: line.fill.as_ref().map(fill_to_css),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_to_css_covers_all_variants() {
        assert_eq!(
            color_to_css(&Color::Rgb("1A2B3C".to_string())),
            "#1A2B3C"
        );
        // 100000 = 100% -> 255 -> ff; 0 -> 00.
        assert_eq!(
            color_to_css(&Color::RgbPercent {
                red: 100_000,
                green: 0,
                blue: 0
            }),
            "#ff0000"
        );
        assert_eq!(
            color_to_css(&Color::Hsl {
                hue_60000ths: 120_000, // 2 degrees
                saturation_1000ths_percent: 50_000,
                luminance_1000ths_percent: 25_000,
            }),
            "hsl(2, 50%, 25%)"
        );
        // System color prefers the authoring-time RGB fallback.
        assert_eq!(
            color_to_css(&Color::System {
                value: "windowText".to_string(),
                last_color: Some("000000".to_string()),
            }),
            "#000000"
        );
        assert_eq!(
            color_to_css(&Color::System {
                value: "btnFace".to_string(),
                last_color: None,
            }),
            "btnFace"
        );
        // Preset names pass through (already CSS-like).
        assert_eq!(color_to_css(&Color::Preset("tomato".to_string())), "tomato");
    }

    #[test]
    fn alignment_to_css_maps_all_variants() {
        assert_eq!(alignment_to_css(TextAlign::Left), "left");
        assert_eq!(alignment_to_css(TextAlign::Center), "center");
        assert_eq!(alignment_to_css(TextAlign::Right), "right");
        assert_eq!(alignment_to_css(TextAlign::Justified), "justify");
        assert_eq!(alignment_to_css(TextAlign::JustifiedLow), "justify");
        assert_eq!(alignment_to_css(TextAlign::Distributed), "justify");
        assert_eq!(alignment_to_css(TextAlign::ThaiDistributed), "justify");
    }

    #[test]
    fn fill_to_css_degrades_non_solid_fills_to_tokens() {
        assert_eq!(fill_to_css(&Fill::None), "none");
        assert_eq!(
            fill_to_css(&Fill::Solid(Color::Rgb("00FF00".to_string()))),
            "#00FF00"
        );
        assert_eq!(fill_to_css(&Fill::Gradient(Default::default())), "gradient");
    }
}
