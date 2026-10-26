// 「全部灵感」：灵感大厅独立页面。点「使用」时带着提示词进入创作页预填，不自动生成。
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import type { CreationInspiration } from "@/lib/inspirations/catalog";
import { inspirationPrefillState } from "@/pages/home/home-featured-inspirations";

import { InspirationHall } from "./index";

export default function InspirationsPage() {
    const navigate = useNavigate();
    return (
        <WorkspacePage>
            <InspirationHall onUse={(item: CreationInspiration) => navigate("/create", { state: inspirationPrefillState(item) })} />
        </WorkspacePage>
    );
}
