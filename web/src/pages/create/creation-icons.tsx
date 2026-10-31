// 创作页专用图标：24 栅格、1.75 线宽、圆角端点，只用 currentColor。
// 只在创作页使用；不画星星、魔棒和渐变。
// "创作类型"菜单里的 Agent、图片、视频、音乐、音频和首页共用 components/creation/creation-type-icon；
// Agent 的钢笔还用在悬浮提示条、历史列表的 Agent 会话和阿Q 的兜底头像上。

import type { ReactNode, SVGProps } from "react";

export type CreationIconName =
    | "check"
    | "chevronDown"
    | "send"
    | "reference"
    | "toVideo"
    | "canvas"
    | "download"
    | "edit"
    | "generate"
    | "variant"
    | "hd"
    | "inpaint"
    | "expand"
    | "erase"
    | "more"
    | "skill";

const paths: Record<CreationIconName, ReactNode> = {
    check: <path d="M6.5 12.5l3.5 3.5 7.5-8" />,
    chevronDown: <path d="M7.5 10l4.5 4.5 4.5-4.5" />,
    send: <path d="M12 18.5v-13M6.5 11l5.5-5.5 5.5 5.5" />,
    reference: (
        <>
            <rect x="3" y="6" width="13" height="13" rx="3" />
            <path d="M3.5 16l3.5-3.5 3 3 2-2 3.5 3.5" />
            <path d="M19.5 2.5v6M16.5 5.5h6" />
        </>
    ),
    toVideo: (
        <>
            <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
            <path d="M10 8.75v6.5l5.25-3.25z" />
        </>
    ),
    canvas: (
        <>
            <circle cx="6" cy="7" r="2.5" />
            <circle cx="18" cy="7" r="2.5" />
            <circle cx="12" cy="17.5" r="2.5" />
            <path d="M8.5 7h7M7.3 9.2l3.4 6M16.7 9.2l-3.4 6" />
        </>
    ),
    download: (
        <>
            <path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" />
            <path d="M4.5 19.5h15" />
        </>
    ),
    edit: (
        <>
            <path d="M4.5 19.5h4l10-10-4-4-10 10z" />
            <path d="M13 7l4 4" />
        </>
    ),
    generate: (
        <>
            <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
            <circle cx="12" cy="12" r="2.5" />
        </>
    ),
    variant: (
        <>
            <circle cx="9" cy="12" r="5.75" />
            <circle cx="15" cy="12" r="5.75" />
        </>
    ),
    skill: (
        <>
            <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
            <path d="M14.25 7.5l-4.5 9" />
        </>
    ),
    // 高清：圆角框里的 HD 两个字母。
    hd: (
        <>
            <rect x="2.5" y="5" width="19" height="14" rx="3.5" />
            <path d="M7 9.25v5.5M7 12h3.25M10.25 9.25v5.5M13.75 9.25v5.5h1.5a2.75 2.75 0 0 0 0-5.5z" />
        </>
    ),
    // 局部修改：四角取景框 + 中间一支笔。
    inpaint: (
        <>
            <path d="M3.5 8V6a2.5 2.5 0 0 1 2.5-2.5h2M16 3.5h2A2.5 2.5 0 0 1 20.5 6v2M20.5 16v2a2.5 2.5 0 0 1-2.5 2.5h-2M8 20.5H6A2.5 2.5 0 0 1 3.5 18v-2" />
            <path d="M9 15.5l5.75-5.75 1.5 1.5L10.5 17H9z" />
        </>
    ),
    // 扩图：中间原图，四角向外展开。
    expand: (
        <>
            <rect x="8.25" y="8.25" width="7.5" height="7.5" rx="1.75" />
            <path d="M3.5 8V3.5H8M16 3.5h4.5V8M20.5 16v4.5H16M8 20.5H3.5V16" />
        </>
    ),
    // 消除：斜放的橡皮擦，前端一道分隔线，下面一条擦过的底线。
    erase: (
        <>
            <path d="M7.5 19.5l-3.2-3.2a2 2 0 0 1 0-2.8l8.2-8.2a2 2 0 0 1 2.8 0l4.4 4.4a2 2 0 0 1 0 2.8l-7.1 7" />
            <path d="M8.5 9.3l7.1 7.1M7.5 19.5h12" />
        </>
    ),
    // 更多：三个实心圆点。
    more: (
        <>
            <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </>
    ),
};

type CreationIconProps = Omit<SVGProps<SVGSVGElement>, "name"> & { name: CreationIconName; size?: number };

/** 装饰性图标默认 aria-hidden；按钮的可读名称由按钮自己的 aria-label 提供。 */
export function CreationIcon({ name, size = 16, className, ...props }: CreationIconProps) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="none"
            stroke="currentColor"
            strokeWidth={name === "check" || name === "send" ? 2 : 1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className ? `creation-icon ${className}` : "creation-icon"}
            data-icon={name}
            {...props}
        >
            {paths[name]}
        </svg>
    );
}
