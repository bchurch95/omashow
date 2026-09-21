# Corpus fixtures

Real-world PPTX packages used by `tests/corpus.rs`. Stored as `.bin` because
the repository gitignores `*.pptx`; each file is an unmodified, byte-exact
copy of the original (see `provenance` below for the source name).

| file | original | producing application | slides |
|---|---|---|---|
| `m365_null_dates.bin` | `49386-null_dates.pptx` | Microsoft Office PowerPoint 12 (2007) | 1 |
| `m365_with_master.bin` | `WithMaster.pptx` | Microsoft Office PowerPoint 14 (2010) | 2 |
| `m365_themes.bin` | `themes.pptx` | Microsoft Office PowerPoint 14 (2010) | 10 |
| `m365_bug64693.bin` | `bug64693.pptx` | Microsoft Office PowerPoint 15 (2013) | 1 |
| `m365_sampleshow.bin` | `SampleShow.pptx` | Microsoft Office PowerPoint 16 (2016) | 2 |
| `m365_smartart.bin` | `SmartArt.pptx` | Microsoft Office PowerPoint 16 (2016) | 1 |
| `m365_artistic_effects.bin` | `ArtisticEffectSample.pptx` | Microsoft Office PowerPoint 16 (2016) | 2 |
| `m365_mac_key02.bin` | `KEY02.pptx` | Microsoft Macintosh PowerPoint 14 | 1 |
| `libreoffice_100610.bin` | `LIBRE_OFFICE-100610-0.pptx` | LibreOffice 5.1.3.2 (Windows) | 17 |
| `libreoffice_picture_transparency.bin` | `picture-transparency.pptx` | LibreOffice 25.8.4.2 (Linux) | 4 |

## Provenance

- The `m365_*` files come from the [Apache POI test suite](https://github.com/apache/poi)
  (`test-data/slideshow/`), Apache License 2.0. They are user-submitted bug
  reports, so they carry real-world mess: custom geometry, SmartArt, artistic
  effects, embedded media, and long-ago PowerPoint versions.
- The `libreoffice_*` files come from the same POI corpus; their
  `docProps/app.xml` identifies LibreOffice as the producing application.

## Vendor coverage notes

- **Microsoft 365 / PowerPoint**: covered across spec versions 2007–2016,
  Windows and macOS builds.
- **Google Slides and Apple Keynote**: genuine exports from these apps are not
  available in the public-domain test corpora (POI, Open-XML-SDK,
  LibreOffice). If you can obtain a Google Slides or Keynote export under a
  license that permits redistribution, drop it in here as `<vendor>_<name>.bin`
  and add it to `FIXTURES` in `tests/corpus.rs`.

¹ **Known upstream reader rejections.** `m365_smartart.bin` uses SmartArt
(`dgm:relIds` diagram parts) and `m365_bug64693.bin` embeds a legacy OLE
object inside `mc:AlternateContent`. office-toolkit has no model for either
yet, so `PptxDocument::open` rejects both with a typed
`Error::PowerPoint` ("…relationship … is not declared in the slide's own
.rels part"). `tests/corpus.rs::known_rejections_fail_cleanly` pins that
contract: these files must fail with that stable message — never panic,
never silently accept.
