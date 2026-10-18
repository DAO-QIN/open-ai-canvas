import type { CanvasAppearance } from "@/lib/canvas/agent-appearance";
import type { SpriteRunState } from "@/lib/canvas/sprite-pet";
import { SpriteAvatar } from "./sprite-avatar";
import { Live2DAvatar } from "./live2d-avatar";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { live2DModelURL, spriteImageURL } from "@/services/api/appearance";
import { useEffect } from "react";

export function PetAvatar({
    appearance,
    height,
    paused,
    reducedMotion,
    state,
    moveDirection,
    onReady,
    onError,
}: {
    appearance: CanvasAppearance;
    height: number;
    paused: boolean;
    reducedMotion: boolean;
    state?: SpriteRunState;
    moveDirection?: number;
    onReady?: () => void;
    onError?: (error: string) => void;
}) {
    useEffect(() => {
        if (appearance.avatarType === "orb") onReady?.();
    }, [appearance.avatarType, onReady]);
    if (appearance.avatarType === "sprite" && appearance.sprite && appearance.spriteResourceId)
        return (
            <SpriteAvatar
                pet={appearance.sprite}
                url={spriteImageURL(appearance.spriteResourceId)}
                height={height}
                state={state}
                moveDirection={moveDirection}
                paused={paused}
                reducedMotion={reducedMotion}
                onReady={onReady}
                onError={onError}
                fallback={<FluidOrb size={Math.min(60, height * 0.8)} />}
            />
        );
    if (appearance.avatarType === "live2d" && appearance.live2dResourceId)
        return (
            <span style={{ display: "block", position: "relative", width: height * 0.75, height }}>
                <span style={{ position: "absolute", left: 0, top: 0, width: 165, height: 220, transform: `scale(${height / 220})`, transformOrigin: "top left" }}>
                    <Live2DAvatar url={live2DModelURL(appearance.live2dResourceId, appearance.live2dEntry)} width={165} height={220} reducedMotion={reducedMotion || paused} onReady={onReady} onError={onError} fallback={<FluidOrb size={60} />} />
                </span>
            </span>
        );
    return <FluidOrb size={Math.max(24, height * 0.79)} />;
}
