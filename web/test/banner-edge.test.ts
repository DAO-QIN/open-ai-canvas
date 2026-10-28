import { describe, expect, test } from "bun:test";

import {
    BANNER_EDGE_COLUMNS,
    BANNER_EDGE_SHAPE_DEFAULT,
    BANNER_EDGE_SHAPES,
    BANNER_EDGE_WAVE_DEFAULT,
    BANNER_EDGE_WAVES,
    bannerEdgeLabel,
    bannerEdgeMask,
    bannerEdgeStyle,
    normalizeBannerEdgeShape,
    normalizeBannerEdgeWave,
} from "@/lib/announcements/banner-edge";

async function readSource(relativePath: string) {
    return Bun.file(new URL(relativePath, import.meta.url)).text();
}

/** 从 Go 的 `var X = map[string]struct{}{...}` 字面量里取出键集合。 */
function goMapKeys(source: string, variable: string) {
    const start = source.indexOf(`var ${variable} = map[string]struct{}{`);
    if (start < 0) throw new Error(`未找到 ${variable}`);
    const end = source.indexOf("\n}", start);
    return Array.from(source.slice(start, end).matchAll(/"([a-z0-9-]+)"/g)).map((match) => match[1]);
}

/** 还原遮罩里的 SVG 文本。 */
function svgOf(image: string) {
    const match = image.match(/^url\("data:image\/svg\+xml,(.*)"\)$/);
    if (!match) throw new Error(`不是 SVG 遮罩：${image.slice(0, 60)}`);
    return decodeURIComponent(match[1]);
}

/** 方格颗粒每一行被颗粒覆盖的格数（路径是逐行合并的矩形段 M{x} {y}h{w}v1H{x}z）。 */
function squareCoverage(image: string, rows: number) {
    const counts = Array.from({ length: rows }, () => 0);
    for (const match of svgOf(image).matchAll(/M(\d+) (\d+)h(\d+)v1H\d+z/g)) {
        counts[Number(match[2])] += Number(match[3]);
    }
    return counts.map((count) => count / BANNER_EDGE_COLUMNS);
}

const COMBINATIONS = BANNER_EDGE_SHAPES.flatMap((shape) => BANNER_EDGE_WAVES.map((wave) => [shape.key, wave.key] as const));

describe("底边外形与波纹的取值", () => {
    test("未知或空值回到方格、平直，大小写与空格归一化", () => {
        expect(normalizeBannerEdgeShape(undefined)).toBe(BANNER_EDGE_SHAPE_DEFAULT);
        expect(normalizeBannerEdgeShape("")).toBe("square");
        expect(normalizeBannerEdgeShape(" DOT ")).toBe("dot");
        expect(normalizeBannerEdgeShape("star")).toBe("square");
        expect(normalizeBannerEdgeWave(null)).toBe(BANNER_EDGE_WAVE_DEFAULT);
        expect(normalizeBannerEdgeWave("Ripple")).toBe("ripple");
        expect(normalizeBannerEdgeWave("zigzag")).toBe("flat");
    });

    test("前后端白名单与默认值一致", async () => {
        const goSource = await readSource("../../backend/internal/app/announcement.go");
        expect(new Set(goMapKeys(goSource, "bannerEdgeShapes"))).toEqual(new Set(BANNER_EDGE_SHAPES.map((item) => item.key)));
        expect(new Set(goMapKeys(goSource, "bannerEdgeWaves"))).toEqual(new Set(BANNER_EDGE_WAVES.map((item) => item.key)));
        expect(goSource).toMatch(new RegExp(`bannerEdgeShapeDefault\\s*=\\s*"${BANNER_EDGE_SHAPE_DEFAULT}"`));
        expect(goSource).toMatch(new RegExp(`bannerEdgeWaveDefault\\s*=\\s*"${BANNER_EDGE_WAVE_DEFAULT}"`));
        const goModel = await readSource("../../backend/internal/model/models_project.go");
        expect(goModel).toContain(`default:'${BANNER_EDGE_SHAPE_DEFAULT}'`);
        expect(goModel).toContain(`default:'${BANNER_EDGE_WAVE_DEFAULT}'`);
    });

    test("后台摘要给出外形、波纹的中文名", () => {
        expect(bannerEdgeLabel(undefined)).toBe("方格、平直");
        expect(bannerEdgeLabel({ edgeShape: "diamond", edgeWave: "ripple" })).toBe("菱形、涟漪");
    });
});

describe("底边遮罩", () => {
    test("每种组合确定性生成并缓存；只有平滑 + 平直是直边", () => {
        for (const [shape, wave] of COMBINATIONS) {
            const mask = bannerEdgeMask(shape, wave);
            expect(bannerEdgeMask(shape.toUpperCase(), ` ${wave} `)).toBe(mask);
            expect(mask.columns).toBe(BANNER_EDGE_COLUMNS);
            if (shape === "smooth" && wave === "flat") {
                expect(mask.rows).toBe(0);
                expect(mask.image).toBe("none");
                expect(bannerEdgeStyle({ edgeShape: shape, edgeWave: wave })).toBeUndefined();
                continue;
            }
            // 颗粒带挂在通知条下方、压在侧栏与顶栏上沿，不能太深。
            expect(mask.rows).toBeGreaterThan(0);
            expect(mask.rows).toBeLessThanOrEqual(8);
            const svg = svgOf(mask.image);
            expect(svg).toContain(`viewBox='0 0 ${BANNER_EDGE_COLUMNS} ${mask.rows}'`);
            expect(svg).toContain("preserveAspectRatio='none'");
            expect(svg).not.toContain('"');
            // 遮罩长度受控：内联在外壳 style 上。
            expect(mask.image.length).toBeLessThan(12_000);
            const style = bannerEdgeStyle({ edgeShape: shape, edgeWave: wave }) as Record<string, string>;
            expect(style["--nb-edge-mask"]).toBe(mask.image);
            expect(style["--nb-edge-rows"]).toBe(String(mask.rows));
            expect(style["--nb-edge-columns"]).toBe(String(BANNER_EDGE_COLUMNS));
        }
    });

    test("方格平直：紧贴通知条的一行就开始出现空隙，往下逐行变疏，最后一行仍有颗粒", () => {
        const mask = bannerEdgeMask("square", "flat");
        const coverage = squareCoverage(mask.image, mask.rows);
        expect(coverage.length).toBe(3);
        expect(coverage[0]).toBeLessThan(1);
        expect(coverage[0]).toBeGreaterThan(0.65);
        for (let row = 1; row < coverage.length; row += 1) {
            expect(coverage[row]).toBeLessThan(coverage[row - 1]);
        }
        expect(coverage.at(-1) ?? 0).toBeGreaterThan(0);
        expect(svgOf(mask.image)).toContain("shape-rendering='crispEdges'");
    });

    test("波浪、涟漪让颗粒带上沿起伏：比平直更深，最上面一行在波峰处是实心的", () => {
        const flat = bannerEdgeMask("square", "flat");
        for (const wave of ["wave", "ripple"] as const) {
            const mask = bannerEdgeMask("square", wave);
            expect(mask.rows).toBeGreaterThan(flat.rows);
            const coverage = squareCoverage(mask.image, mask.rows);
            expect(coverage[0]).toBeGreaterThan(coverage.at(-1) ?? 1);
        }
        for (const shape of ["dot", "diamond", "smooth"] as const) {
            expect(bannerEdgeMask(shape, "wave").rows).toBeGreaterThanOrEqual(bannerEdgeMask(shape, "flat").rows);
        }
    });

    test("圆点、菱形是由大到小的网点，平滑只画一条连续的上沿", () => {
        const dot = svgOf(bannerEdgeMask("dot", "flat").image);
        const radii = Array.from(dot.matchAll(/a([\d.]+) [\d.]+ 0 1 0/g), (match) => Number(match[1]));
        expect(radii.length).toBeGreaterThan(BANNER_EDGE_COLUMNS);
        expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii) * 1.8);
        const diamond = svgOf(bannerEdgeMask("diamond", "flat").image);
        expect(diamond).not.toContain(" a");
        expect(Array.from(diamond.matchAll(/z/g)).length).toBeGreaterThan(BANNER_EDGE_COLUMNS);
        const smooth = svgOf(bannerEdgeMask("smooth", "wave").image);
        expect(Array.from(smooth.matchAll(/M/g)).length).toBe(1);
    });
});

describe("通知条样式", () => {
    test("颗粒带只在深色主题挂到通知条下方，叠在下层界面上，浅色主题保持直边", async () => {
        const css = await readSource("../src/components/layout/banner-announcement.css");
        const base = css.match(/\n\.notice-banner \{([^}]*)\}/)?.[1] ?? "";
        expect(base).toContain("--nb-edge-h: 0px;");
        expect(base).toContain("overflow: hidden;");
        expect(base).toMatch(/z-index: 1;/);
        expect(css).toContain("--nb-pixel: calc(3px / 0.9);");

        const shell = css.match(/\.dark \.notice-banner\[data-edge-band\] \{([^}]*)\}/)?.[1] ?? "";
        expect(shell).toContain("--nb-edge-h: calc(var(--nb-pixel) * var(--nb-edge-rows));");
        expect(shell).toContain("overflow: visible;");
        expect(shell).toContain("clip-path: inset(0 0 calc(var(--nb-edge-h) * -1) 0);");

        const backdrop = css.match(/\.dark \.notice-banner\[data-edge-band\] \.notice-banner-backdrop \{([^}]*)\}/)?.[1] ?? "";
        // 背景层向下延伸到颗粒带：通知条本体保持实心，颗粒只出现在下方延伸的那一段。
        expect(backdrop).toContain("bottom: calc(var(--nb-edge-h) * -1);");
        for (const property of ["-webkit-mask:", "\n    mask:"]) {
            const value = backdrop.slice(backdrop.indexOf(property), backdrop.indexOf(";", backdrop.indexOf(property)));
            expect(value).toContain("linear-gradient(#000, #000) top / 100% calc(100% - var(--nb-edge-h)) no-repeat");
            expect(value).toContain("var(--nb-edge-mask) left bottom / calc(var(--nb-pixel) * var(--nb-edge-columns)) var(--nb-edge-h) repeat-x");
        }
        // 浅色主题没有颗粒带规则。
        expect(css).not.toMatch(/^\.notice-banner\[data-edge-band\]/m);
        expect(css).not.toMatch(/:not\(\.dark\)[^{]*data-edge-band/);

        // 颗粒带挂进侧栏顶部时只能衬在标志与字标后面：侧栏品牌行的层级必须高于通知条（顶栏本身是 --z-toolbar）。
        const globals = await readSource("../src/styles/globals.css");
        const brandRow = globals.match(/\n\.app-user-workspace \.app-workspace-sidebar-brand-row \{([^}]*)\}/)?.[1] ?? "";
        expect(brandRow).toContain("position: relative;");
        const bannerZ = Number(base.match(/z-index: (\d+);/)?.[1]);
        const brandZ = Number(brandRow.match(/z-index: (\d+);/)?.[1]);
        expect(brandZ).toBeGreaterThan(bannerZ);
    });
});
