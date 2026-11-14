// Компьютерын өргөтгөлийн pagetr.js-ийг утасны апп руу текст болгон хуулна (нэг кодоос хоёулаа ажиллана).
// `npm start`, `npm run typecheck` бүрд өөрөө ажиллана. Үүссэн файлыг гараар бүү засаарай.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, "..", "..", "extension");
const out = join(here, "..", "src", "web", "extension.generated.ts");

const pagetr = readFileSync(join(ext, "pagetr.js"), "utf8");
const version = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8")).version;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out,
  "// АВТОМАТААР ҮҮССЭН (scripts/sync-web.mjs) — гараар бүү засаарай. Эх: extension/pagetr.js\n" +
  `export const EXTENSION_VERSION = ${JSON.stringify(version)};\n` +
  `export const PAGETR_JS = ${JSON.stringify(pagetr)};\n`);
console.log("pagetr.js → src/web/extension.generated.ts (" + pagetr.length + " тэмдэгт)");
