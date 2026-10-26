import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { blankCanvasPath, isCanvasStartNode } from "../src/lib/canvas/canvas-start-node";
import { buildCreationToolEntries } from "../src/pages/create/creation-tool-entries";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

const allOn = { shortDramaEnabled: true, imageWorkbenchEnabled: true, videoWorkbenchEnabled: true };

describe("首页创作工具入口", () => {
    test("全部功能开启时按参考站顺序给出 8 个入口，并接到本站已有页面", () => {
        const entries = buildCreationToolEntries(allOn);
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
        const entries = buildCreationToolEntries({ ...allOn, imageWorkbenchEnabled: false, videoWorkbenchEnabled: false });
        expect(entries.find((entry) => entry.id === "video")).toMatchObject({ start: "video" });
        expect(entries.find((entry) => entry.id === "image")).toMatchObject({ start: "image" });
        expect(entries.some((entry) => entry.to?.startsWith("/toolbox/"))).toBe(false);
        expect(entries).toHaveLength(8);
    });

    test("短剧项目关闭时隐藏短剧 Agent，避免点进去才提示不可用", () => {
        const entries = buildCreationToolEntries({ ...allOn, shortDramaEnabled: false });
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

describe("首页布局顺序", () => {
    test("工具入口位于创作输入区之后、最近画布之前；最近画布复用同一创建逻辑", () => {
        const page = source("../src/pages/create/index.tsx");
        const launchpadEnd = page.indexOf("</section>", page.indexOf('className="creation-launchpad"'));
        const tools = page.indexOf("<CreationToolEntries");
        const recent = page.indexOf("<CreationRecentCanvases");
        const featured = page.indexOf("<CreationFeaturedCanvases");
        expect(launchpadEnd).toBeGreaterThan(0);
        expect(tools).toBeGreaterThan(launchpadEnd);
        expect(recent).toBeGreaterThan(tools);
        expect(featured).toBeGreaterThan(recent);
        const recentSource = source("../src/pages/create/creation-recent-canvases.tsx");
        expect(recentSource).toContain("useCreateBlankCanvas(onRequireLogin)");
        expect(recentSource).not.toContain("createCanvasProjectWithRemoteSync");
    });
});
