/**
 * 桌面端界面整体按 90% 显示：浏览器 100% 时等于原先 90% 的观感，浏览器再缩放时按同一比例叠加。
 * 用根元素的 CSS zoom 实现（见 styles/ui-scale.css），窄屏（< 1024px）保持原尺寸。
 *
 * 画布编辑器、分享画布和开发实验页自己管理缩放与指针坐标，不参与整体缩放。
 * 在缩放下：getBoundingClientRect / clientX / innerWidth 是屏幕像素，而样式里写的 px 会再乘 0.9，
 * 所以把指针距离或窗口尺寸写回样式前要用 toLayoutPx 换算。
 */
export const DESKTOP_UI_SCALE = 0.9;
export const UI_SCALE_MIN_WIDTH = 1024;
export const UI_SCALE_OFF_ATTRIBUTE = "data-ui-scale-off";

export function isUiScaleExemptPath(pathname: string) {
    return /^\/canvas\/[^/]+/.test(pathname) || pathname.startsWith("/share/canvas/") || pathname.startsWith("/dev/");
}

export function syncUiScaleForPath(pathname: string) {
    if (typeof document === "undefined") return;
    document.documentElement.toggleAttribute(UI_SCALE_OFF_ATTRIBUTE, isUiScaleExemptPath(pathname));
}

/** 当前根元素实际生效的缩放（窄屏、豁免页面为 1）。 */
export function currentUiScale() {
    if (typeof window === "undefined" || typeof getComputedStyle !== "function") return 1;
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * 实测 getBoundingClientRect 与样式像素之比。按 CSS 标准实现 zoom 的浏览器（已在 Chrome 实测）里 rect 是屏幕像素，桌面端为 0.9；
 * 未缩放的页面为 1，按未缩放坐标返回 rect 的浏览器也是 1。按实测比例换算，不依赖浏览器采用哪种 zoom 模型。
 */
export function clientRectScale() {
    if (typeof document === "undefined" || typeof getComputedStyle !== "function") return 1;
    const root = document.documentElement;
    const styled = Number.parseFloat(getComputedStyle(root).width);
    const measured = root.getBoundingClientRect().width;
    if (!(styled > 0) || !(measured > 0)) return 1;
    // 保留三位小数，避免样式宽度的小数让比例变成 0.89996 这类值。
    return Math.round((measured / styled) * 1000) / 1000;
}

/** 屏幕像素（clientX、getBoundingClientRect、innerWidth）换成写进样式的 CSS 像素。 */
export function toLayoutPx(screenPx: number) {
    return screenPx / currentUiScale();
}

/** 样式坐标下的视口尺寸。 */
export function layoutViewport() {
    const scale = currentUiScale();
    return { width: window.innerWidth / scale, height: window.innerHeight / scale };
}
