import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { UserAvatar } from "../src/components/layout/user-avatar";
import { resolveUserAvatarURL } from "../src/lib/user-avatar-url";
import { DEFAULT_USER_AVATARS, LEGACY_USER_AVATARS, isDefaultUserAvatarID } from "../src/lib/default-user-avatars";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { apiBaseURL } from "../src/services/api/request";
import type { LocalUser } from "../src/stores/use-user-store";

const user: LocalUser = { id: "user-1", username: "user", displayName: "User", role: "user", status: "active" };

function renderAvatar(avatarUrl?: string) {
    return renderToStaticMarkup(<UserAvatar user={{ ...user, avatarUrl }} className="size-8" />);
}

describe("shared user avatar image sources", () => {
    test("renders authenticated profile images and linked HTTP avatars", () => {
        for (const source of ["/api/auth/profile/avatar/user-1?v=012abc", "https://example.com/avatar.png", "http://example.com/avatar.jpg"]) {
            const markup = renderAvatar(source);
            expect(markup).toContain(`<img src="${resolveUserAvatarURL(source, apiBaseURL)}"`);
            expect(markup).toContain("object-cover");
        }
    });

    test("rejects unrelated relative URLs, traversal, protocol-relative and executable sources", () => {
        for (const source of [
            undefined,
            "",
            "/assets/avatar.png",
            "/api/auth/profile/avatar/../settings",
            "/api/auth/profile/avatar/user-1/../../settings",
            "/api/auth/profile/avatar/user-1?redirect=https://example.com",
            "//example.com/avatar.png",
            "data:image/svg+xml,test",
            "javascript:alert(1)",
            "blob:https://example.com/test",
        ]) {
            const markup = renderAvatar(source);
            expect(markup).not.toContain("<img");
            expect(markup).toContain("<svg");
        }
    });

    test("preserves sidebar icon styling when using the system default", () => {
        const markup = renderToStaticMarkup(<UserAvatar user={user} className="size-7" iconClassName="app-workspace-account-icon" />);
        expect(markup).toContain("app-workspace-account-icon");
        expect(markup).not.toContain("<img");
    });
});

describe("profile avatar deployment routing", () => {
    const canonical = "/api/auth/profile/avatar/user-1?v=012abc";

    test("resolves the canonical path onto API origins and proxy prefixes", () => {
        for (const [base, expected] of [
            ["/api", canonical],
            ["/api/", canonical],
            ["/proxy/yingce/api", "/proxy/yingce/api/auth/profile/avatar/user-1?v=012abc"],
            ["/proxy/yingce/api///", "/proxy/yingce/api/auth/profile/avatar/user-1?v=012abc"],
            ["https://backend.example.com/api", "https://backend.example.com/api/auth/profile/avatar/user-1?v=012abc"],
            ["https://backend.example.com/proxy/yingce/", "https://backend.example.com/proxy/yingce/auth/profile/avatar/user-1?v=012abc"],
            ["http://localhost:8080", "http://localhost:8080/auth/profile/avatar/user-1?v=012abc"],
            ["/", "/auth/profile/avatar/user-1?v=012abc"],
        ]) {
            expect(resolveUserAvatarURL(canonical, base)).toBe(expected);
        }
    });

    test("keeps third-party URLs independent of the configured API base", () => {
        for (const source of ["https://thirdparty.example.com/avatar.png?q=123", "http://thirdparty.example.com/avatar.jpg"]) {
            expect(resolveUserAvatarURL(source, "https://backend.example.com/proxy/api")).toBe(source);
        }
    });

    test("rejects noncanonical paths before joining with a custom backend", () => {
        for (const source of [
            undefined,
            "",
            "/api/auth/profile/avatar/user-1",
            "/api/auth/profile/avatar/user-1?v=",
            "/api/auth/profile/avatar/user-1?v=012abc&next=/settings",
            "/api/auth/profile/avatar/%2e%2e?v=012abc",
            "/api/auth/profile/avatar/user-1/../other?v=012abc",
            "/api/auth/profile/avatar/user-1?v=012abc#fragment",
            "/proxy/api/auth/profile/avatar/user-1?v=012abc",
            "//thirdparty.example.com/avatar.png",
            "data:image/png;base64,AAAA",
        ]) {
            expect(resolveUserAvatarURL(source, "https://backend.example.com/proxy/api")).toBe("");
        }
    });
});

describe("system avatar catalog and shared rendering", () => {
    test("exposes eight stable distinct presets and validates exact IDs", () => {
        expect(LEGACY_USER_AVATARS.map((avatar) => avatar.id)).toEqual(["person", "director", "camera", "cat", "rabbit", "robot", "rocket", "sparkles"]);
        expect(new Set(LEGACY_USER_AVATARS.map((avatar) => avatar.id)).size).toBe(8);
        for (const avatar of LEGACY_USER_AVATARS) {
            expect(isDefaultUserAvatarID(avatar.id)).toBe(true);
            expect(avatar.label).not.toBe("");
        }
        for (const invalid of [undefined, null, "", "Cat", " cat", "cat ", "default", "../person"]) {
            expect(isDefaultUserAvatarID(invalid)).toBe(false);
        }
    });

    test("renders the selected icon globally and overrides inherited image URLs", () => {
        const iconClasses = ["lucide-circle-user-round", "lucide-clapperboard", "lucide-camera", "lucide-cat", "lucide-rabbit", "lucide-bot", "lucide-rocket", "lucide-sparkles"];
        for (const [index, preset] of LEGACY_USER_AVATARS.entries()) {
            const markup = renderToStaticMarkup(
                <UserAvatar user={{ ...user, avatarMode: "default", avatarPreset: preset.id, avatarUrl: "https://example.com/inherited.png" }} className="creation-user-avatar" iconClassName="size-6 app-workspace-account-icon" />,
            );
            expect(markup).not.toContain("<img");
            expect(markup).toContain(iconClasses[index]);
            expect(markup).toContain("creation-user-avatar");
            expect(markup).toContain("app-workspace-account-icon");
        }
    });

    test("keeps custom images after remembering a preset preference", () => {
        const markup = renderToStaticMarkup(<UserAvatar user={{ ...user, avatarMode: "custom", avatarPreset: "cat", avatarUrl: "/api/auth/profile/avatar/user-1?v=012abc" }} />);
        expect(markup).toContain("<img");
        expect(markup).not.toContain("lucide-cat");
        const legacyDefault = renderToStaticMarkup(<UserAvatar user={{ ...user, avatarMode: "default" }} />);
        expect(legacyDefault).toContain("lucide-circle-user-round");
    });
});

describe("spirit avatar assets", () => {
    test("ships 48 distinct, passive SVGs with exact IDs and source receipts", () => {
        expect(DEFAULT_USER_AVATARS).toHaveLength(48);
        const manifest = JSON.parse(readFileSync(new URL("../public/avatars/spirit-v1/manifest.json", import.meta.url), "utf8"));
        const hashes = new Set<string>();
        let totalBytes = 0;
        for (const [index, avatar] of DEFAULT_USER_AVATARS.entries()) {
            expect(avatar.id).toBe(`spirit-v1-${String(index + 1).padStart(2, "0")}`);
            expect(isDefaultUserAvatarID(avatar.id)).toBe(true);
            expect(avatar.id.length).toBeLessThanOrEqual(16);
            const bytes = readFileSync(new URL(`../public${avatar.src}`, import.meta.url));
            const svg = bytes.toString();
            expect(svg).toContain("<svg");
            expect(svg).not.toMatch(/<(?:script|animate|animateTransform|set|foreignObject)\b|\bon\w+=|(?:href|src)=["'](?:https?:|\/\/)/i);
            const hash = createHash("sha256").update(bytes).digest("hex");
            expect(manifest.avatars[index]).toMatchObject({ id: avatar.id, bytes: bytes.length, sha256: hash });
            hashes.add(hash);
            totalBytes += bytes.length;
            const markup = renderToStaticMarkup(<UserAvatar user={{ ...user, avatarMode: "default", avatarPreset: avatar.id, avatarUrl: "https://example.com/ignored.png" }} />);
            expect(markup).toContain(`src="${avatar.src}"`);
            expect(markup).not.toContain("example.com");
        }
        expect(hashes.size).toBe(48);
        expect(totalBytes).toBeLessThan(2 * 1024 * 1024);
        for (const invalid of ["spirit-v1-00", "spirit-v1-49", "spirit-v1-1", "spirit-v1-001", "spirit-v1-+1", "spirit-v1-01/../02"]) expect(isDefaultUserAvatarID(invalid)).toBe(false);
    });

    test("custom images override remembered spirit presets", () => {
        const markup = renderToStaticMarkup(<UserAvatar user={{ ...user, avatarMode: "custom", avatarPreset: "spirit-v1-48", avatarUrl: "/api/auth/profile/avatar/user-1?v=012abc" }} />);
        expect(markup).toContain("/auth/profile/avatar/user-1?v=012abc");
        expect(markup).not.toContain("/avatars/spirit-v1/");
    });
});
