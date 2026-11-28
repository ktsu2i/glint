// Generates frontend/testdata/generated-reader.epub, a small EPUB 3 book with
// original text: a cover, a nav document, three chapters long enough to span
// several pages, and one chapter carrying active content (a script, an event
// handler, and a javascript: link) that the reader must strip.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "frontend/testdata/generated-reader.epub");
const encoder = new TextEncoder();

const chapters = [
  {
    id: "chapter-1",
    title: "Chapter 1: Context Budgets",
    topic: "a context budget",
  },
  {
    id: "chapter-2",
    title: "Chapter 2: Active Content",
    topic: "active content",
    active: true,
  },
  {
    id: "chapter-3",
    title: "Chapter 3: Evidence",
    topic: "evidence",
  },
];

function paragraphs(topic) {
  return Array.from(
    { length: 24 },
    (_, index) =>
      `<p>Paragraph ${index + 1} on ${topic}. A reader keeps the place, the selection, and ` +
      `the saved notes together, so returning to a page shows the same words in the same ` +
      `order. Each paragraph is long enough to wrap across several lines on a wide page.</p>`,
  ).join("\n    ");
}

function chapter({ title, topic, active }) {
  const activeMarkup = active
    ? `
    <script>document.documentElement.setAttribute("data-epub-script-ran", "yes");</script>
    <p id="active-handler" onclick="document.documentElement.setAttribute('data-epub-handler-ran', 'yes')">This paragraph carries an inline event handler.</p>
    <p><a id="active-link" href="javascript:document.documentElement.setAttribute('data-epub-link-ran','yes')">This link points to a javascript: URL.</a></p>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head>
    <title>${title}</title>
    <link rel="stylesheet" href="style.css" type="text/css"/>
  </head>
  <body>
    <h1>${title}</h1>${activeMarkup}
    <pre><code>const budget = trimContext(selection, 6000);</code></pre>
    ${paragraphs(topic)}
  </body>
</html>
`;
}

const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${chapters.map(({ id, title }) => `        <li><a href="${id}.xhtml">${title}</a></li>`).join("\n")}
      </ol>
    </nav>
  </body>
</html>
`;

const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:5f0c7a52-0b8e-4c3f-9c43-6a1f2f1f0e01</dc:identifier>
    <dc:title>Generated Reader EPUB</dc:title>
    <dc:creator>Glint</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
${chapters.map(({ id, active }) => `    <item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"${active ? ' properties="scripted"' : ""}/>`).join("\n")}
  </manifest>
  <spine>
${chapters.map(({ id }) => `    <itemref idref="${id}"/>`).join("\n")}
  </spine>
</package>
`;

const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const style = `body { font-family: serif; line-height: 1.5; }
pre { font-family: monospace; }
`;

// A 4x6 PNG in two colors, so the cover is visibly not blank.
function png() {
  const width = 4;
  const height = 6;
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = [];
  for (let y = 0; y < height; y++) {
    const color = y < height / 2 ? [46, 94, 82] : [221, 230, 227];
    rows.push(Buffer.from([0, ...Array.from({ length: width }, () => color).flat()]));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A stored (uncompressed) zip with fixed timestamps, so the output is stable.
// The mimetype entry comes first, as EPUB requires.
function zip(entries) {
  const dosTime = 0;
  const dosDate = (2026 - 1980) << 9 | (1 << 5) | 1;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

const entries = [
  ["mimetype", encoder.encode("application/epub+zip")],
  ["META-INF/container.xml", encoder.encode(container)],
  ["OEBPS/content.opf", encoder.encode(opf)],
  ["OEBPS/nav.xhtml", encoder.encode(nav)],
  ["OEBPS/style.css", encoder.encode(style)],
  ["OEBPS/cover.png", png()],
  ...chapters.map((entry) => [`OEBPS/${entry.id}.xhtml`, encoder.encode(chapter(entry))]),
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, zip(entries));
