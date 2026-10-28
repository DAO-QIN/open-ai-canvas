// 创作页专用图标：24 栅格、1.75 线宽、圆角端点，只用 currentColor。
// 只在创作页使用；不画星星、魔棒和渐变，"自动"用满月条纹表示阿Q。

import type { ReactNode, SVGProps } from "react";

export type CreationIconName = "auto" | "image" | "video" | "film" | "check" | "chevronDown" | "send" | "reference" | "toVideo" | "canvas" | "download" | "edit" | "generate" | "variant" | "skill";

const paths: Record<CreationIconName, ReactNode> = {
    auto: (
        <>
            <circle cx="12" cy="12" r="8.25" />
            <path d="M5.2 14.5h13.6M6.6 17.6h10.8" />
        </>
    ),
    image: (
        <>
            <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
            <circle cx="9" cy="9" r="1.75" />
            <path d="M4 17l4.5-4.5 3.5 3.5 2.5-2.5 5.5 5.5" />
        </>
    ),
    video: (
        <>
            <rect x="2.5" y="6" width="13.5" height="12" rx="3" />
            <path d="M16 10.2l5.5-3.2v10l-5.5-3.2" />
        </>
    ),
    film: (
        <>
            <rect x="3.5" y="8" width="17" height="12" rx="2.5" />
            <path d="M3.8 8l2.7-4h4l-2.7 4M11.3 8l2.7-4h4l-2.7 4" />
        </>
    ),
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
