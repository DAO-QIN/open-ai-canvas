import { describe, expect, test } from "bun:test";
import { matchesNavigationQuery, navigationTools, workspaceNavigationTool } from "../src/constant/navigation-tools";

describe("consumer workspace navigation", () => {
    test("resolves root, compatibility, detail and distinct workbench routes", () => {
        for (const [path, label] of [
            ["/", "首页"], ["/create", "创作"], ["/c/demo", "创作"], ["/inspirations", "灵感"], ["/projects/demo/workflow/unit/script", "短剧"],
            ["/canvas/demo", "画布"], ["/toolbox/image", "图片"], ["/toolbox/video", "视频"],
            ["/assets", "素材"], ["/tasks", "历史"], ["/promotion", "邀请"],
        ]) expect(workspaceNavigationTool(path)?.label).toBe(label);
        expect(workspaceNavigationTool("/toolbox/unknown")).toBeUndefined();
        expect(workspaceNavigationTool("/unknown")).toBeUndefined();
    });

    test("keeps existing names discoverable after shortening labels", () => {
        for (const [query, slug] of [
            ["短剧制作", "projects"], ["短剧创作", "projects"], ["自由画布", "canvas"],
            ["图片生成", "toolbox-image"], [" 生图 ", "toolbox-image"], ["视频生成", "toolbox-video"],
            ["资产", "assets"], ["素材", "assets"], ["创作历史", "tasks"], ["任务", "tasks"],
            ["邀请有礼", "promotion"], ["积分中心", "wallet"],
        ]) expect(navigationTools.filter((tool) => matchesNavigationQuery(tool, query)).map((tool) => tool.slug)).toContain(slug);
        expect(navigationTools.filter((tool) => matchesNavigationQuery(tool, "不存在的导航"))).toHaveLength(0);
    });

    test("uses two visible Chinese characters for every configured entry", () => {
        for (const tool of navigationTools) expect(tool.label).toMatch(/^[\u4e00-\u9fff]{2}$/);
    });
});
