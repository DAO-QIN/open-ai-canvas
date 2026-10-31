export function isSpatialWorkbenchPath(pathname: string) {
    // 画布列表属于用户工作台，只有具体画布编辑器与运营后台保留各自现有视觉契约。
    const canvasEditor = /^\/canvas\/[^/]+(?:\/|$)/.test(pathname);
    return !canvasEditor && !pathname.startsWith("/admin");
}

/** 顶栏、侧栏和手机底部导航只属于用户工作台；画布编辑器与运营后台各自是全屏外壳。 */
export function hasWorkspaceShellChrome(pathname: string) {
    return !pathname.startsWith("/admin") && !isCanvasEditorPath(pathname);
}

/** 具体画布的编辑器（/canvas/:id），不含画布列表。 */
export function isCanvasEditorPath(pathname: string) {
    return /^\/canvas\/[^/]+/.test(pathname);
}
