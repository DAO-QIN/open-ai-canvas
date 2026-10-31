import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";

import { CreationAmbientBackdrop, CreationGridBackdrop, latestCreationResultImage } from "../src/pages/create/creation-backdrops";
import { CreationIcon } from "../src/pages/create/creation-icons";
import { CreationPlayStrip, creationPlays } from "../src/pages/create/creation-workspace-empty";
import { MediaResult } from "../src/pages/create/creation-workspace-messages";
import type { CreationMessage } from "../src/pages/create/creation-types";

const createDir = join(import.meta.dir, "../src/pages/create");
const read = (name: string) => readFileSync(join(createDir, name), "utf8");

// 创作类型菜单的图标与首页共用 components/creation/creation-type-icon（线框加实心四角星表示 AI 生成），不在此列。
test("创作页不再使用流光描边、跟随鼠标的聚光、发光按钮和 lucide 星星、魔棒图标", () => {
    for (const name of ["creation-workspace.tsx", "creation-workspace-messages.tsx", "creation-workspace-history.tsx", "creation-workspace-empty.tsx", "index.tsx"]) {
        const source = read(name);
        for (const banned of ["HoverBorderGradient", "SpotlightSurface", "WorkingGlow", "Sparkles", "WandSparkles"]) expect(`${name}:${source.includes(banned)}`).toBe(`${name}:false`);
    }
    // 走不到的旧画布 Agent 入口卡已删除。
    expect(existsSync(join(createDir, "creation-agent-entry.tsx"))).toBe(false);
});

test("创作页图标：24 栅格、1.75 线宽、圆角端点，只用 currentColor，默认对读屏隐藏", () => {
    const html = renderToStaticMarkup(<CreationIcon name="variant" />);
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke-width="1.75"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
});

test("玩法条：六种常用玩法，封面是仓库里的小图，点了只预填类型和提示词", () => {
    expect(creationPlays.map((play) => play.label)).toEqual(["头像", "海报", "商品图", "表情包", "故事分镜", "短视频"]);
    for (const play of creationPlays) {
        const file = join(import.meta.dir, "../public", play.cover);
        expect(existsSync(file)).toBe(true);
        expect(readFileSync(file).byteLength).toBeLessThan(16 * 1024);
        expect(["agent", "image", "video"]).toContain(play.mode);
        expect(play.prompt.endsWith("：")).toBe(true);
    }
    const dom = new Window();
    try {
        const calls: Array<[string, string]> = [];
        dom.document.body.innerHTML = renderToStaticMarkup(<CreationPlayStrip onStartPrompt={(mode, prompt) => calls.push([mode, prompt])} />);
        const buttons = Array.from(dom.document.querySelectorAll("button.creation-play-chip"));
        expect(buttons.map((button) => button.textContent)).toEqual(creationPlays.map((play) => play.label));
        expect(dom.document.querySelector(".creation-play-strip")?.getAttribute("aria-label")).toBe("玩法");
        for (const image of Array.from(dom.document.querySelectorAll("img"))) expect(image.getAttribute("alt")).toBe("");
    } finally {
        dom.close();
    }
});

test("空态背景：舞台铺底色和柔光，方格画在舞台插槽的 canvas 上、排在顶栏下面，进页面不再扩散光圈；对话背景取最新一张完成的结果图，资源图只取缩略图，同样挂进舞台插槽铺过顶栏", () => {
    const backdrops = read("creation-backdrops.css");
    expect(backdrops).toContain(".app-workspace-stage:has(.creation-home .creation-launchpad)");
    expect(backdrops).toContain(".app-user-workspace .creation-home:has(.creation-launchpad)");
    expect(backdrops).not.toContain("creation-launch-ripple");
    expect(backdrops).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
    const page = read("index.tsx");
    expect(page).not.toContain("CreationLaunchBackdrop");
    expect(page).toContain("<CreationGridBackdrop paused={launchpadCondensed} />");
    // 插槽是舞台的第一个子节点，顶栏和页面内容都画在它上面；不在工作区外壳里时不渲染。
    const shell = readFileSync(join(import.meta.dir, "../src/components/layout/app-top-nav.tsx"), "utf8");
    expect(shell).toMatch(/className="app-workspace-stage [^"]*"[^>]*>\s*<WorkspaceStageBackdropSlot \/>/);
    expect(renderToStaticMarkup(<CreationGridBackdrop />)).toBe("");
    const message = (patch: Partial<CreationMessage>): CreationMessage => ({ id: Math.random().toString(36), role: "assistant", content: "", createdAt: "2026-10-29T00:00:00Z", mode: "image", status: "done", ...patch });
    expect(latestCreationResultImage([])).toBe("");
    const messages = [
        message({ resultStorageKeys: ["resource:old"] }),
        message({ role: "user", resultStorageKeys: ["resource:user"] }),
        message({ resultStorageKeys: ["resource:latest"] }),
        message({ mode: "video", resultStorageKeys: ["resource:video"] }),
        message({ status: "error", resultStorageKeys: ["resource:failed"] }),
    ];
    expect(latestCreationResultImage(messages)).toEndWith("/resources/latest/file?variant=thumbnail");
    // 没有资源 ID 时退回未过期的地址；过期的签名地址不拿来当背景。
    expect(latestCreationResultImage([message({ resultUrls: ["https://cdn.example/a.png?expires=1"] })])).toBe("");
    expect(latestCreationResultImage([message({ resultUrls: ["https://cdn.example/b.png"] })])).toBe("https://cdn.example/b.png");
    // 对话背景也挂进舞台插槽、从透明顶栏下面穿过，顶栏不再是一道没上色的黑条；内容区不铺底色。
    // 插槽靠文档顺序排在顶栏和内容下面，背景不能写负 z-index。不在工作区外壳里时不渲染。
    expect(renderToStaticMarkup(<CreationAmbientBackdrop url="" />)).toBe("");
    expect(renderToStaticMarkup(<CreationAmbientBackdrop url="/x.png" />)).toBe("");
    expect(read("creation-backdrops.tsx")).toMatch(/<WorkspaceStageBackdrop>\s*<div className="creation-ambient" aria-hidden="true">\s*<img key=\{url\} src=\{url\} alt=""/);
    expect(backdrops).toContain(".app-user-workspace .creation-home:has(.creation-thread-workbench)");
    expect(backdrops).not.toMatch(/\.creation-ambient\s*\{[^}]*z-index/);
});

test("结果图上的操作条：变体、高清、局部重绘、扩图、消除、转视频、作为参考和「更多」工具菜单；不传回调时不显示", () => {
    const item: CreationMessage = { id: "result", role: "assistant", content: "", createdAt: "2026-10-29T00:00:00Z", mode: "image", status: "done", resultUrls: ["https://cdn.example/one.png"] };
    const base = { item, onCreateVariant: () => {}, onContinueCanvas: () => {}, openingCanvas: false };
    expect(renderToStaticMarkup(<MediaResult {...base} />)).not.toContain("creation-image-actions");
    const dom = new Window();
    try {
        dom.document.body.innerHTML = renderToStaticMarkup(<MediaResult {...base} onUseResultImage={() => {}} />);
        const group = dom.document.querySelector(".creation-image-result .creation-image-actions");
        expect(group?.getAttribute("role")).toBe("group");
        const buttons = Array.from(group?.querySelectorAll("button") || []);
        expect(buttons.map((button) => button.getAttribute("title"))).toEqual(["变体", "高清", "局部重绘", "扩图", "消除", "转视频", "作为参考", "更多工具"]);
        expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
            "用这张图做变体",
            "把这张图重绘成高清版",
            "涂抹这张图的局部来重绘",
            "把这张图向四周扩展",
            "涂抹并消除这张图里的物体",
            "用这张图做视频",
            "把这张图作为参考",
            "更多图片工具",
        ]);
        expect(buttons.map((button) => button.querySelector("svg")?.getAttribute("data-icon"))).toEqual(["variant", "hd", "inpaint", "expand", "erase", "toVideo", "reference", "more"]);
        // 「更多」是菜单按钮，菜单本身挂在 body 上，不渲染在结果卡里。
        expect(buttons[buttons.length - 1]?.getAttribute("aria-haspopup")).toBe("menu");
        // 旧消息样式会隐藏结果卡里的每个 span，操作条里不能出现 span。
        expect(group?.querySelector("span")).toBeNull();
        // 下载仍是单独的按钮，不并进操作条。
        expect(dom.document.querySelector('button[aria-label="下载生成图片 1"]')).not.toBeNull();
    } finally {
        dom.close();
    }
});

test("音频结果：一条播放器加下载，不显示图片操作条和添加到画布", () => {
    const item: CreationMessage = { id: "audio", role: "assistant", content: "音频已生成", createdAt: "2026-10-29T00:00:00Z", mode: "audio", status: "done", resultUrls: ["https://cdn.example/voice.mp3"] };
    const dom = new Window();
    try {
        dom.document.body.innerHTML = renderToStaticMarkup(<MediaResult item={item} onCreateVariant={() => {}} onContinueCanvas={() => {}} openingCanvas={false} onUseResultImage={() => {}} />);
        const audio = dom.document.querySelector(".creation-audio-result audio");
        expect(audio?.getAttribute("src")).toBe("https://cdn.example/voice.mp3");
        expect(audio?.hasAttribute("controls")).toBe(true);
        expect(dom.document.querySelector(".creation-image-actions")).toBeNull();
        expect(dom.document.body.textContent).not.toContain("添加到画布");
        expect(dom.document.querySelector("a[download]")?.getAttribute("href")).toBe("https://cdn.example/voice.mp3");
    } finally {
        dom.close();
    }
});
