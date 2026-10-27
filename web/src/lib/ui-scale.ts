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

/** 屏幕像素（clientX、getBoundingClientRect、innerWidth）换成写进样式的 CSS 像素。 */
export function toLayoutPx(screenPx: number) {
    return screenPx / currentUiScale();
}

/** 样式坐标下的视口尺寸。 */
export function layoutViewport() {
    const scale = currentUiScale();
    return { width: window.innerWidth / scale, height: window.innerHeight / scale };
}
