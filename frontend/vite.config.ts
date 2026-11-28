import { createReadStream, copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const pdfjsDir = resolve(require.resolve("pdfjs-dist/package.json"), "..");
const cmapsSrc = join(pdfjsDir, "cmaps");
const standardFontsSrc = join(pdfjsDir, "standard_fonts");

const mimeMap: Record<string, string> = {
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function copyDir(src: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const sourcePath = join(src, entry);
    const targetPath = join(dest, entry);
    if (statSync(sourcePath).isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function serveFolder(urlPrefix: string, dir: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url === undefined || !req.url.startsWith(urlPrefix)) {
      next();
      return;
    }
    const relative = decodeURIComponent(req.url.slice(urlPrefix.length).split("?")[0] ?? "");
    const target = resolve(dir, `.${relative.startsWith("/") ? relative : `/${relative}`}`);
    if (!target.startsWith(dir)) {
      next();
      return;
    }
    try {
      if (!statSync(target).isFile()) {
        next();
        return;
      }
    } catch {
      next();
      return;
    }
    res.setHeader("Content-Type", mimeMap[extname(target)] ?? "application/octet-stream");
    createReadStream(target).pipe(res);
  };
}

function pdfjsAssetsPlugin(): Plugin {
  let isBuild = false;
  let outDir = "dist";
  return {
    name: "pdfjs-assets",
    configResolved(config) {
      isBuild = config.command === "build";
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use(serveFolder("/pdfjs/cmaps/", cmapsSrc));
      server.middlewares.use(serveFolder("/pdfjs/standard_fonts/", standardFontsSrc));
    },
    closeBundle() {
      if (!isBuild) {
        return;
      }
      const absoluteOut = resolve(outDir);
      copyDir(cmapsSrc, join(absoluteOut, "pdfjs/cmaps"));
      copyDir(standardFontsSrc, join(absoluteOut, "pdfjs/standard_fonts"));
    },
  };
}

// foliate-js can also open PDFs with its own copy of PDF.js. Glint reads PDFs
// with its own reader, so that path is replaced with a stub and the copy stays
// out of the build.
function foliateWithoutPdfPlugin(): Plugin {
  const stubId = "\0foliate-pdf-stub";
  return {
    name: "foliate-without-pdf",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./pdf.js" && importer?.includes("/foliate-js/") === true) {
        return stubId;
      }
      return null;
    },
    load(id) {
      if (id === stubId) {
        return 'export const makePDF = () => { throw new Error("PDF is read by the PDF reader"); };';
      }
      return null;
    },
  };
}

/*
 * The Content Security Policy of the built app. EPUB sections are shown from
 * blob: URLs on this origin, in frames that must allow scripts for WebKit to
 * deliver events to the reader, so this policy is what keeps a book's scripts
 * from running: blob: documents inherit it, and it allows only the app's own.
 * The Wails runtime is injected by the webview and is not subject to it. The
 * development server needs inline scripts, so the policy applies to builds.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicyPlugin(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssetsPlugin(), foliateWithoutPdfPlugin(), contentSecurityPolicyPlugin()],
  clearScreen: false,
  build: {
    // The largest chunk is PDF.js's prebuilt worker (about 1.2 MB), which
    // cannot be split and loads only when a PDF is opened. Everything else
    // stays well under Vite's default 500 kB.
    chunkSizeWarningLimit: 1300,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/**/*.test.{ts,tsx}", "src/test/**"],
      reporter: ["text", "json-summary", "html"],
    },
  },
  server: {
    strictPort: true,
  },
});
