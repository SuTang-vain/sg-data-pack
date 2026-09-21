# Technical document build notes

The files in this directory are optional documentation sources and archived render inputs. They are not required by the Node CLI or the test suite.

## Requirements

- Python 3.9 or newer
- `python-docx` and `Pillow` for the Word brief
- `reportlab` for the PDF brief
- A licensed Chinese-capable TrueType `.ttf` font available in the new environment (the PDF renderer may reject CFF-based `.otf` files)

Keep these dependencies in a local, ignored virtual environment, for example:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install python-docx Pillow reportlab
```

Do not commit the virtual environment. The repository ignores `.venv/` and Python cache files.

## Build outputs

The scripts are checkout-relative and write to `.doc-build/output/` by default. That directory is intentionally ignored because it is a reproducible build workspace:

```bash
export SG_DOC_OUTPUT_DIR="$PWD/.doc-build/output"
export SG_DOC_FONT="/absolute/path/to/a/Chinese-capable-font.ttf"
export SG_DOC_FONT_NAME="Noto Sans CJK SC"  # logical font name used in the .docx

python .doc-build/build_technical_brief.py
python .doc-build/build_technical_pdf.py
```

`build_technical_brief.py` regenerates the three diagrams and the `.docx`. The PDF script reuses those diagrams when they exist; otherwise it uses the archived diagrams already committed under `.doc-build/`.

`SG_DOC_FONT` is deliberately required. The old local-only scripts silently fell back to macOS font paths, which could create missing Chinese glyphs after migration. A new environment must choose its own licensed font explicitly.

The source text describes the 2026-08-06 analysis. Rebuilding does not update those historical claims. Font substitution can change pagination; render and inspect the resulting pages before publishing. The handoff acceptance does not test document layout.

The final files once written to the old Desktop are not present at the paths referenced by the original scripts. Only the repository artifacts are handed over: the full Word brief must be rebuilt from source; `.doc-build/font-test.docx` is just a font test. PDF exports remain in `.doc-render-v1/` and `.doc-render-v2/`, while `.pdf-render-*` contain page images, not the original final standalone PDF.

The committed `.doc-render-*`, `.pdf-render-*`, and `.font-render*` directories are historical render/evidence artifacts. They are not overwritten by a normal build.
