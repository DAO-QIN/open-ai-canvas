import type { CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { spriteImageURL } from "@/services/api/appearance";
import { useSpriteImage } from "./use-sprite-image";
import { Circle, UserRound } from "lucide-react";
import "./pet-thumbnail.css";
import {useEffect,useRef,useState} from "react";
import { petAvatarSize } from "@/lib/canvas/pet-menu";

// Only the neutral sprite frame is mounted; model pickers never create Live2D contexts.
export function PetThumbnail({ pet, preview = false }: { pet: Pick<CanvasAppearance, "avatarType" | "sprite" | "spriteResourceId">; preview?: boolean }) {
    const url = pet.avatarType === "sprite" && pet.spriteResourceId ? spriteImageURL(pet.spriteResourceId, preview) : "";
    const host=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false);
    useEffect(()=>{if(!host.current||!url)return;const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setVisible(true);observer.disconnect();}},{rootMargin:"80px"});observer.observe(host.current);return()=>observer.disconnect();},[url]);
    const image = useSpriteImage(visible?url:"");
    if (pet.avatarType !== "sprite" || !pet.sprite || !url)
        return (
            <span className="pet-thumbnail-symbol" aria-hidden>
                {pet.avatarType === "orb" ? <Circle /> : <UserRound />}
            </span>
        );
    const p = pet.sprite,
        { width: w, height: h } = petAvatarSize(pet, 44),
        cols = p.atlasWidth / p.frameWidth,
        frame = p.neutralFrame;
    return (
        <span ref={host} aria-hidden className="pet-thumbnail-stage">
        <span className="pet-thumbnail" style={{ width: w, height: h }}>
            {image.src ? (
                <img alt="" src={image.src} draggable={false} style={{ width: (w * p.atlasWidth) / p.frameWidth, height: (h * p.atlasHeight) / p.frameHeight, transform: `translate(${(-frame % cols) * w}px,${-Math.floor(frame / cols) * h}px)` }} />
            ) : (
                <UserRound />
            )}
        </span></span>
    );
}
