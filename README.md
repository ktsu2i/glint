# Glint

**English** | [日本語](README.ja.md)

Glint is a desktop reading app for technical books. Open a PDF, read it the way you would in a proper reader — table of contents, bookmarks, spreads, full-text search — and ask an AI assistant about the page in front of you without leaving the book.

Your books, your reading positions, and your API keys stay on your machine. Nothing is sent to an AI provider unless you attach it to a question yourself.

## What you can do

### Keep a local library

- Add technical books from your Mac with the native file picker (PDF, and EPUB for search).
- See every imported book on a shelf with its cover, and pick up exactly where you stopped.
- Rename a book to whatever you actually call it, or remove it from the shelf.
- If you move or delete the original file, Glint tells you and lets you point it at the file again.

### Read

- Read PDFs page by page, or as two-page spreads.
- Switch between left-side and right-side binding, so Japanese books turn the right way.
- Zoom in and out, or fit the page to the window.
- Jump around with the table of contents, the page slider, or by typing a page number.
- Bookmark pages and return to them from the bookmarks panel.
- Have the current page read aloud, with automatic advance to the next page.
- Read in light or dark mode, or follow your system setting. The page itself stays as the author made it.
- Use Glint in English or Japanese.

### Search

- Search inside the book you are reading with `⌘F` and jump to any matching page.
- Search across every book you have imported and open the right book at the right page.

### Ask about what you are reading

- A chat sidebar sits next to the page, so a question never takes you out of the book.
- Select text on the page and attach it to your question — or ask with no context at all.
- Attached context is shown to you before you send it, so you always know what leaves your machine.
- Answers stream in as they are generated, and you can cancel a response mid-flight.
- Switch models per conversation from the composer without opening settings.

### Bring your own model

Glint talks to the provider you choose:

- OpenRouter
- OpenAI
- Anthropic
- Google Gemini
- Ollama (runs locally, no API key)
- Any OpenAI-compatible endpoint you add yourself

The library, reader, and search all work with no provider configured. AI features are the only part that needs one.

### EPUB, for now

EPUB files can be imported and searched from the library, and they appear on your shelf like any other book. The EPUB reading view is still being built, so opening one shows a placeholder for the moment. PDFs are fully readable today.

## Getting started

Glint runs on macOS. There is no prebuilt download yet, so you build it once from source.

You need:

- Go 1.23 or newer
- Node.js 20.19+ or 22.12+
- pnpm 10.30.2
- Wails CLI v2.12.0

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
```

Wails may need a few extra system tools; see the [Wails installation guide](https://wails.io/docs/gettingstarted/installation) if the build complains.

Then build the app:

```bash
cd frontend
pnpm install --frozen-lockfile
cd ..
wails build
```

The finished app lands at `build/bin/glint.app`. Move it to your Applications folder and open it like any other Mac app.

## Setting up an AI provider

1. Open **Settings** from the sidebar.
2. Under **LLM Providers**, pick a provider and paste its API key. Ollama needs no key — it uses your local endpoint.
3. To use a service that speaks the OpenAI API but isn't listed, choose **Add OpenAI-compatible endpoint** and enter its base URL, an optional API key, and any custom headers.
4. Press **Test connection** to confirm the key and model work before you rely on them.
5. Back in the reader, choose the provider and model you want from the model selector in the chat composer.

## What leaves your machine

- **Your books never leave.** PDFs, EPUBs, covers, reading positions, and bookmarks are stored locally on your Mac.
- **Only what you send.** Your question and any page text you explicitly attach go to the provider you selected. Nothing else is transmitted, and nothing is sent at all until you press send.
- **Keys are kept in the OS credential store,** not in Glint's own database. Once saved, a key is never read back into the interface.
- **OpenRouter requests are pinned to zero-data-retention endpoints**, so they are not routed through providers that retain your prompts.
- Glint manages the endpoint, API version, and authentication for the built-in providers, so there is nothing to misconfigure.

## Where Glint is going

Reading and asking questions is the foundation. The goal is a reader that connects a book to your own code: point Glint at one of your repositories, and go from a chapter you are reading to the files, symbols, and patterns in your codebase that it describes — with citations back to both the book and the code. That work is in progress and not part of the app yet.

## Working on Glint

Glint is built with Wails v2, Go, React 19 + TypeScript, PDF.js, and SQLite. To run it from source with live reload, install the prerequisites above, then:

```bash
cd frontend
pnpm install --frozen-lockfile
cd ..
wails dev
```

The frontend is pinned to pnpm 10.30.2; `npm install` and `npm run` fail by design.

Tests:

```bash
go test ./...
cd frontend
pnpm test
pnpm run build
```
