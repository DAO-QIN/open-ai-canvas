// npm install --prefix .local/avatar-generator --save-exact @dicebear/core@9.4.2 @dicebear/bottts-neutral@9.4.2
// node scripts/generate-profile-avatars.mjs
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireGenerator = createRequire(resolve(root, ".local/avatar-generator/package.json"));
const { createAvatar } = await import(pathToFileURL(requireGenerator.resolve("@dicebear/core")).href);
const style = await import(pathToFileURL(requireGenerator.resolve("@dicebear/bottts-neutral")).href);
for (const name of ["core", "bottts-neutral"]) {
  const file = resolve(root, `.local/avatar-generator/node_modules/@dicebear/${name}/package.json`);
  if (JSON.parse(await readFile(file, "utf8")).version !== "9.4.2") throw new Error(`Expected @dicebear/${name}@9.4.2`);
}
const output = resolve(root, "web/public/avatars/spirit-v1");
await mkdir(output, { recursive: true });
const colors = ["4c78a8", "7964ad", "32877d", "aa7b32", "b16950", "5b758d"];
const eyes = ["eva", "happy", "round", "roundFrame01", "roundFrame02", "glow", "hearts", "robocop"];
const mouths = ["smile01", "smile02", "square01", "grill01", "square02", "grill03", "smile01", "smile02"];
const manifest = [];
for (let index = 0; index < 48; index++) {
  const id = `spirit-v1-${String(index + 1).padStart(2, "0")}`;
  const options = {
    seed: id,
    size: 128,
    backgroundColor: [colors[index % colors.length]],
    eyes: [eyes[Math.floor(index / colors.length)]],
    mouth: [mouths[(index % colors.length + Math.floor(index / colors.length)) % mouths.length]],
  };
  const svg = createAvatar(style, options).toString();
  if (/<(?:script|animate|animateTransform|set|foreignObject)\b|\bon\w+=|(?:href|src)=["'](?:https?:|\/\/)/i.test(svg)) throw new Error(`Unexpected active SVG: ${id}`);
  await writeFile(resolve(output, `${id}.svg`), svg + "\n");
  manifest.push({ id, options, bytes: Buffer.byteLength(svg + "\n"), sha256: createHash("sha256").update(svg + "\n").digest("hex") });
}
if (new Set(manifest.map(item => item.sha256)).size !== 48) throw new Error("Duplicate avatars");
await writeFile(resolve(output, "manifest.json"), JSON.stringify({ generator: "DiceBear 9.4.2", style: "bottts-neutral", avatars: manifest }, null, 2) + "\n");
await writeFile(resolve(output, "LICENSE.txt"), await readFile(resolve(root, ".local/avatar-generator/node_modules/@dicebear/bottts-neutral/LICENSE")));
console.log(JSON.stringify({ count: manifest.length, totalSvgBytes: manifest.reduce((total, item) => total + item.bytes, 0), maxSvgBytes: Math.max(...manifest.map(item => item.bytes)) }));
