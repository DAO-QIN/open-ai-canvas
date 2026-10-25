import { create } from "zustand";

export type AuthModalView = "login" | "register" | "forgot";

export type LoginModalRequest = {
    /** 打开时显示的视图，缺省为登录。 */
    view?: AuthModalView;
    /** 登录页主标题；缺省为「登录开启创作」。 */
    title?: string;
    /** 标题下的一句说明，用来告诉用户为什么需要登录。 */
    description?: string;
    /** 登录或注册成功后要前往的站内地址，例如被拦下的受保护页面。 */
    next?: string;
    /** 邀请链接带来的邀请码，打开注册视图时自动填写。 */
    inviteCode?: string;
    /** 打开后立即提示的错误，例如第三方登录回跳失败。 */
    error?: string;
    /** 登录或注册成功后的回调，例如继续刚才被拦下的操作。 */
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
 * 给仍保留 href="/login" 的链接用：普通左键点击直接打开弹窗，
 * 中键、Ctrl/⌘ 点击等仍按链接打开（/login 会回到首页并打开弹窗）。
 */
export function interceptLoginLinkClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean; preventDefault: () => void }, request?: LoginModalRequest) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openLoginModal(request);
}

/** 只接受站内相对地址，避免 next 参数被用来跳到外站。 */
export function safeNextPath(value: string | null | undefined) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}
