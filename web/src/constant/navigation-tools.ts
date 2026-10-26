import { Blocks, CircleDollarSign, Clapperboard, Gift, History, Image, Images, LibraryBig, Lightbulb, PanelsTopLeft, Settings, Video, WandSparkles } from "lucide-react";

export const navigationTools = [
    {
        slug: "create",
        label: "创作",
        fullLabel: "创作首页",
        keywords: ["首页"],
        icon: WandSparkles,
        section: "创作空间",
    },
    {
        slug: "projects",
        label: "短剧",
        fullLabel: "短剧制作",
        keywords: ["短剧创作", "项目"],
        icon: Clapperboard,
        section: "创作空间",
    },
    {
        slug: "canvas",
        label: "画布",
        fullLabel: "自由画布",
        keywords: [],
        icon: PanelsTopLeft,
        section: "创作空间",
    },
    {
        slug: "inspiration",
        label: "灵感",
        fullLabel: "灵感广场",
        keywords: ["精选画布", "画布模板", "做同款", "LibTV"],
        icon: Lightbulb,
        section: "创作空间",
    },
    {
        slug: "tasks",
        label: "历史",
        fullLabel: "创作历史",
        keywords: ["任务"],
        icon: History,
        section: "创作空间",
    },
    {
        slug: "assets",
        label: "素材",
        fullLabel: "素材管理",
        keywords: ["资产"],
        icon: Images,
        section: "创作空间",
    },
    {
        slug: "skills",
        label: "技能",
        fullLabel: "技能库",
        keywords: [],
        icon: LibraryBig,
        section: "工作台管理",
    },
    {
        slug: "plugins",
        label: "插件",
        fullLabel: "插件中心",
        keywords: [],
        icon: Blocks,
        section: "工作台管理",
    },
    {
        slug: "promotion",
        label: "邀请",
        fullLabel: "邀请有礼",
        keywords: ["返利"],
        icon: Gift,
        section: "工作台管理",
    },
    {
        slug: "wallet",
        label: "积分",
        fullLabel: "积分中心",
        keywords: ["钱包"],
        icon: CircleDollarSign,
        section: "工作台管理",
    },
    {
        slug: "settings",
        label: "设置",
        fullLabel: "个人设置",
        keywords: [],
        icon: Settings,
        section: "工作台管理",
    },
    {
        slug: "toolbox-image",
        label: "图片",
        fullLabel: "图片生成",
        keywords: ["生图", "图像编辑"],
        icon: Image,
        section: "工具",
    },
    {
        slug: "toolbox-video",
        label: "视频",
        fullLabel: "视频生成",
        keywords: [],
        icon: Video,
        section: "工具",
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

export function workspaceNavigationTool(pathname: string) {
    const [first, second] = pathname.split("/").filter(Boolean);
    const slug = !first || first === "create" ? "create" : first === "toolbox" ? `toolbox-${second}` : first;
    return navigationTools.find((tool) => tool.slug === slug);
}

export function matchesNavigationQuery(tool: { label: string; fullLabel: string; keywords: readonly string[] }, query: string) {
    const keyword = query.trim().toLowerCase();
    return [tool.label, tool.fullLabel, ...tool.keywords].some((value) => value.toLowerCase().includes(keyword));
}
