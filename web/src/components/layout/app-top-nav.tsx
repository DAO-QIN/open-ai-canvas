import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { X } from "lucide-react";

import { BannerAnnouncementsSlider } from "@/components/layout/banner-announcements-slider";
import { ModelSetupGuide } from "@/components/layout/model-setup-guide";
import { WorkspaceSidebarNav } from "@/components/layout/workspace-sidebar-nav";
import { readWorkspaceSidebarCollapsed, writeWorkspaceSidebarCollapsed } from "@/components/layout/workspace-sidebar-state";
import { WorkspaceTopBar } from "@/components/layout/workspace-top-bar";
import { WorkspaceTopBarExtensionProvider } from "@/components/layout/workspace-top-bar-extension";
import { WorkspaceStorageLimitNotice } from "@/components/layout/workspace-storage-limit-notice";
import { WorkspaceWalletHost } from "@/components/layout/workspace-wallet-modal";
import { WorkspaceMobileNav } from "@/components/layout/workspace-mobile-nav";
import { cn } from "@/lib/utils";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";

const WorkspaceCommandPalette = lazy(() => import("@/components/layout/workspace-command-palette").then((module) => ({ default: module.WorkspaceCommandPalette })));

export function AppWorkspaceShell({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
    const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(readWorkspaceSidebarCollapsed);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [mobileViewport, setMobileViewport] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
    const sidebarRef = useRef<HTMLElement>(null);
    const sidebarToggleRef = useRef<HTMLButtonElement>(null);
    const sidebarCollapsed = !mobileViewport && desktopSidebarCollapsed;

    const hideChrome = pathname.startsWith("/admin") || /^\/canvas\/[^/]+/.test(pathname);
    const showGlobalTopBar = !hideChrome;
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    const creationWorkspace = pathname === "/" || pathname === "/create";

    useEffect(() => {
        setMobileSidebarExpanded(false);
    }, [pathname]);

    useEffect(() => {
        const media = window.matchMedia("(max-width: 1023px)");
        const update = () => {
            setMobileViewport(media.matches);
            if (!media.matches) setMobileSidebarExpanded(false);
        };
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        if (!mobileViewport || !mobileSidebarExpanded || hideChrome) return;
        const sidebar = sidebarRef.current;
        if (!sidebar) return;
        const focusable = () => Array.from(sidebar.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
        (sidebar.querySelector<HTMLElement>('[aria-current="page"]') || focusable()[0])?.focus();
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setMobileSidebarExpanded(false);
            }
            if (event.key === "Tab") {
                const items = focusable();
                const first = items[0];
                const last = items.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        };
        sidebar.addEventListener("keydown", handleKey);
        return () => {
            sidebar.removeEventListener("keydown", handleKey);
            sidebarToggleRef.current?.focus();
        };
    }, [mobileViewport, mobileSidebarExpanded, hideChrome]);

    const toggleSidebar = () => {
        if (mobileViewport) {
            setMobileSidebarExpanded((current) => !current);
            return;
        }
        setDesktopSidebarCollapsed((current) => {
            const next = !current;
            writeWorkspaceSidebarCollapsed(next);
            return next;
        });
    };

    const expandDesktopSidebar = () => {
        setDesktopSidebarCollapsed(false);
        writeWorkspaceSidebarCollapsed(false);
    };

    const collapseDesktopSidebar = () => {
        setDesktopSidebarCollapsed(true);
        writeWorkspaceSidebarCollapsed(true);
    };

    const handleNavClick = () => {
        if (mobileViewport) setMobileSidebarExpanded(false);
    };

    // ⌘K / Ctrl+K 全局呼出搜索面板。
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setPaletteOpen((open) => !open);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    useEffect(() => {
        const handleWorkspaceNavigation = (rawEvent: Event) => {
            const event = rawEvent as CustomEvent<{ to?: string }>;
            if (!event.detail?.to) return;
            event.preventDefault();
            navigate(event.detail.to);
        };
        window.addEventListener("workspace:navigate", handleWorkspaceNavigation);
        return () => window.removeEventListener("workspace:navigate", handleWorkspaceNavigation);
    }, [navigate]);

    return (
        <>
            <WorkspaceTopBarExtensionProvider>
                <div className={cn("app-workspace-shell flex h-dvh min-h-0 w-full flex-col overflow-hidden", spatialWorkbench && "is-spatial", creationWorkspace && "is-creation-workspace")}>
                    {!hideChrome && mobileSidebarExpanded ? <button type="button" className="app-workspace-sidebar-scrim lg:hidden" aria-label="收起侧栏" onClick={() => setMobileSidebarExpanded(false)} /> : null}

                    {showGlobalTopBar ? <BannerAnnouncementsSlider /> : null}

                    <div className="app-workspace-main-row flex min-h-0 min-w-0 flex-1 overflow-hidden">
                        {!hideChrome ? (
                            <aside
                                id="workspace-sidebar"
                                ref={sidebarRef}
                                role={mobileViewport && mobileSidebarExpanded ? "dialog" : undefined}
                                aria-modal={mobileViewport && mobileSidebarExpanded ? true : undefined}
                                aria-label="导航"
                                inert={mobileViewport && !mobileSidebarExpanded ? true : undefined}
                                className={cn("app-workspace-sidebar flex h-full shrink-0 flex-col overflow-hidden", mobileSidebarExpanded && "is-mobile-expanded", sidebarCollapsed && "is-collapsed")}
                            >
                                <button type="button" className="app-workspace-sidebar-mobile-close" aria-label="关闭导航" onClick={() => setMobileSidebarExpanded(false)}>
                                    <X aria-hidden="true" />
                                </button>
                                <WorkspaceSidebarNav
                                    collapsed={sidebarCollapsed}
                                    onNavigate={handleNavClick}
                                    onOpenSearch={() => setPaletteOpen(true)}
                                    onExpand={expandDesktopSidebar}
                                    onCollapse={mobileViewport ? () => setMobileSidebarExpanded(false) : collapseDesktopSidebar}
                                />
                            </aside>
                        ) : null}

                        <div className="app-workspace-stage relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" inert={mobileViewport && mobileSidebarExpanded ? true : undefined}>
                            {showGlobalTopBar ? <WorkspaceTopBar sidebarOpen={mobileViewport ? mobileSidebarExpanded : !desktopSidebarCollapsed} onToggleSidebar={toggleSidebar} sidebarToggleRef={sidebarToggleRef} /> : null}
                            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
                        </div>
                    </div>

                    {!hideChrome ? <WorkspaceMobileNav hidden={mobileSidebarExpanded} /> : null}
                    {paletteOpen ? (
                        <Suspense fallback={null}>
                            <WorkspaceCommandPalette open onClose={() => setPaletteOpen(false)} />
                        </Suspense>
                    ) : null}
                </div>
            </WorkspaceTopBarExtensionProvider>
            <WorkspaceWalletHost />
            <WorkspaceStorageLimitNotice />
            <ModelSetupGuide hidden={pathname === "/login" || pathname === "/register" || pathname.startsWith("/admin")} />
        </>
    );
}
