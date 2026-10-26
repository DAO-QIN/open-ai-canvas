export function isGuestWorkspacePath(pathname: string) {
    // 首页、创作页、灵感大厅与灵感广场只读浏览对游客开放；新建 / 复制画布时再要求登录。
    return pathname === "/" || pathname === "/create" || pathname === "/inspirations" || pathname === "/inspiration" || /^\/inspiration\/[^/]+$/.test(pathname);
}
