import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const page = readFileSync(join(root, "src/pages/promotion/index.tsx"), "utf8");
const styles = readFileSync(join(root, "src/pages/promotion/promotion.css"), "utf8");

test("invite hero mixes e-commerce and short-drama works, all from bundled public assets", () => {
    const images = [...page.matchAll(/src: "(\/[^"]+\.(?:jpg|webp|png))"/g)].map((match) => match[1]);
    expect(images.length).toBeGreaterThanOrEqual(6);
    for (const image of images) expect(existsSync(join(root, "public", image))).toBe(true);
    expect(images.filter((image) => image.startsWith("/short-drama-styles/")).length).toBeGreaterThanOrEqual(2);
    expect(images.filter((image) => image.startsWith("/inspiration-thumbs/")).length).toBeGreaterThanOrEqual(3);
    for (const word of ["商品主图", "带货视频", "模特换装", "AI 短剧"]) expect(page).toContain(word);
});

test("removed sticker copy stays out and reward accent is defined once per theme", () => {
    expect(page).not.toContain("好友每笔充值都算");
    expect(page).not.toContain("返利");
    expect(styles.match(/--promo-accent:/g)?.length).toBe(1);
    expect(styles).toContain("prefers-reduced-motion");
});
