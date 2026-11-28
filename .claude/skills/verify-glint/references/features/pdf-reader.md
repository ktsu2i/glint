# PDF reader

The reader that renders PDFs with PDF.js: page turns, going to a page number, the slider, view settings, and restoring the reading position.

## Sub-features

- page-turn: "Previous page" and "Next page", arrow keys, PageUp / PageDown
- go-to-page: "Go to page" in the bottom bar turns into a "Page number" field; type a number and press Enter
- page-slider: "Page slider" picks a page. Hovering shows the page number and a preview
- toc: "Open table of contents" opens the outline; items jump to their page
- view-menu: "View" switches binding (Left binding / Right binding) and zoom (Zoom out / Zoom in / Fit page)
- reading-position: the current page is saved, and the book opens there next time
- text-layer: the PDF.js text layer, which selection (highlights) and in-book search build on

## How to get to it (user POV)

Click a card or "Continue" in the library. A book also opens right after import.

## Driving it with glint-driver

```bash
node frontend/scripts/glint-driver.mjs wait ".text-layer[data-page='1'] span"
node frontend/scripts/glint-driver.mjs press ArrowRight
node frontend/scripts/glint-driver.mjs eval "document.querySelector('[aria-label=\"Go to page\"]')?.textContent"   # "2 / 3"

# go to a page number
node frontend/scripts/glint-driver.mjs click button "Go to page"
node frontend/scripts/glint-driver.mjs click-css "input[aria-label='Page number']"
node frontend/scripts/glint-driver.mjs press Meta+A
node frontend/scripts/glint-driver.mjs type 3
node frontend/scripts/glint-driver.mjs press Enter

# right binding reverses the arrow keys
node frontend/scripts/glint-driver.mjs click button "View"
node frontend/scripts/glint-driver.mjs click button "Right binding"
node frontend/scripts/glint-driver.mjs press Escape
node frontend/scripts/glint-driver.mjs sql "select page_number, binding_direction from book_reading_states"

# restore the reading position
node frontend/scripts/glint-driver.mjs restart-app
node frontend/scripts/glint-driver.mjs click button "/Continue generated-reader/"
node frontend/scripts/glint-driver.mjs eval "document.querySelector('[aria-label=\"Go to page\"]')?.textContent"
```

For actions that change the rendering (zoom, spread, binding), also keep a `screenshot`.

## Gotchas

- The "Setting up fake worker" warning is expected. The PDF.js worker runs on the main thread on purpose (`frontend/src/shared/pdf/loadPdf.ts`).
- The text layer is created after rendering. Wait for `.text-layer[data-page='N'] span` before selecting or searching.
- With right binding, ArrowLeft goes forward. Check the current binding before testing keys.
- Read the current page from "Go to page" in the bottom bar (`N / 3`) or from the text under the title.
- Saving the reading position is asynchronous. Before `restart-app`, check with `sql` that `book_reading_states` was updated.
