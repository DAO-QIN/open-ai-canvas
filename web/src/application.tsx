import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "./styles/globals.css";
import "./styles/auth-input-fix.css";
import "./styles/shared/model-picker.css";
import "./styles/shared/overlays.css";
import "./styles/shared/scrollbars.css";
import "./styles/ui-scale.css";
import { RouterProvider } from "react-router";

import { AppProviders } from "@/components/layout/app-providers";
import { router } from "@/router";
import { syncUiScaleForPath } from "@/lib/ui-scale";

// 画布编辑器等页面不参与桌面端整体 90% 缩放，路由切换时同步。
syncUiScaleForPath(router.state.location.pathname);
router.subscribe((state) => syncUiScaleForPath(state.location.pathname));

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} useTransitions={false} />
        </AppProviders>
    </React.StrictMode>,
);
