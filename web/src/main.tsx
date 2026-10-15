import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { installChunkRecovery } from "@/lib/chunk-recovery";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";
import { isIsolatedPrevisRepro } from "@/lib/dev-repro";
import { migrateBrowserStorage } from "@/services/browser-storage-migration";

installChunkRecovery();

// The public film entry checks its availability independently of workspace bootstrap.
async function startApplication() {
    await migrateBrowserStorage();
    if (/^\/welcome\/?$/.test(window.location.pathname)) {
        void bootstrapAppearance().catch(() => undefined);
        void import("./welcome-application");
    } else {
        // The backend-free DEV lab must not make requests before AppProviders isolates it.
        const appearanceReady = isIsolatedPrevisRepro(import.meta.env.DEV, window.location.pathname) ? Promise.resolve() : bootstrapAppearance();
        void import("./application");
        void appearanceReady.catch(() => undefined);
    }
}

void startApplication().catch((error: unknown) => {
    const root = document.getElementById("root");
    if (!root) return;
    root.replaceChildren();
    const text = document.createElement("p");
    text.textContent = error instanceof DOMException && error.name === "QuotaExceededError" ? "本地空间不足，原始资料仍已保留。请释放空间后重试。" : "本地资料恢复未完成，原始资料仍已保留。请重试。";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "重试";
    retry.onclick = () => window.location.reload();
    root.append(text, retry);
});
