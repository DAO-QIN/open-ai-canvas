// npm install --prefix .local/avatar-generator --save-exact @dicebear/core@9.4.2 @dicebear/big-smile@9.4.2
// node scripts/generate-profile-avatars.mjs
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireGenerator = createRequire(resolve(root, ".local/avatar-generator/package.json"));
const { createAvatar } = await import(pathToFileURL(requireGenerator.resolve("@dicebear/core")).href);
const style = await import(pathToFileURL(requireGenerator.resolve("@dicebear/big-smile")).href);
for (const name of ["core", "big-smile"]) {
  const file = resolve(root, `.local/avatar-generator/node_modules/@dicebear/${name}/package.json`);
  if (JSON.parse(await readFile(file, "utf8")).version !== "9.4.2") throw new Error(`Expected @dicebear/${name}@9.4.2`);
}
const output = resolve(root, "web/public/avatars/spirit-v1");
await mkdir(output, { recursive: true });
const colors = ["dcecf5", "e9e2f5", "dff0e5", "faeacb", "f6e1df", "e0e9f1"];
const hairstyles = ["shortHair", "wavyBob", "curlyBob", "straightHair", "braids", "bunHair", "froBun", "bangs", "curlyShortHair", "bowlCutHair", "shavedHead", "halfShavedHead"];
const expressions = [
  { eyes: "cheery", mouth: "openedSmile" },
  { eyes: "normal", mouth: "teethSmile" },
  { eyes: "winking", mouth: "gapSmile" },
  { eyes: "starstruck", mouth: "openedSmile" },
];
const hairColors = ["302c3b", "634a42", "987255", "6760a9", "3c726b", "c18b4c"];
const skinColors = ["ffe4c0", "f5d7b1", "efcc9f", "e2ba87", "c99c62", "a47539", "8c5a2b", "643d19"];
const manifest = [];
for (let index = 0; index < 48; index++) {
  const id = `spirit-v1-${String(index + 1).padStart(2, "0")}`;
  const options = {
    seed: id,
    size: 128,
    radius: 50,
    scale: 100,
    backgroundColor: [colors[index % colors.length]],
    hair: [hairstyles[index % hairstyles.length]],
    hairColor: [hairColors[(index + Math.floor(index / hairstyles.length)) % hairColors.length]],
    skinColor: [skinColors[(index * 3 + Math.floor(index / hairstyles.length)) % skinColors.length]],
    eyes: [expressions[Math.floor(index / hairstyles.length)].eyes],
    mouth: [expressions[Math.floor(index / hairstyles.length)].mouth],
    accessories: [index % 2 ? "catEars" : "glasses"],
    accessoriesProbability: index % 5 === 0 ? 100 : 0,
  };
  const svg = createAvatar(style, options).toString();
  if (/<(?:script|animate|animateTransform|set|foreignObject)\b|\bon\w+=|(?:href|src)=["'](?:https?:|\/\/)/i.test(svg)) throw new Error(`Unexpected active SVG: ${id}`);
  await writeFile(resolve(output, `${id}.svg`), svg + "\n");
  manifest.push({ id, options, bytes: Buffer.byteLength(svg + "\n"), sha256: createHash("sha256").update(svg + "\n").digest("hex") });
}
if (new Set(manifest.map(item => item.sha256)).size !== 48) throw new Error("Duplicate avatars");
await writeFile(resolve(output, "manifest.json"), JSON.stringify({ generator: "DiceBear 9.4.2", style: "big-smile", attribution: { title: "Custom Avatar", creator: "Ashley Seo", source: "https://www.figma.com/community/file/881358461963645496", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", changes: "Generated combinations with curated expressions, colors, circular backgrounds and scale using DiceBear." }, avatars: manifest }, null, 2) + "\n");
await writeFile(resolve(output, "LICENSE.txt"), await readFile(resolve(root, ".local/avatar-generator/node_modules/@dicebear/big-smile/LICENSE")));
console.log(JSON.stringify({ count: manifest.length, totalSvgBytes: manifest.reduce((total, item) => total + item.bytes, 0), maxSvgBytes: Math.max(...manifest.map(item => item.bytes)) }));
