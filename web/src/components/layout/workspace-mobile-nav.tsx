import { CircleUserRound, Images, PanelsTopLeft, WandSparkles } from "lucide-react";
import { Link, useLocation } from "react-router";

const items = [
    { to: "/", label: "创作", icon: WandSparkles, matches: (path: string) => path === "/" || path === "/create" },
    { to: "/canvas", label: "画布", icon: PanelsTopLeft, matches: (path: string) => path === "/canvas" },
    { to: "/assets", label: "素材", icon: Images, matches: (path: string) => path === "/assets" },
    { to: "/settings?section=profile", label: "我的", icon: CircleUserRound, matches: (path: string) => path === "/settings" || path === "/promotion" },
];

export function WorkspaceMobileNav({ hidden }: { hidden: boolean }) {
    const { pathname } = useLocation();
    return <nav className="app-workspace-mobile-nav" aria-label="常用导航" hidden={hidden}>
        {items.map(({ to, label, icon: Icon, matches }) => <Link key={to} to={to} aria-current={matches(pathname) ? "page" : undefined}>
            <Icon aria-hidden="true" /><span>{label}</span>
        </Link>)}
    </nav>;
}
