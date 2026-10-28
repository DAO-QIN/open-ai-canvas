/**
 * 首页常驻通知条的「通知类型」与「标题图标素材」模型。
 *
 * 通知类型决定通知条的预设配色（深色底、流动光晕、按钮文字色）和默认按钮文案，后台与前台共用同一套 token；
 * 后台自定义配色见 banner-theme.ts。
 * 图标素材是 emoji 字符：它就是普通文本，随 TitleRuns 的文本分段一起存储与渲染，
 * 因此可以插到标题任意位置、跟随分段样式、参与关键字检索，后端不需要单独字段或白名单。
 *
 * 本模块只放纯数据与纯函数，不 import 任何组件。
 */

export type BannerNoticeType = "notice" | "activity" | "update" | "warning";

/** 未指定类型时的兜底：平台公告。 */
export const BANNER_NOTICE_DEFAULT_TYPE: BannerNoticeType = "notice";

/** 行动按钮文案上限，与后端 bannerCtaMaxRunes 一致。 */
export const BANNER_CTA_MAX_CHARS = 12;

export const BANNER_NOTICE_TYPES: {
    key: BannerNoticeType;
    label: string;
    hint: string;
    /** 后台未填写按钮文案时的默认文案。 */
    cta: string;
    /** 该类型的实色 token（后台类型标签用）；由 globals.css 按明暗主题分别取值。 */
    surfaceVar: string;
    /** 通知条深色底，不随主题变化，白字对比度 ≥ 7:1。 */
    baseVar: string;
    /** 通知条流动光环与按钮扫光的亮色。 */
    glowVar: string;
    /** 白色按钮与倒计时数字的文字色。 */
    inkVar: string;
}[] = [
    {
        key: "notice",
        label: "公告",
        hint: "平台公告、规则与流程变更",
        cta: "查看详情",
        surfaceVar: "--notice-banner-surface-notice",
        baseVar: "--notice-banner-base-notice",
        glowVar: "--notice-banner-glow-notice",
        inkVar: "--notice-banner-ink-notice",
    },
    {
        key: "activity",
        label: "活动",
        hint: "运营活动、限时促销与福利",
        cta: "立即参与",
        surfaceVar: "--notice-banner-surface-activity",
        baseVar: "--notice-banner-base-activity",
        glowVar: "--notice-banner-glow-activity",
        inkVar: "--notice-banner-ink-activity",
    },
    {
        key: "update",
        label: "更新",
        hint: "版本发布、功能上新与改版",
        cta: "立即体验",
        surfaceVar: "--notice-banner-surface-update",
        baseVar: "--notice-banner-base-update",
        glowVar: "--notice-banner-glow-update",
        inkVar: "--notice-banner-ink-update",
    },
    {
        key: "warning",
        label: "警告",
        hint: "维护窗口、风险与服务异常",
        cta: "了解详情",
        surfaceVar: "--notice-banner-surface-warning",
        baseVar: "--notice-banner-base-warning",
        glowVar: "--notice-banner-glow-warning",
        inkVar: "--notice-banner-ink-warning",
    },
];

const BANNER_NOTICE_TYPE_KEYS = new Set<string>(BANNER_NOTICE_TYPES.map((item) => item.key));

/** 未知 / 空类型一律回落到默认类型，通知条不会因为脏数据失去底色。 */
export function normalizeBannerNoticeType(value?: string | null): BannerNoticeType {
    const raw = (value || "").trim().toLowerCase();
    return BANNER_NOTICE_TYPE_KEYS.has(raw) ? (raw as BannerNoticeType) : BANNER_NOTICE_DEFAULT_TYPE;
}

export function bannerNoticeTypeMeta(value?: string | null) {
    const key = normalizeBannerNoticeType(value);
    return BANNER_NOTICE_TYPES.find((item) => item.key === key) as (typeof BANNER_NOTICE_TYPES)[number];
}

export function bannerNoticeTypeLabel(value?: string | null) {
    return bannerNoticeTypeMeta(value).label;
}

export function bannerNoticeTypeHint(value?: string | null) {
    return bannerNoticeTypeMeta(value).hint;
}

/** 按钮最终文案：后台填写的优先，留空时用通知类型的默认文案。 */
export function bannerCtaLabel(ctaText?: string | null, noticeType?: string | null) {
    const text = (ctaText || "").trim();
    return text || bannerNoticeTypeMeta(noticeType).cta;
}

/** 该类型底色的 CSS 引用（含 var()）；scope 内可被预览容器覆盖成明暗指定档。 */
export function bannerNoticeSurfaceCSS(value?: string | null) {
    return `var(${bannerNoticeTypeMeta(value).surfaceVar})`;
}

/** 合法类型键，供后端白名单与前端一致性测试使用。 */
export const BANNER_NOTICE_TYPE_VALUES = BANNER_NOTICE_TYPES.map((item) => item.key);

/**
 * 标题可插入的 emoji 图标素材，按用途分组。
 * 每项的 char 会作为普通文本插进标题（跟随光标处的字号 / 颜色样式），label 供搜索与 aria 标注。
 */
export const BANNER_NOTICE_EMOJI_GROUPS: { key: string; label: string; emoji: { char: string; label: string }[] }[] = [
    {
        key: "notice",
        label: "通知",
        emoji: [
            { char: "📢", label: "喇叭" },
            { char: "📣", label: "扩音" },
            { char: "🔔", label: "铃铛" },
            { char: "📮", label: "邮筒" },
            { char: "📌", label: "图钉" },
            { char: "📄", label: "文件" },
            { char: "📝", label: "备注" },
            { char: "📰", label: "快讯" },
            { char: "🗓️", label: "日历" },
            { char: "⏰", label: "闹钟" },
            { char: "🕐", label: "时钟" },
            { char: "🎯", label: "目标" },
        ],
    },
    {
        key: "celebrate",
        label: "庆祝",
        emoji: [
            { char: "🎉", label: "撒花" },
            { char: "🎊", label: "礼花" },
            { char: "🎈", label: "气球" },
            { char: "🎁", label: "礼物" },
            { char: "🎂", label: "蛋糕" },
            { char: "🥳", label: "狂欢" },
            { char: "🏆", label: "奖杯" },
            { char: "🥇", label: "金牌" },
            { char: "👑", label: "皇冠" },
            { char: "💎", label: "宝石" },
            { char: "✨", label: "闪光" },
            { char: "⭐", label: "星星" },
        ],
    },
    {
        key: "hot",
        label: "热门",
        emoji: [
            { char: "🔥", label: "热门" },
            { char: "🚀", label: "火箭" },
            { char: "⚡", label: "闪电" },
            { char: "💥", label: "爆炸" },
            { char: "🌟", label: "亮星" },
            { char: "💫", label: "星晕" },
            { char: "🌈", label: "彩虹" },
            { char: "☀️", label: "太阳" },
            { char: "🌙", label: "月亮" },
            { char: "❤️", label: "红心" },
            { char: "💯", label: "满分" },
            { char: "👍", label: "点赞" },
        ],
    },
    {
        key: "commerce",
        label: "商业",
        emoji: [
            { char: "💰", label: "钱袋" },
            { char: "💸", label: "飞钱" },
            { char: "💳", label: "银行卡" },
            { char: "🏦", label: "银行" },
            { char: "🛒", label: "购物车" },
            { char: "🛍️", label: "购物袋" },
            { char: "🏷️", label: "价签" },
            { char: "💼", label: "公文包" },
            { char: "📈", label: "上涨" },
            { char: "📉", label: "下跌" },
            { char: "🎫", label: "票券" },
            { char: "🎟️", label: "门票" },
        ],
    },
    {
        key: "status",
        label: "状态",
        emoji: [
            { char: "✅", label: "完成" },
            { char: "❌", label: "取消" },
            { char: "⚠️", label: "警告" },
            { char: "⛔", label: "禁止" },
            { char: "🚫", label: "禁用" },
            { char: "❓", label: "疑问" },
            { char: "❗", label: "感叹" },
            { char: "⏳", label: "等待" },
            { char: "🔄", label: "刷新" },
            { char: "🔧", label: "扳手" },
            { char: "🔒", label: "上锁" },
            { char: "🐞", label: "缺陷" },
        ],
    },
];

/** 扁平化的 emoji 清单，顺序与分组一致。 */
export const BANNER_NOTICE_EMOJIS = BANNER_NOTICE_EMOJI_GROUPS.flatMap((group) =>
    group.emoji.map((item) => ({ ...item, group: group.key, groupLabel: group.label })),
);

/** 按关键字过滤（匹配中文名、分组名或字符本身），空关键字返回全量。 */
export function searchBannerNoticeEmojis(keyword: string) {
    const query = keyword.trim().toLowerCase();
    if (!query) return BANNER_NOTICE_EMOJIS;
    return BANNER_NOTICE_EMOJIS.filter((item) => item.char.includes(query) || item.label.includes(query) || item.groupLabel.includes(query));
}
