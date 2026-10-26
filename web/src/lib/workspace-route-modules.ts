const workspaceRouteLoaders = {
    assets: () => import("@/pages/assets"),
    canvas: () => import("@/pages/canvas"),
    create: () => import("@/pages/create"),
    home: () => import("@/pages/home"),
    inspirations: () => import("@/pages/inspirations/page"),
    inspiration: () => import("@/pages/inspiration"),
    projects: () => import("@/pages/projects"),
    projectDetail: () => import("@/pages/projects/detail"),
    projectCreate: () => import("@/pages/projects/create"),
    skillWorkbench: () => import("@/pages/skills/workbench"),
};

export const loadAssetsPage = workspaceRouteLoaders.assets;
export const loadCanvasPage = workspaceRouteLoaders.canvas;
export const loadCanvasProjectPage = () => import("@/pages/canvas/project");
export const loadCreatePage = workspaceRouteLoaders.create;
export const loadHomePage = workspaceRouteLoaders.home;
export const loadInspirationsPage = workspaceRouteLoaders.inspirations;
export const loadInspirationPage = workspaceRouteLoaders.inspiration;
export const loadProjectDetailPage = workspaceRouteLoaders.projectDetail;
export const loadProjectsPage = workspaceRouteLoaders.projects;
export const loadProjectCreatePage = workspaceRouteLoaders.projectCreate;
export const loadSkillWorkbenchPage = workspaceRouteLoaders.skillWorkbench;

export function preloadWorkspaceRoute(pathnameOrSlug: string) {
    // 根路径是首页；会话链接 /c/:id 属于创作页。
    const segments = pathnameOrSlug.replace(/^\//, "").split("/").filter(Boolean);
    const slug = !segments[0] ? "home" : segments[0] === "c" ? "create" : segments[0];
    // 具体画布项目由 /canvas/:id 自己加载；不要在认证恢复阶段额外预加载画布列表。
    if (slug === "canvas" && segments.length > 1) return;
    if (slug === "projects" && segments.length > 1) {
        void (segments[1] === "new" ? workspaceRouteLoaders.projectCreate() : workspaceRouteLoaders.projectDetail());
        return;
    }
    if (slug === "skills" && segments[2] === "edit") {
        void workspaceRouteLoaders.skillWorkbench();
        return;
    }
    const load = workspaceRouteLoaders[slug as keyof typeof workspaceRouteLoaders];
    if (load) void load();
}
