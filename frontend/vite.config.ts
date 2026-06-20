import { createReadStream, copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

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
    if (!req.url || !req.url.startsWith(urlPrefix)) {
      return next();
    }
    const relative = decodeURIComponent(req.url.slice(urlPrefix.length).split("?")[0]);
    const target = resolve(dir, "." + (relative.startsWith("/") ? relative : `/${relative}`));
    if (!target.startsWith(dir)) {
      return next();
    }
    try {
      if (!statSync(target).isFile()) {
        return next();
      }
    } catch {
      return next();
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

export default defineConfig({
  plugins: [react(), pdfjsAssetsPlugin()],
  clearScreen: false,
  server: {
    strictPort: true,
  },
});
