import { expect, test } from "bun:test";

import { defaultFeatureAvailability } from "../src/stores/use-user-store";

test("new workbench entries stay closed until the backend explicitly opens them", () => {
    expect(defaultFeatureAvailability.imageWorkbenchEnabled).toBe(false);
    expect(defaultFeatureAvailability.videoWorkbenchEnabled).toBe(false);
});

test("admin saves independent workbench switches without folding promotion into ordinary features", async () => {
    const [sidebar, panel, auth] = await Promise.all([
        Bun.file(new URL("../src/components/layout/workspace-sidebar-nav.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/feature-availability-panel.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/services/api/auth.ts", import.meta.url)).text(),
    ]);

    expect(sidebar).toContain('features.imageWorkbenchEnabled ? [toolItem("toolbox-image", "/toolbox/image")]');
    expect(sidebar).toContain('features.videoWorkbenchEnabled ? [toolItem("toolbox-video", "/toolbox/video")]');
    const payload = panel.slice(panel.indexOf("function toEditablePayload"), panel.indexOf("function sameEditableFeatures"));
    expect(payload).toContain("imageWorkbenchEnabled: features.imageWorkbenchEnabled");
    expect(payload).toContain("videoWorkbenchEnabled: features.videoWorkbenchEnabled");
    expect(payload).not.toContain("promotionEnabled");
    expect(panel).toContain('key: "promotionEnabled"');
    expect(panel).toContain("updatePromotionPolicy({ ...promotionPolicy, enabled })");
    expect(panel).toContain("promotionEnabled: promotionPolicy.enabled");
    expect(panel).toContain("useUserStore.getState().user?.id === userID");
    expect(panel).toContain("controllerRef.current?.abort()");
    expect(auth).toMatch(/"imageWorkbenchEnabled"\s*\|\s*"videoWorkbenchEnabled"/);
    expect(auth).toContain("getAdminFeatureAvailability(signal?: AbortSignal)");
});

test("the account menu preserves invitation recovery and routes profile settings", async () => {
    const [card, sidebar] = await Promise.all([Bun.file(new URL("../src/components/layout/workspace-account-card.tsx", import.meta.url)).text(), Bun.file(new URL("../src/components/layout/workspace-sidebar-nav.tsx", import.meta.url)).text()]);

    expect(card).toContain("usePromotionOverview(user?.id, active)");
    expect(card).toContain("promotion.showEntry");
    expect(card).toContain('to="/settings?section=profile"');
    expect(sidebar).toContain("active={menuOpen}");
    expect(sidebar).toContain("features.promotionEnabled");
});
