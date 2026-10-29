/**
 * 常驻通知条的底边（深色主题）：挂在通知条下方、叠在下层界面上的一条颗粒带。
 *
 * 颗粒之间露出的是正下方侧栏与内容区本身的颜色，通知条因此溶进下层界面。颗粒不能挖在通知条内部：
 * 通知条背后只有页面最底层的近黑色，挖空处会变成一排黑色方格，和下方更亮的侧栏、内容区形成色差。
 *
 * 外形决定颗粒形状：方格是随机像素溶解，圆点 / 菱形是由大到小的网点，平滑不加颗粒；
 * 波纹决定颗粒带上沿的起伏：平直、波浪（长波）或涟漪（短波）。平滑 + 平直即直边，不挂颗粒带。
 * 图案是确定性生成的 SVG 遮罩（同一组合每次输出一致），以一个像素格 --nb-pixel 为单位横向平铺，
 * 用法见 components/layout/banner-announcement.css。取值白名单与后端 announcement.go 的 bannerEdgeShapes / bannerEdgeWaves 一致。
 */

import type { CSSProperties } from "react";

export type BannerEdgeShape = "square" | "dot" | "diamond" | "smooth";
export type BannerEdgeWave = "flat" | "wave" | "ripple";

export const BANNER_EDGE_SHAPE_DEFAULT: BannerEdgeShape = "square";
export const BANNER_EDGE_WAVE_DEFAULT: BannerEdgeWave = "flat";

/** 底边外形，取值与后端 bannerEdgeShapes 白名单一致。 */
export const BANNER_EDGE_SHAPES: { key: BannerEdgeShape; label: string }[] = [
    { key: "square", label: "方格" },
    { key: "dot", label: "圆点" },
    { key: "diamond", label: "菱形" },
    { key: "smooth", label: "平滑" },
];

/** 底边波纹，取值与后端 bannerEdgeWaves 白名单一致。 */
export const BANNER_EDGE_WAVES: { key: BannerEdgeWave; label: string }[] = [
    { key: "flat", label: "平直" },
    { key: "wave", label: "波浪" },
    { key: "ripple", label: "涟漪" },
];

export type BannerEdgeFields = {
    edgeShape?: string | null;
    edgeWave?: string | null;
};

export type BannerEdgeMask = {
    /** CSS url()，直接用作 mask-image；没有颗粒带时为 none。 */
    image: string;
    /** 图案一个平铺单元的宽度，单位是像素格。 */
    columns: number;
    /** 颗粒带挂在通知条下方的高度，单位是像素格；0 表示直边。 */
    rows: number;
};

const SHAPE_KEYS = new Set<string>(BANNER_EDGE_SHAPES.map((item) => item.key));
const WAVE_KEYS = new Set<string>(BANNER_EDGE_WAVES.map((item) => item.key));

/** 未知或空值按方格处理（旧通知没有这个字段）。 */
export function normalizeBannerEdgeShape(value?: string | null): BannerEdgeShape {
    const raw = (value || "").trim().toLowerCase();
    return SHAPE_KEYS.has(raw) ? (raw as BannerEdgeShape) : BANNER_EDGE_SHAPE_DEFAULT;
}

/** 未知或空值按平直处理。 */
export function normalizeBannerEdgeWave(value?: string | null): BannerEdgeWave {
    const raw = (value || "").trim().toLowerCase();
    return WAVE_KEYS.has(raw) ? (raw as BannerEdgeWave) : BANNER_EDGE_WAVE_DEFAULT;
}

/** 一个平铺单元宽 72 格（桌面约 240px）：波浪一个周期，涟漪四个周期，随机颗粒不易看出重复。 */
export const BANNER_EDGE_COLUMNS = 72;

/** 颗粒带上沿的起伏：振幅与周期（像素格），上沿深度 = 振幅 × (1 − cos(2πx / 周期)) / 2。 */
const WAVE_PROFILES: Record<BannerEdgeWave, { amplitude: number; period: number }> = {
    flat: { amplitude: 0, period: BANNER_EDGE_COLUMNS },
    wave: { amplitude: 3, period: BANNER_EDGE_COLUMNS },
    ripple: { amplitude: 1.5, period: BANNER_EDGE_COLUMNS / 4 },
};

/** 方格颗粒在上沿以下溶解的行数：逐行变疏（约 83% / 50% / 17%）。 */
const SQUARE_FADE_ROWS = 3;

/** 网点：格宽、行距与行数；圆点按六边形排布，菱形按菱格排布（满尺寸时恰好铺满）。 */
const HALFTONE = {
    dot: { cell: 2, pitch: Math.sqrt(3), rows: 3 },
    diamond: { cell: 2, pitch: 1, rows: 4 },
} as const;

const SEED = 11;

type Surface = (x: number) => number;
type Drawing = { path: string; bottom: number; crisp: boolean };

function seededRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function clamp01(value: number) {
    return Math.min(1, Math.max(0, value));
}

/** 坐标保留两位小数，去掉多余的零，控制遮罩长度。 */
function num(value: number) {
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** 上沿以上整片实心（通知条的延伸），波浪 / 涟漪时才有。 */
function solidPath(surface: Surface) {
    const points: string[] = [];
    for (let step = 0; step <= BANNER_EDGE_COLUMNS * 2; step += 1) {
        const x = step / 2;
        points.push(`${num(x)} ${num(surface(x))}`);
    }
    return `M0 0L${points.join("L")}L${BANNER_EDGE_COLUMNS} 0z`;
}

/** 方格：每格按到上沿的深度决定出现概率，同一行相邻的格合并成一段矩形。 */
function squareGrain(surface: Surface, amplitude: number): Drawing {
    const random = seededRandom(SEED);
    const rows = Math.ceil(amplitude) + SQUARE_FADE_ROWS;
    const runs: string[] = [];
    let bottom = 0;
    for (let row = 0; row < rows; row += 1) {
        let start = -1;
        for (let column = 0; column <= BANNER_EDGE_COLUMNS; column += 1) {
            let on = false;
            if (column < BANNER_EDGE_COLUMNS) {
                const coverage = clamp01(1 - (row + 0.5 - surface(column + 0.5)) / SQUARE_FADE_ROWS);
                on = coverage >= 1 || (coverage > 0 && random() < coverage);
            }
            if (on && start < 0) start = column;
            if (!on && start >= 0) {
                runs.push(`M${start} ${row}h${column - start}v1H${start}z`);
                bottom = row + 1;
                start = -1;
            }
        }
    }
    return { path: runs.join(""), bottom, crisp: true };
}

/**
 * 网点：沿上沿逐行排布，越往下越小（面积按覆盖率线性减小）。错行的点跨在平铺单元两端时两端各画一半，
 * 平铺后拼成完整的一颗；最上面多一行满尺寸的点，补上第一行点之间的缺口。
 */
function halftone(surface: Surface, amplitude: number, kind: keyof typeof HALFTONE): Drawing {
    const { cell, pitch, rows } = HALFTONE[kind];
    const fade = rows * pitch;
    const half = cell / 2;
    const parts: string[] = amplitude > 0 ? [solidPath(surface)] : [];
    let bottom = amplitude;
    for (let row = -1; row < rows; row += 1) {
        const depth = (row + 0.5) * pitch;
        const size = half * Math.sqrt(clamp01(1 - depth / fade));
        const first = Math.abs(row % 2) === 1 ? 0 : half;
        for (let cx = first; cx <= BANNER_EDGE_COLUMNS + 1e-9; cx += cell) {
            const cy = surface(cx) + depth;
            if (cy + size <= 0) continue;
            parts.push(
                kind === "dot"
                    ? `M${num(cx - size)} ${num(cy)}a${num(size)} ${num(size)} 0 1 0 ${num(size * 2)} 0a${num(size)} ${num(size)} 0 1 0 ${num(-size * 2)} 0z`
                    : `M${num(cx)} ${num(cy - size)}l${num(size)} ${num(size)}l${num(-size)} ${num(size)}l${num(-size)} ${num(-size)}z`,
            );
            bottom = Math.max(bottom, cy + size);
        }
    }
    return { path: parts.join(""), bottom, crisp: false };
}

function buildMask(shape: BannerEdgeShape, wave: BannerEdgeWave): BannerEdgeMask {
    const { amplitude, period } = WAVE_PROFILES[wave];
    const surface: Surface = (x) => (amplitude * (1 - Math.cos((2 * Math.PI * x) / period))) / 2;
    const drawing: Drawing = shape === "square" ? squareGrain(surface, amplitude) : shape === "smooth" ? { path: amplitude > 0 ? solidPath(surface) : "", bottom: amplitude, crisp: false } : halftone(surface, amplitude, shape);
    const rows = Math.ceil(drawing.bottom - 1e-6);
    if (!drawing.path || rows <= 0) return { image: "none", columns: BANNER_EDGE_COLUMNS, rows: 0 };
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${BANNER_EDGE_COLUMNS} ${rows}' preserveAspectRatio='none'${drawing.crisp ? " shape-rendering='crispEdges'" : ""}><path d='${drawing.path}'/></svg>`;
    const encoded = svg.replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E");
    return { image: `url("data:image/svg+xml,${encoded}")`, columns: BANNER_EDGE_COLUMNS, rows };
}

const MASKS = new Map<string, BannerEdgeMask>();

/** 外形 + 波纹对应的底边遮罩；结果按组合缓存，同一组合每次相同。 */
export function bannerEdgeMask(shape?: string | null, wave?: string | null): BannerEdgeMask {
    const edgeShape = normalizeBannerEdgeShape(shape);
    const edgeWave = normalizeBannerEdgeWave(wave);
    const key = `${edgeShape}:${edgeWave}`;
    let mask = MASKS.get(key);
    if (!mask) {
        mask = buildMask(edgeShape, edgeWave);
        MASKS.set(key, mask);
    }
    return mask;
}

/** 写到通知条外壳上的底边变量；直边（平滑 + 平直）时返回 undefined，不挂颗粒带。 */
export function bannerEdgeStyle(edge?: BannerEdgeFields | null): CSSProperties | undefined {
    const mask = bannerEdgeMask(edge?.edgeShape, edge?.edgeWave);
    if (!mask.rows) return undefined;
    return { "--nb-edge-mask": mask.image, "--nb-edge-columns": String(mask.columns), "--nb-edge-rows": String(mask.rows) } as CSSProperties;
}

/** 后台摘要用的「外形、波纹」中文名。 */
export function bannerEdgeLabel(edge?: BannerEdgeFields | null) {
    const shape = normalizeBannerEdgeShape(edge?.edgeShape);
    const wave = normalizeBannerEdgeWave(edge?.edgeWave);
    const shapeLabel = BANNER_EDGE_SHAPES.find((item) => item.key === shape)?.label ?? "";
    const waveLabel = BANNER_EDGE_WAVES.find((item) => item.key === wave)?.label ?? "";
    return `${shapeLabel}、${waveLabel}`;
}
