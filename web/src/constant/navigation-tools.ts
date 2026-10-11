import { Blocks, CircleDollarSign, Clapperboard, GalleryVerticalEnd, Gift, Images, LibraryBig, ListTodo, Package, PanelsTopLeft, Settings, WandSparkles } from "lucide-react";

export const navigationTools = [
    {
        slug: "create",
        label: "创作",
        icon: WandSparkles,
        section: "创作空间",
    },
    {
        slug: "inspirations",
        label: "灵感",
        icon: GalleryVerticalEnd,
        section: "创作空间",
    },
    {
        slug: "projects",
        label: "短剧创作",
        icon: Clapperboard,
        section: "创作空间",
    },
    {
        slug: "product-images",
        label: "商品套图",
        icon: Package,
        section: "创作空间",
    },
    {
        slug: "canvas",
        label: "画布",
        icon: PanelsTopLeft,
        section: "创作空间",
    },
    {
        slug: "tasks",
        label: "任务",
        icon: ListTodo,
        section: "创作空间",
    },
    {
        slug: "assets",
        label: "素材",
        icon: Images,
        section: "创作空间",
    },
    {
        slug: "skills",
        label: "技能库",
        icon: LibraryBig,
        section: "工作台管理",
    },
    {
        slug: "plugins",
        label: "插件中心",
        icon: Blocks,
        section: "工作台管理",
    },
    {
        slug: "promotion",
        label: "邀请有礼",
        icon: Gift,
        section: "工作台管理",
    },
    {
        slug: "wallet",
        label: "积分中心",
        icon: CircleDollarSign,
        section: "工作台管理",
    },
    {
        slug: "settings",
        label: "设置",
        icon: Settings,
        section: "工作台管理",
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
