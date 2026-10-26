export function isGuestWorkspacePath(pathname: string) {
    // 灵感广场只读浏览对游客开放；复制到画布时再要求登录。
    return pathname === "/" || pathname === "/create" || pathname === "/inspiration" || /^\/inspiration\/[^/]+$/.test(pathname);
}
