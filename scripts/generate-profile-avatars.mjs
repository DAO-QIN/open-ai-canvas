// npm install --prefix .local/avatar-generator-planets --save-exact @dicebear/core@10.7.0 @dicebear/styles@10.6.0
// node scripts/generate-profile-avatars.mjs
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireGenerator = createRequire(resolve(root, ".local/avatar-generator-planets/package.json"));
const { Avatar, Style } = await import(pathToFileURL(requireGenerator.resolve("@dicebear/core")).href);
const definition = JSON.parse(await readFile(requireGenerator.resolve("@dicebear/styles/planets.json"), "utf8"));
const style = new Style(definition);
for (const [name, version] of [["core", "10.7.0"], ["styles", "10.6.0"]]) {
  const file = resolve(root, `.local/avatar-generator-planets/node_modules/@dicebear/${name}/package.json`);
  if (JSON.parse(await readFile(file, "utf8")).version !== version) throw new Error(`Expected @dicebear/${name}@${version}`);
}
const output = resolve(root, "web/public/avatars/spirit-v1");
await mkdir(output, { recursive: true });
const manifest = [];
for (let index = 0; index < 48; index++) {
  const id = `spirit-v1-${String(index + 1).padStart(2, "0")}`;
  const options = {
    // Keep the first six identical to the round G-style samples selected by the user.
    seed: `yinghui-preview-${index + 10}`,
    size: 128,
    borderRadius: 50,
    idRandomization: false,
    animationVariant: "none",
  };
  const svg = new Avatar(style, options).toString();
  if (/<(?:script|animate|animateTransform|set|foreignObject)\b|\bon\w+=|(?:href|src)=["'](?:https?:|\/\/)/i.test(svg)) throw new Error(`Unexpected active SVG: ${id}`);
  await writeFile(resolve(output, `${id}.svg`), svg + "\n");
  manifest.push({ id, options, bytes: Buffer.byteLength(svg + "\n"), sha256: createHash("sha256").update(svg + "\n").digest("hex") });
}
if (new Set(manifest.map(item => item.sha256)).size !== 48) throw new Error("Duplicate avatars");
await writeFile(resolve(output, "manifest.json"), JSON.stringify({ generator: "DiceBear Core 10.7.0 / Styles 10.6.0", style: "planets", attribution: { ...definition.meta, changes: "Generated 48 static circular variants; animations disabled." }, avatars: manifest }, null, 2) + "\n");
const generatorLicense = await readFile(resolve(root, ".local/avatar-generator-planets/node_modules/@dicebear/core/LICENSE"), "utf8");
await writeFile(resolve(output, "LICENSE.txt"), `Avatar design: Planets\n${definition.meta.license.text}\nChanges: 48 static circular variants; animations disabled.\n\nGenerator code license:\n${generatorLicense}`);
console.log(JSON.stringify({ count: manifest.length, totalSvgBytes: manifest.reduce((total, item) => total + item.bytes, 0), maxSvgBytes: Math.max(...manifest.map(item => item.bytes)) }));
