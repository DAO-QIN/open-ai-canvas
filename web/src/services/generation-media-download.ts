import { ApiError } from "@/services/api/request";

type MediaType = "image" | "video" | "audio";

export async function validGenerationMedia(blob: Blob, mediaType: MediaType) {
    if (!blob.size) return false;
    const mime = blob.type.split(";")[0].trim().toLowerCase();
    const bytes = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
    const head = new TextDecoder().decode(bytes).trimStart();
    if (/^(?:<!doctype\s+html|<html|<head|<body|\{|\[)/i.test(head)) return false;
    if (mime.startsWith(`${mediaType}/`)) return true;
    // Some providers use an unspecified binary type. Accept recognized media
    // signatures in that case, rather than caching an HTML/JSON error page.
    if (mime && !["application/octet-stream", "binary/octet-stream", "application/ogg"].includes(mime)) return false;
    const ascii = (start: number, count: number) => String.fromCharCode(...bytes.slice(start, start + count));
    if (mediaType === "image") return ascii(1, 3) === "PNG" || (bytes[0] === 0xff && bytes[1] === 0xd8) || /^GIF8/.test(head) || (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") || (ascii(4, 4) === "ftyp" && /avif|heic|heif/.test(ascii(8, 16)));
    if (mediaType === "audio" && (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) || ascii(0, 4) === "fLaC" || (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE"))) return true;
    return ascii(4, 4) === "ftyp" || ascii(0, 4) === "OggS" || (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3);
}

export async function downloadGenerationMedia(url: string, mediaType: MediaType, signal?: AbortSignal) {
    const response = await fetch(url, { signal, credentials: "same-origin" });
    if (!response.ok) throw new ApiError("生成结果下载失败，请重试读取原任务结果", { status: response.status, reason: "generation_media_download_failed" });
    const blob = await response.blob();
    if (!(await validGenerationMedia(blob, mediaType))) throw new ApiError("生成结果为空或不是有效媒体，请重试读取原任务结果", { reason: "generation_media_invalid", retryable: true });
    return blob;
}
