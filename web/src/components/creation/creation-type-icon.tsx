// 创作类型图标：首页「创作工具」入口和创作页「创作类型」菜单共用这一套图形，改一处两边一起变。
// 24 栅格、1.8 线宽、圆角端点，只用 currentColor。生成类在线框缺口或框内放一颗实心四角星，表示"AI 生成"；
// 音频（配音、音效）只画声波、不加星，和音乐区分开。图形为本项目自绘。

import type { ReactNode, SVGProps } from "react";

export type CreationTypeIconName = "agent" | "image" | "video" | "music" | "audio" | "short-drama";

const round = (value: number) => Math.round(value * 100) / 100;

/** 实心四角星：四段二次曲线，控制点略离开中心，星腰不会细成一条线。 */
export function sparklePath(cx: number, cy: number, r: number) {
    const k = r * 0.18;
    const at = (x: number, y: number) => `${round(x)} ${round(y)}`;
    return `M${at(cx, cy - r)}Q${at(cx + k, cy - k)} ${at(cx + r, cy)}Q${at(cx + k, cy + k)} ${at(cx, cy + r)}Q${at(cx - k, cy + k)} ${at(cx - r, cy)}Q${at(cx - k, cy - k)} ${at(cx, cy - r)}Z`;
}

const solid = { fill: "currentColor", stroke: "none" } as const;

export const creationTypeIconShapes: Record<CreationTypeIconName, ReactNode> = {
    // 钢笔，和侧栏「创作」是同一支笔：笔尖、笔缝、笔杆沿左上到右下的对角线对称，导气孔换成一颗星。
    agent: (
        <>
            <path d="M17.7 13.09 16.43 6.77A0.92 0.92 0 0 0 15.76 6.06L4.13 3A0.92 0.92 0 0 0 3 4.13L6.06 15.76A0.92 0.92 0 0 0 6.77 16.43L13.09 17.7" />
            <path d="M19.27 12.82 20.72 14.28A0.92 0.92 0 0 1 20.72 15.58L15.58 20.72A0.92 0.92 0 0 1 14.28 20.72L12.82 19.27A0.92 0.92 0 0 1 12.82 17.96L17.96 12.82A0.92 0.92 0 0 1 19.27 12.82z" />
            <path d="M3.25 3.25 8.6 8.6" />
            <path d={sparklePath(11.25, 11.25, 3.5)} {...solid} />
        </>
    ),
    // 相框 + 山形，右上角留缺口放星。
    image: (
        <>
            <path d="M20.5 10.25v7.25a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3h7.25" />
            <path d="M3.75 16.25 8 12l4.5 4.5 2-2 5.1 5.1" />
            <path d={sparklePath(18.75, 5.25, 3.6)} {...solid} />
        </>
    ),
    // 画框 + 播放键，右下角留缺口放星。
    video: (
        <>
            <path d="M21 13.25V8a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h7.75" />
            <path d="M10.7 9.75v4.5l3.9-2.25z" fill="currentColor" />
            <path d={sparklePath(19.5, 18.5, 3.6)} {...solid} />
        </>
    ),
    // 两个连音的八分音符，左上角放星。
    music: (
        <>
            <path d="M9.5 17.75V9l10.25-2.5v9.25" />
            <circle cx="6.85" cy="17.75" r="2.65" />
            <circle cx="17.1" cy="15.75" r="2.65" />
            <path d={sparklePath(5.25, 5.5, 3.1)} {...solid} />
        </>
    ),
    // 高低不一的五根声波。
    audio: <path d="M4.5 9.75v4.5M8.25 6.5v11M12 3.75v16.5M15.75 7.75v8.5M19.5 10.25v3.5" />,
    // 场记板，板身里一颗星表示由 Agent 代为制作。
    "short-drama": (
        <>
            <rect x="3.5" y="4.5" width="17" height="15.5" rx="2.5" />
            <path d="M3.5 9.5h17M9.75 4.75 7.5 9.25M15.25 4.75 13 9.25" />
            <path d={sparklePath(12, 14.75, 2.75)} {...solid} />
        </>
    ),
};

type CreationTypeIconProps = Omit<SVGProps<SVGSVGElement>, "name"> & { name: CreationTypeIconName; size?: number };

/** 装饰性图标默认对读屏隐藏：按钮或菜单项自己的文字就是可读名称。 */
export function CreationTypeIcon({ name, size = 24, ...props }: CreationTypeIconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon={name} {...props}>
            {creationTypeIconShapes[name]}
        </svg>
    );
}
