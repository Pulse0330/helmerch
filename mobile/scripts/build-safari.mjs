// Safari өргөтгөлийн файлуудыг бэлдэнэ (targets/safari/assets/):
//   background.js ← src/safari/background.ts + аппын src/lib/translator.ts (store-ийг Safari-ийн storage-ээр сольж)
//   pagetr.js     ← ../extension/pagetr.js (компьютерын өргөтгөлийнх, өөрчлөлтгүй)
// `npm run build-safari` (CI-д iPhone build-ийн өмнө ажиллана). Үүссэн файлуудыг гараар бүү засаарай.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const assets = join(root, "targets", "safari", "assets");
mkdirSync(join(assets, "icons"), { recursive: true });

const shim = {
  name: "safari-store-shim",
  setup(b) {
    // translator.ts-ийн `./store` (React Native, expo-file-system) → Safari-ийн browser.storage хувилбар
    b.onResolve({ filter: /^\.\/store$/ }, (args) =>
      args.importer.includes(join("src", "lib")) ? { path: join(root, "src", "safari", "store-shim.ts") } : undefined);
  },
};

await build({
  entryPoints: [join(root, "src", "safari", "background.ts")],
  outfile: join(assets, "background.js"),
  bundle: true, format: "iife", target: ["safari15"], charset: "utf8", legalComments: "none",
  banner: { js: "// АВТОМАТААР ҮҮССЭН (scripts/build-safari.mjs) — гараар бүү засаарай." },
  plugins: [shim],
  logLevel: "warning",
});
copyFileSync(join(root, "..", "extension", "pagetr.js"), join(assets, "pagetr.js"));
copyFileSync(join(root, "..", "extension", "icons", "32.png"), join(assets, "icons", "32.png"));
console.log("Safari өргөтгөл → targets/safari/assets (background.js, pagetr.js)");
