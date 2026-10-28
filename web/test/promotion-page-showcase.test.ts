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

test("consumer surfaces around the invite page use reward wording", () => {
    const topBar = readFileSync(join(root, "src/components/layout/workspace-top-bar.tsx"), "utf8");
    const wallet = readFileSync(join(root, "src/components/layout/workspace-wallet-modal.tsx"), "utf8");
    // 活动关闭时顶栏沿用页面标题「我的奖励」，钱包流水同样不出现「返利」。
    expect(topBar).toContain("promotionView.title");
    expect(topBar).not.toContain('"返利"');
    expect(wallet).toContain("邀请奖励领取");
    expect(wallet).not.toContain("返利");
});

test("wide collage tiles use square sources so the cropped edge never loses the product", () => {
    // WebP 头部：VP8 帧在第 26 字节起各 14 位宽高；VP8L 在第 21 字节起各 14 位（减一）；VP8X 在第 24 字节起各 24 位（减一）。
    const size = (file: string): [number, number] => {
        const data = readFileSync(join(root, "public", file));
        const chunk = data.toString("ascii", 12, 16);
        if (chunk === "VP8 ") return [data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff];
        if (chunk === "VP8L") {
            const bits = data.readUInt32LE(21);
            return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
        }
        if (chunk === "VP8X") return [data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1];
        throw new Error("unsupported image " + file);
    };
    const wide = [...page.matchAll(/src: "(\/[^"]+\.webp)", label: "[^"]+", shape: "wide"/g)].map((match) => match[1]);
    expect(wide.length).toBe(3);
    for (const file of wide) {
        const [width, height] = size(file);
        expect(width).toBeGreaterThanOrEqual(height);
    }
});
