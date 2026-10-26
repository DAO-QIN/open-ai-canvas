import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { blankCanvasPath, isCanvasStartNode } from "../src/lib/canvas/canvas-start-node";
import { buildHomeToolEntries } from "../src/pages/home/home-tool-entries";
import { inspirationPrefillState, pickHomeInspirations } from "../src/pages/home/home-featured-inspirations";
import { featuredCanvasBadge } from "../src/pages/home/home-featured-canvases";
import { isGuestWorkspacePath } from "../src/lib/guest-workspace";
import type { CreationInspiration } from "../src/lib/inspirations/catalog";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

const allOn = { shortDramaEnabled: true, imageWorkbenchEnabled: true, videoWorkbenchEnabled: true };

describe("首页工具入口", () => {
    test("全部功能开启时按参考站顺序给出 8 个入口，并接到本站已有页面", () => {
        const entries = buildHomeToolEntries(allOn);
        expect(entries.map((entry) => entry.label)).toEqual(["短剧 Agent", "视频生成", "图片生成", "音频创作", "剧本生成", "素材管理", "提示词技能", "模型设置"]);
        expect(Object.fromEntries(entries.map((entry) => [entry.id, entry.to ?? `start:${entry.start}`]))).toEqual({
            "short-drama": "/projects",
            video: "/toolbox/video",
            image: "/toolbox/image",
            audio: "start:audio",
            script: "start:script",
            assets: "/assets",
            skills: "/skills",
            models: "/settings?section=models",
        });
        // 每个入口只有一种去向，不会同时跳页面又建画布。
        for (const entry of entries) expect(Boolean(entry.to) !== Boolean(entry.start)).toBe(true);
    });

    test("工作台关闭时生图 / 视频退回到新画布，入口不消失", () => {
        const entries = buildHomeToolEntries({ ...allOn, imageWorkbenchEnabled: false, videoWorkbenchEnabled: false });
        expect(entries.find((entry) => entry.id === "video")).toMatchObject({ start: "video" });
        expect(entries.find((entry) => entry.id === "image")).toMatchObject({ start: "image" });
        expect(entries.some((entry) => entry.to?.startsWith("/toolbox/"))).toBe(false);
        expect(entries).toHaveLength(8);
    });

    test("短剧项目关闭时隐藏短剧 Agent，避免点进去才提示不可用", () => {
        const entries = buildHomeToolEntries({ ...allOn, shortDramaEnabled: false });
        expect(entries.some((entry) => entry.to === "/projects")).toBe(false);
        expect(entries).toHaveLength(7);
    });

    test("设置页确实有「模型选择」分区，入口参数有效", () => {
        expect(source("../src/pages/settings/index.tsx")).toContain('key: "models", label: "模型选择"');
    });
});

describe("新画布起始节点参数", () => {
    test("只接受已知节点类型，路径格式稳定", () => {
        for (const value of ["image", "video", "audio", "script", "text"]) expect(isCanvasStartNode(value)).toBe(true);
        for (const value of [null, "", "frame", "AUDIO", "../x"]) expect(isCanvasStartNode(value)).toBe(false);
        expect(blankCanvasPath("p1")).toBe("/canvas/p1");
        expect(blankCanvasPath("p1", "audio")).toBe("/canvas/p1?start=audio");
    });

    test("画布页在 createNode 声明之后处理 ?start=，只在空画布上加一次并移除参数", () => {
        const page = source("../src/pages/canvas/project.tsx");
        const declared = page.indexOf("    } = useCanvasNodeOperations({");
        const handler = page.indexOf('const start = searchParams.get("start");');
        expect(declared).toBeGreaterThan(0);
        expect(handler).toBeGreaterThan(declared);
        const body = page.slice(handler, page.indexOf("}, [createNode", handler));
        expect(body).toContain('next.delete("start")');
        expect(body).toContain("nodesRef.current.length");
        expect(body).toContain("startNodeHandledRef.current = true");
    });
});

describe("首页布局（参考 leyi.my）", () => {
    test("根路径是启动页：新建画布 → 工具入口 → 精选画布 → 精选灵感", () => {
        const page = source("../src/pages/home/index.tsx");
        const order = ["<HomeNewCanvas />", "<HomeToolEntries", "<HomeFeaturedCanvases />", "<HomeFeaturedInspirations />"].map((tag) => page.indexOf(tag));
        expect(order.every((index) => index > 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(page).toContain("新建画布创作");
        // 新建画布与工具入口共用同一创建逻辑，游客先登录。
        expect(page).toContain("useCreateBlankCanvas(requireLogin)");
        expect(page).toContain("openLoginModal(");
    });

    test("创作页不再重复首页的工具入口与精选画布，最近画布复用同一创建逻辑", () => {
        const create = source("../src/pages/create/index.tsx");
        for (const tag of ["<CreationToolEntries", "<CreationFeaturedCanvases", "<HomeToolEntries"]) expect(create).not.toContain(tag);
        expect(create).toContain("<CreationRecentCanvases");
        expect(create).not.toContain('navigate("/", {');
        const recentSource = source("../src/pages/create/creation-recent-canvases.tsx");
        expect(recentSource).toContain("useCreateBlankCanvas(onRequireLogin)");
        expect(recentSource).not.toContain("createCanvasProjectWithRemoteSync");
    });

    test("游客可以浏览首页、创作页与两个灵感页", () => {
        for (const path of ["/", "/create", "/inspirations", "/inspiration", "/inspiration/abc"]) expect(isGuestWorkspacePath(path)).toBe(true);
        for (const path of ["/canvas", "/assets", "/settings", "/c/abc"]) expect(isGuestWorkspacePath(path)).toBe(false);
    });

    test("精选画布角标只在读到节点数时显示数量", () => {
        expect(featuredCanvasBadge({ nodeCount: 167 })).toBe("可编辑画布 · 167 节点");
        expect(featuredCanvasBadge({ nodeCount: 0 })).toBe("可编辑画布");
    });
});

describe("首页精选灵感", () => {
    const item = (title: string, mode: CreationInspiration["mode"], featured = false): CreationInspiration => ({ title, mode, featured, description: "", image: "", prompt: `${title} prompt` });
    test("按分类筛选，精选在前，最多 10 条", () => {
        const items = [item("a", "image"), item("b", "video", true), item("c", "text"), item("d", "video"), ...Array.from({ length: 12 }, (_, i) => item(`v${i}`, "video"))];
        expect(pickHomeInspirations(items, "all").map((x) => x.title).slice(0, 2)).toEqual(["b", "a"]);
        expect(pickHomeInspirations(items, "all")).toHaveLength(10);
        expect(pickHomeInspirations(items, "video").every((x) => x.mode === "video")).toBe(true);
        expect(pickHomeInspirations(items, "text").map((x) => x.title)).toEqual(["c"]);
    });

    test("点灵感只带提示词进创作页，并先开新对话", () => {
        expect(inspirationPrefillState({ ...item("x", "image"), promptZh: "中文", ratio: "4:5" })).toEqual({ creationHome: true, mode: "image", prompt: "中文", ratio: "4:5" });
        expect(inspirationPrefillState(item("y", "text"))).toEqual({ creationHome: true, mode: "text", prompt: "y prompt" });
        const page = source("../src/pages/home/home-featured-inspirations.tsx");
        expect(page).toContain('navigate("/create", { state: inspirationPrefillState(item) })');
        expect(page).toContain('to="/inspirations"');
        for (const forbidden of ["submit", "generate("]) expect(page).not.toContain(forbidden);
    });
});
