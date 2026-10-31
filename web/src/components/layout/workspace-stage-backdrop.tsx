import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// 工作区舞台的最底层插槽：页面把装饰背景挂到这里，就能铺满整个舞台、从透明顶栏下面穿过，
// 又排在顶栏和页面内容之下（插槽是舞台的第一个子节点，绝对定位，不接收指针）。
const StageBackdropMountContext = createContext<HTMLElement | null>(null);
const StageBackdropSetterContext = createContext<(node: HTMLElement | null) => void>(() => undefined);

export function WorkspaceStageBackdropProvider({ children }: { children: ReactNode }) {
    const [mount, setMount] = useState<HTMLElement | null>(null);

    return (
        <StageBackdropSetterContext.Provider value={setMount}>
            <StageBackdropMountContext.Provider value={mount}>{children}</StageBackdropMountContext.Provider>
        </StageBackdropSetterContext.Provider>
    );
}

/** 放在 .app-workspace-stage 的第一个子节点。 */
export function WorkspaceStageBackdropSlot() {
    const setMount = useContext(StageBackdropSetterContext);
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        setMount(ref.current);
        return () => setMount(null);
    }, [setMount]);

    return <div ref={ref} className="app-workspace-stage-backdrop pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" />;
}

/** 页面的舞台背景；不在工作区外壳里（没有插槽）时不渲染。 */
export function WorkspaceStageBackdrop({ children }: { children: ReactNode }) {
    const mount = useContext(StageBackdropMountContext);
    return mount ? createPortal(children, mount) : null;
}
