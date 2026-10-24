import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { applyAppearanceMetadata, normalizePublicAppearance } from "../src/stores/use-appearance-store";

const readProjectFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("initial HTML requests this deployment's icon without waiting for JavaScript", () => {
    const html = readProjectFile("index.html");
    expect(html).toContain('href="/api/public/appearance/icon/favicon.ico"');
    expect(html).toContain('href="/api/public/appearance/icon/apple-touch-icon.png"');
    expect(html).not.toContain('href="data:,"');
    expect(html).not.toContain('href="/logo.svg"');
});

test("favicon stays independent of both site logos when the page theme changes", () => {
    const window = new Window({ url: "https://brand.test/" });
    const doc = window.document as unknown as Document;
    const appearance = normalizePublicAppearance({ brandName: "影绘", logoUrl: "/black-logo.png", darkLogoUrl: "/white-logo.png", faviconUrl: "/api/public/appearance/icons/source/favicon.ico", appleTouchIconUrl: "/api/public/appearance/icons/source/apple-touch-icon.png" });
    applyAppearanceMetadata(appearance, doc);
    const icon = doc.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
    expect(icon.href).toBe("https://brand.test/api/public/appearance/icons/source/favicon.ico");
    doc.documentElement.classList.add("dark");
    applyAppearanceMetadata(appearance, doc);
    expect(doc.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    expect(icon.href).toBe("https://brand.test/api/public/appearance/icons/source/favicon.ico");
    expect(icon.getAttribute("sizes")).toBe("16x16 32x32 48x48");
    expect(doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe(appearance.appleTouchIconUrl);
    window.happyDOM.abort();
});
