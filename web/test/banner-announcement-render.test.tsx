import { expect, test } from "bun:test";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BannerAnnouncementBody, BannerAnnouncementShell } from "../src/components/layout/banner-announcement-content";
import { bannerEdgeMask } from "../src/lib/announcements/banner-edge";
import { bannerInkColor } from "../src/lib/announcements/banner-theme";

test("自定义配色与动效写到通知条外壳上，调用方的样式一并保留", () => {
    const html = renderToStaticMarkup(
        <BannerAnnouncementShell noticeType="activity" theme={{ bgColor: "#001328", glowColor: "#02c6c4", bgEffect: "static" }} style={{ "--nb-rotate-ms": "6000ms" } as CSSProperties}>
            <span>通知内容</span>
        </BannerAnnouncementShell>,
    );
    expect(html).toContain('data-notice-type="activity"');
    expect(html).toContain('data-effect="static"');
    expect(html).toMatch(/--nb-base:\s*#001328/);
    expect(html).toMatch(/--nb-glow:\s*#02C6C4/);
    expect(html).toMatch(new RegExp(`--nb-ink:\\s*${bannerInkColor("#02C6C4")}`));
    expect(html).toMatch(/--nb-rotate-ms:\s*6000ms/);
});

test("跟随类型时不写颜色变量，动效默认流动，底边默认方格、平直颗粒带", () => {
    const html = renderToStaticMarkup(
        <BannerAnnouncementShell noticeType="notice" theme={{ bgColor: "", glowColor: "" }}>
            <span>通知内容</span>
        </BannerAnnouncementShell>,
    );
    expect(html).not.toContain("--nb-base");
    expect(html).not.toContain("--nb-glow");
    expect(html).toContain('data-effect="aurora"');
    expect(html).toContain('data-edge-shape="square"');
    expect(html).toContain('data-edge-wave="flat"');
    expect(html).toContain('data-edge-band=""');
    const mask = bannerEdgeMask("square", "flat");
    expect(html).toMatch(new RegExp(`--nb-edge-rows:\\s*${mask.rows}`));
    expect(html).toMatch(new RegExp(`--nb-edge-columns:\\s*${mask.columns}`));
    expect(html).toContain("--nb-edge-mask:");
});

test("后台选的外形与波纹写到外壳上；平滑 + 平直是直边，不挂颗粒带", () => {
    const wave = renderToStaticMarkup(
        <BannerAnnouncementShell noticeType="notice" theme={{ edgeShape: "dot", edgeWave: "zigzag" }}>
            <span>通知内容</span>
        </BannerAnnouncementShell>,
    );
    expect(wave).toContain('data-edge-shape="dot"');
    expect(wave).toContain('data-edge-wave="zigzag"');
    expect(wave).toMatch(new RegExp(`--nb-edge-rows:\\s*${bannerEdgeMask("dot", "zigzag").rows}`));

    const straight = renderToStaticMarkup(
        <BannerAnnouncementShell noticeType="notice" theme={{ edgeShape: "smooth", edgeWave: "flat" }}>
            <span>通知内容</span>
        </BannerAnnouncementShell>,
    );
    expect(straight).toContain('data-edge-shape="smooth"');
    expect(straight).not.toContain("data-edge-band");
    expect(straight).not.toContain("--nb-edge-mask");
});

test("内容区渲染倒计时、标题与行动按钮", () => {
    const now = Date.parse("2026-10-28T08:00:00Z");
    const html = renderToStaticMarkup(<BannerAnnouncementBody titleRuns={[{ text: "限时活动" }]} ctaLabel="进群领积分" countdownTarget={now + 3_723_000} now={now} />);
    expect(html).toContain('aria-label="距结束还有 1 小时 2 分 3 秒"');
    expect(html).toContain("限时活动");
    expect(html).toContain("进群领积分");
    expect(html).toContain("notice-banner-cta");
});
