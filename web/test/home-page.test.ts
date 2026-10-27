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

    test("新建画布卡片带光效：扩散亮点、跟随鼠标的光斑与柔光，减少动态时关闭动画", () => {
        const page = source("../src/pages/home/index.tsx");
        for (const cls of ["home-new-canvas-ripple", "home-new-canvas-ripple is-delayed", "home-new-canvas-spotlight", "home-new-canvas-halo"]) expect(page).toContain(`className="${cls}"`);
        expect(page).toContain('style.setProperty("--home-pointer-x"');
        const css = source("../src/pages/home/home.css");
        expect(css).toContain("@property --home-ripple-radius");
        expect(css).toContain("@keyframes home-dot-ripple");
        expect(css).toContain(".home-new-canvas-ripple { animation: none; opacity: 0; }");
    });

    test("未登录顶栏与登录后同一套胶囊样式：礼盒积分胶囊 + 注册 / 登录按钮", () => {
        const bar = source("../src/components/layout/workspace-top-bar.tsx");
        const guestPill = bar.slice(bar.indexOf("creditsEnabled && !user ?"), bar.indexOf(") : creditsEnabled ?"));
        expect(guestPill).toContain('className="app-workspace-topbar-credit-pill is-guest"');
        expect(guestPill).toContain("<WorkspaceCreditGiftMark />");
        const menu = source("../src/components/layout/workspace-account-menu.tsx");
        expect(menu).toContain('className="app-workspace-topbar-auth-pill"');
        expect(menu).toContain("注册 / 登录");
        expect(menu).not.toContain('<span className="hidden sm:inline">游客</span>');
        expect(source("../src/styles/workspace-product.css")).toContain(".app-user-workspace .app-workspace-topbar-auth-pill {");
    });

    test("精选画布角标只在读到节点数时显示数量", () => {
        expect(featuredCanvasBadge({ nodeCount: 167 })).toBe("可编辑画布 · 167 节点");
        expect(featuredCanvasBadge({ nodeCount: 0 })).toBe("可编辑画布");
    });
});

describe("首页精选灵感", () => {
    const item = (title: string, mode: CreationInspiration["mode"], featured = false): CreationInspiration => ({ title, mode, featured, description: "", image: "", prompt: `${title} prompt` });
    test("有视频样片的排在前面（其中精选优先），按分类筛选；首页下滑分批显示全部", () => {
        const withVideo = (x: CreationInspiration) => ({ ...x, video: `https://media.goodcase.ai/media/video/${x.title}.mp4` });
        const items = [item("a", "image", true), item("b", "video"), withVideo(item("c", "video")), item("t", "text"), withVideo(item("d", "video", true)), ...Array.from({ length: 12 }, (_, i) => item(`i${i}`, "image"))];
        const all = pickHomeInspirations(items, "all");
        expect(all.slice(0, 4).map((x) => x.title)).toEqual(["d", "c", "a", "b"]);
        expect(all).toHaveLength(items.length);
        expect(pickHomeInspirations(items, "all", 10)).toHaveLength(10);
        const page = source("../src/pages/home/home-featured-inspirations.tsx");
        expect(page).toContain("useIncrementalReveal(ordered.length, PAGE, filter)");
        expect(page).toContain("const PAGE = 20;");
        expect(page).toContain("<div ref={sentinelRef} className=\"home-load-more\" role=\"status\">");
        expect(pickHomeInspirations(items, "video").map((x) => x.title)).toEqual(["d", "c", "b"]);
        expect(pickHomeInspirations(items, "text").map((x) => x.title)).toEqual(["t"]);
    });

    test("悬停才加载并静音循环播放样片，触屏与减少动态时不播放", () => {
        const page = source("../src/pages/home/home-featured-inspirations.tsx");
        // 首页、灵感库、创作页灵感区共用同一个悬停播放组件。
        const media = source("../src/pages/inspirations/inspiration-card-media.tsx");
        expect(source("../src/pages/inspirations/index.tsx")).toContain('<InspirationCardMedia key={item.image} item={item} hoverTarget=".inspiration-card" />');
        expect(media).toContain('window.matchMedia("(hover: hover)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches');
        expect(media).toContain("{item.video && active ? (");
        for (const attr of ["muted", "loop", "playsInline"]) expect(media).toContain(attr);
        expect(media).toContain('card.addEventListener("pointerleave", stop);');
        expect(media).toContain("videoRef.current?.pause();");
        expect(page).toContain("视频样片");
        expect(page).toContain("<InspirationCardMedia item={item} />");
    });

    test("灵感目录里的视频样片只来自 goodcase 的 https mp4", async () => {
        const catalog = JSON.parse(source("../public/inspirations/seedance.json")) as { entries: Array<{ video?: string; mode: string }> };
        const videos = catalog.entries.filter((entry) => entry.video);
        expect(videos.length).toBeGreaterThan(700);
        for (const entry of videos) expect(entry.video).toMatch(/^https:\/\/media\.goodcase\.ai\/.+\.mp4$/);
        expect(source("../scripts/import-inspirations.mjs")).toContain('url.protocol === "https:" && url.hostname === "media.goodcase.ai" && url.pathname.endsWith(".mp4")');
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

describe("灵感库（/inspirations 与创作页灵感区共用）", () => {
    const hall = () => source("../src/pages/inspirations/index.tsx");

    test("参考 leyi.my 灵感库：标题 + 导入 / 导出 / 新建灵感，类型、分类标签、筛选行常驻", () => {
        const page = hall();
        expect(page).toContain('<h2 id="inspiration-hall-title">灵感库</h2>');
        expect(page).toContain("条提示词，` : \"\"}按来源、分类和创作类型挑，点开可以一键带去创作页。");
        for (const action of ["导入", "导出", "新建灵感"]) expect(page).toContain(`                        ${action}\n`);
        expect(page).toContain('className="inspiration-hall-categories"');
        expect(page).toContain("const CATEGORY_PREVIEW = 16;");
        expect(page).toContain('<SegmentedControl options={VIEW_OPTIONS} value={view}');
        expect(page).not.toContain("更多筛选");
    });

    test("下滑加载代替分页，切换筛选回到第一批", () => {
        const page = hall();
        expect(page).not.toContain("PaginationBar");
        expect(page).toContain("useIncrementalReveal(visible.length, 30, revealKey)");
        expect(page).toContain("const revealKey = `${view}|${source}|${modeFilter}|${category}|${sort}|${debouncedSearch}`;");
        expect(page).toContain('<div ref={sentinelRef} className="inspiration-hall-more" role="status">');
        const hook = source("../src/hooks/use-incremental-reveal.ts");
        expect(hook).toContain('rootMargin: "0px 0px 600px 0px"');
        expect(hook).toContain('if (typeof IntersectionObserver === "undefined") {');
    });

    test("创作页灵感区与灵感库同一组件，创作页不放精选画布", () => {
        const create = source("../src/pages/create/index.tsx");
        expect(create).toContain('const InspirationHall = lazy(() => import("@/pages/inspirations"));');
        expect(create).not.toContain("FeaturedCanvases");
        expect(source("../src/pages/inspirations/page.tsx")).toContain("<InspirationHall eager onUse=");
        expect(hall()).toContain("const [shouldLoadCatalog, setShouldLoadCatalog] = useState(eager);");
    });
});

describe("壳层衔接", () => {
    test("顶栏 56px、不单独铺底色，和下面页面没有色差", () => {
        const css = source("../src/styles/globals.css");
        expect(css).toContain("--workspace-reference-topbar: 56px;");
        expect(css).not.toContain("--workspace-reference-topbar: 72px;");
        const block = css.slice(css.indexOf("    min-height: var(--workspace-reference-topbar) !important;"));
        expect(block.slice(0, block.indexOf("}"))).toContain("background: transparent !important;");
    });

    test("侧栏左下角游客卡片走主题色，带登录入口", () => {
        const nav = source("../src/components/layout/workspace-sidebar-nav.tsx");
        expect(nav).toContain('className={cn("app-workspace-sidebar-guest", collapsed && "is-collapsed")}');
        expect(nav).toContain("<strong>游客模式</strong>");
        expect(nav).toContain('<span className="app-workspace-sidebar-guest-action">登录</span>');
        const css = source("../src/styles/workspace-product.css");
        expect(css).toContain(".app-user-workspace .app-workspace-sidebar-guest-avatar { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: var(--user-surface-muted);");
    });
});
