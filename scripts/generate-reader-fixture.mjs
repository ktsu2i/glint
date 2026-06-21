import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "frontend/testdata/generated-reader.pdf");
const encoder = new TextEncoder();

function stream(content) {
  return `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`;
}

function page(contentObject) {
  return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
  /Resources << /Font << /Body 9 0 R /Code 10 0 R >> >>
  /Contents ${contentObject} 0 R >>`;
}

const objects = [
  "<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R /PageMode /UseOutlines >>",
  "<< /Type /Pages /Kids [4 0 R 5 0 R 6 0 R] /Count 3 >>",
  "<< /Type /Outlines /First 7 0 R /Last 8 0 R /Count 2 >>",
  page(11),
  page(12),
  page(13),
  "<< /Title (Section 1: Context Budgets) /Parent 3 0 R /Dest [4 0 R /Fit] /Next 8 0 R >>",
  "<< /Title (Section 2: Evidence) /Parent 3 0 R /Dest [6 0 R /Fit] /Prev 7 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  stream(`BT
/Body 22 Tf 72 720 Td (Section 1: Context Budgets) Tj
/Body 12 Tf 0 -42 Td (A reader should send only the context selected by the user.) Tj
0 -22 Td (Bounded context keeps requests focused and reviewable.) Tj
/Code 11 Tf 18 -54 Td (const budget = trimContext(selection, 6000);) Tj
/Body 10 Tf 198 -528 Td (1) Tj
ET`),
  stream(`BT
/Body 22 Tf 72 720 Td (Context Selection) Tj
/Body 12 Tf 0 -42 Td (Selected text and the current page are explicit context scopes.) Tj
0 -22 Td (Navigation must preserve a predictable reading experience.) Tj
/Body 10 Tf 216 -604 Td (2) Tj
ET`),
  stream(`BT
/Body 22 Tf 72 720 Td (Section 2: Evidence) Tj
/Body 12 Tf 0 -42 Td (Grounded answers cite both book locations and repository symbols.) Tj
0 -22 Td (Weak evidence should remain visible instead of being overstated.) Tj
/Code 11 Tf 18 -54 Td (return { bookPage, repoPath, confidence };) Tj
/Body 10 Tf 198 -528 Td (3) Tj
ET`),
];

let pdf = "%PDF-1.7\n% Glint generated reader fixture\n";
const offsets = objects.map((object, index) => {
  const offset = encoder.encode(pdf).byteLength;
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  return offset;
});
const xrefOffset = encoder.encode(pdf).byteLength;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f\n`;
pdf += offsets
  .map((offset) => `${String(offset).padStart(10, "0")} 00000 n\n`)
  .join("");
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, encoder.encode(pdf));
console.log(`Generated ${outputPath}`);
