"""Build the realistic python-pptx fixture used by `verify_real`.

Run:
    uv run --with python-pptx python scripts/make_real_deck.py /tmp/omashow-rt/real.pptx

Produces a 3-slide deck with a title slide, bullets, speaker notes and an
embedded picture — the part web office-toolkit 1.0's writer does not model
(11 slide layouts, notes master, thumbnail, printer settings) is exactly what
the lossless-save tests protect.
"""
import sys

from pptx import Presentation
from pptx.util import Inches

PNG = bytes([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
    8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 96,
    248, 95, 15, 0, 2, 135, 1, 128, 235, 71, 186, 146, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
])

out_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/omashow-rt/real.pptx"
png_path = out_path + ".dot.png"
with open(png_path, "wb") as f:
    f.write(PNG)

prs = Presentation()

s = prs.slides.add_slide(prs.slide_layouts[0])
s.shapes.title.text = "Q3 Quarterly Review"
s.placeholders[1].text = "Engineering & Product"

s = prs.slides.add_slide(prs.slide_layouts[1])
s.shapes.title.text = "Highlights"
body = s.placeholders[1].text_frame
body.text = "Shipped the new scheduler"
for line in ("Cut build times by 40%", "On-call incidents down to two", "Hired three engineers"):
    p = body.add_paragraph()
    p.text = line
s.notes_slide.notes_text_frame.text = "Emphasize the build-time win; it paid for itself in Q4."

s = prs.slides.add_slide(prs.slide_layouts[1])
s.shapes.title.text = "Next Quarter"
body = s.placeholders[1].text_frame
body.text = "Migrate the rendering pipeline"
p = body.add_paragraph()
p.text = "Ship the mobile viewer"
s.shapes.add_picture(png_path, Inches(6), Inches(4), Inches(1), Inches(1))

prs.save(out_path)
print(f"wrote {out_path}")
