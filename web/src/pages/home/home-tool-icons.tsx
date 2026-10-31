// 首页「创作工具」入口图标：24 栅格、1.8 线宽、圆角端点，只用 currentColor。
// 图标语言参考 liblib.tv 的工具栏：线框 + 实心四角星，星落在线框留出的缺口上表示"AI 生成"。
// 短剧、视频、图片、音频和创作页「创作类型」菜单共用 components/creation/creation-type-icon；
// 其余图形只在首页工具入口使用。尺寸由 home.css 的 .home-tool-entry-icon 统一决定。

import type { ReactNode } from "react";

import { creationTypeIconShapes, sparklePath as sparkle } from "@/components/creation/creation-type-icon";

export type HomeToolIconName = "short-drama" | "video" | "image" | "audio" | "script" | "assets" | "skills" | "models";

const solid = { fill: "currentColor", stroke: "none" } as const;

const shapes: Record<HomeToolIconName, ReactNode> = {
    "short-drama": creationTypeIconShapes["short-drama"],
    video: creationTypeIconShapes.video,
    image: creationTypeIconShapes.image,
    audio: creationTypeIconShapes.audio,
    // 稿纸 + 三行字，左上角留缺口放星。
    script: (
        <>
            <path d="M5 10.25V18a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V6a2.5 2.5 0 0 0-2.5-2.5h-5.25" />
            <path d="M9 9.75h6M9 13.25h6M9 16.75h3.5" />
            <path d={sparkle(6.25, 5, 3.25)} {...solid} />
        </>
    ),
    // 文件夹。
    assets: <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6a1.5 1.5 0 0 1 1.2.6l1.2 1.6a1.5 1.5 0 0 0 1.2.6h5.8a2 2 0 0 1 2 2v7.7a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5zM3.5 11.25h17" />,
    // 魔棒 + 星光。
    skills: (
        <>
            <path d="M4.5 19.5l9.25-9.25" />
            <path d={sparkle(16.75, 7.25, 4.25)} {...solid} />
            <path d={sparkle(7.5, 6.75, 2.1)} {...solid} />
            <path d={sparkle(19, 15.75, 1.7)} {...solid} />
        </>
    ),
    // 两条滑杆，旋钮一左一右。
    models: (
        <>
            <path d="M10.25 7.5H20M4 16.5h9.75" />
            <circle cx="7.5" cy="7.5" r="2.75" />
            <circle cx="16.5" cy="16.5" r="2.75" />
        </>
    ),
};

/** 装饰性图标：入口按钮自己的文字就是可读名称。 */
export function HomeToolIcon({ name }: { name: HomeToolIconName }) {
    return (
        <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon={name}>
            {shapes[name]}
        </svg>
    );
}
