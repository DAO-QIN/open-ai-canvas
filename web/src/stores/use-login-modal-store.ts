import { create } from "zustand";

export type LoginModalRequest = {
    /** 右侧主标题；缺省为「登录开启创作」。 */
    title?: string;
    /** 标题下的一句说明，用来告诉用户为什么需要登录。 */
    description?: string;
    /** 登录成功后的回调，例如继续刚才被拦下的操作。 */
    onSuccess?: () => void;
};

type LoginModalStore = {
    open: boolean;
    request: LoginModalRequest;
    show: (request?: LoginModalRequest) => void;
    close: () => void;
};

export const useLoginModalStore = create<LoginModalStore>((set) => ({
    open: false,
    request: {},
    show: (request = {}) => set({ open: true, request }),
    close: () => set({ open: false }),
}));

export function openLoginModal(request?: LoginModalRequest) {
    useLoginModalStore.getState().show(request);
}

/**
 * 给仍保留 href="/login" 的链接用：普通左键点击改为打开弹窗，
 * 中键、Ctrl/⌘ 点击等仍按链接打开独立登录页。
 */
export function interceptLoginLinkClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean; preventDefault: () => void }, request?: LoginModalRequest) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openLoginModal(request);
}
