import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "yuxibox-sd-video");
const ref = (path) => ({ $ref: path });
const coalesce = (...values) => ({ $coalesce: values });
const len = (value) => ({ $len: value });
const eq = (a, b) => ({ $eq: [a, b] });
const lte = (a, b) => ({ $lte: [a, b] });
const gte = (a, b) => ({ $gte: [a, b] });
const oneOf = (value, values) => ({ $in: [value, values] });
const ratios = ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const profiles = [
  { id: "yuxibox-sd20", model: "seedance-2.0（YX）", label: "YuxiBox Seedance 2.0（按秒）", seconds: 15, images: 9, videos: 3, audios: 3 },
  { id: "yuxibox-sd25", model: "seedance-2.5（YX）", label: "YuxiBox Seedance 2.5（按秒）", seconds: 30, images: 30, videos: 10, audios: 10 },
  { id: "yuxibox-sd25-per-request", model: "seedance-2.5（YX）-按次", label: "YuxiBox Seedance 2.5（按次）", seconds: 30, images: 30, videos: 10, audios: 10 },
];
const parameters = [
  ["model", "string", true, "model", "当前协议对应的官方模型 ID，保留全角括号。"],
  ["prompt", "string", true, "prompt", "1–16000 字符。"],
  ["duration", "integer", false, "seconds", "2.0 支持 5/10/15 秒，默认 15；2.5 支持 4–30 秒，默认 30。"],
  ["aspectRatio", "string", false, "ratio", "默认 16:9；使用 ratio 时不发送 size。"],
  ["resolution", "string", false, "fixed 720P", "固定 720P，只校验，不发送未公开的分辨率字段。"],
  ["images", "media[]", false, "reference_images[]", "按素材顺序发送图片 URL，不发送未经声明的 role。"],
  ["videos", "media[]", false, "videos[]", "按素材顺序发送参考视频 URL。"],
  ["audios", "media[]", false, "audios[]", "按素材顺序发送参考音频 URL。"],
].map(([name, type, required, mapping, description]) => ({ name, type, required, mapping, description }));
const media = (kind) => ({ $omitEmpty: { $map: { from: { $sortByOrder: ref(`request.${kind}`) }, as: "media", in: ref("media.value") } } });
const providers = profiles.map((profile) => {
  const duration = { $if: { condition: { $gt: [ref("request.duration"), 0] }, then: ref("request.duration"), else: profile.seconds } };
  const bounds = profile.id === "yuxibox-sd20" ? oneOf(duration, [5, 10, 15]) : { $and: [gte(duration, 4), lte(duration, 30)] };
  return {
    id: profile.id, label: profile.label,
    description: `${profile.model} 专属协议；POST /v1/videos，GET /v1/videos/{id}，GET /v1/videos/{id}/content。`,
    capabilities: ["video"], scopes: ["admin.system-channel", "user.custom-channel", "canvas", "creation", "agent"],
    baseUrl: "https://yuxibox.cn", requiresPublicMediaUrls: true,
    auth: { type: "bearer", field: "apiKey" }, parameters,
    validations: [
      { assert: eq(ref("request.model"), profile.model), message: `当前 YuxiBox 协议只适用于 ${profile.model}` },
      { assert: { $and: [gte(len(ref("request.prompt")), 1), lte(len(ref("request.prompt")), 16000)] }, message: "YuxiBox 视频提示词须为 1–16000 字符" },
      { assert: { $gte: [ref("request.duration"), 0] }, message: "YuxiBox 视频时长不能为负数" },
      { assert: bounds, message: `YuxiBox ${profile.model} 视频时长超出支持范围` },
      { assert: oneOf({ $lower: coalesce(ref("request.resolution"), "720p") }, ["720p"]), message: "YuxiBox 输出固定为 720P" },
      { assert: oneOf(coalesce(ref("request.aspectRatio"), "16:9"), ratios), message: "YuxiBox 不支持当前画面比例" },
      ...["images", "videos", "audios"].map((kind) => ({ assert: lte(len(ref(`request.${kind}`)), profile[kind]), message: `YuxiBox ${profile.model} 参考${{images:"图片",videos:"视频",audios:"音频"}[kind]}超出上限` })),
      { assert: eq(ref("request.generateAudio"), false), message: "YuxiBox 未公开生成音频开关" },
      { assert: eq(ref("request.watermark"), false), message: "YuxiBox 未公开水印开关" },
    ],
    create: { method: "POST", path: "/v1/videos", contentType: "application/json", body: {
      model: ref("request.model"), prompt: ref("request.prompt"), seconds: { $toString: duration }, ratio: coalesce(ref("request.aspectRatio"), "16:9"),
      reference_images: media("images"), videos: media("videos"), audios: media("audios"),
    } },
    poll: { method: "GET", path: "/v1/videos/{{taskId}}" },
    result: { method: "GET", path: "/v1/videos/{{taskId}}/content", headers: { Accept: "video/mp4" } },
    response: {
      taskId: coalesce(ref("response.id"), ref("taskId")),
      status: coalesce(ref("response.status"), "queued"),
      message: ref("response.error.message"), errorPaths: ["error.code"],
      videos: coalesce(ref("response.video_url"), ref("response.download_url")), resultEphemeral: true,
    },
  };
});
const manifest = {
  apiVersion: "yingce.plugin/v2", id: "yuxibox-sd-video", name: "YuxiBox SD 视频", version: "1.0.0", author: "YuxiBox / 影策",
  description: "YuxiBox Seedance 2.0、2.5 按秒及按次的声明式视频协议。",
  permissions: ["generation.run", "media.read"],
  configuration: { fields: [{ name: "apiKey", type: "secret", label: "API Key", required: true }] },
  contributes: { providers },
};
await mkdir(root, { recursive: true });
await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("generated YuxiBox SD video manifest; embed documentation and package before installing");
