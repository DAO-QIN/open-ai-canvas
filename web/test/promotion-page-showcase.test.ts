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

test("portrait product shots placed in wide tiles keep the product in frame", () => {
    expect(page).toMatch(/case-96017ad7706f\.webp", label: "耳机广告", shape: "wide", focus: "\d+% \d+%"/);
    expect(page).toContain("objectPosition: item.focus");
});
