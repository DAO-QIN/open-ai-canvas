# 卡藏 Gemini TTS 接口合同

- 插件及 Provider ID：`kacang-gemini-tts`；模型 `model`：`gemini-3.8-flash-tts`。
- Base URL：`https://newapi.prompt-hubs.com/v1`；鉴权字段 `apiKey` 使用 Bearer 请求头，不写入 URL 或清单。
- 创建：`POST /v1beta/models/gemini-3.8-flash-tts:generateContent`，`application/json`。`originPath=true` 从站点根路径请求，避免渠道 `/v1` 与 `/v1beta` 错误拼接。
- `prompt` 原样写入 `contents[0].parts[0].text`；纯文本输入，不接受图片、视频、音频参考。
- `audioVoice` 写入 `generationConfig.speechConfig.voiceConfig.voice`，默认 `Kore`；切换协议残留的 OpenAI `alloy` 使用默认音色。
- `audioInstructions` 写入文本 part 的 `speech_metadata.style`；默认 `自然、友好、清晰`。语速、音量、情绪和节奏通过声音指令描述，不发送未公布的数值 speed 参数。
- `generationConfig.responseModalities` 固定 `['AUDIO']`。单次输入上限 8192 token、音频输出上限 16384 token；此插件不把 token 数推测为字符数或音频秒数。
- 不发送 `response_format`、数值 `speed`、时长、temperature、参考素材或未选择的 Provider Options；不声明未验证的多说话人设置、轮询、取消或流式端点。

## 响应与保存

`candidates[0].content.parts[].inlineData` 每段有 `mimeType` 和 Base64 `data`。声明式 `response.inlineAudio` 指定有序音频路径及 `pcm-s16le` / 24000 Hz / 1 声道。宿主逐段解码后拼接完整 PCM，封装一次 RIFF/WAV 头；不拼接带 padding 的 Base64 字符串，不把每个片段保存为独立音频。若上游返回完整 WAV，先验证相同的 PCM 规格再提取样本，避免重复容器头。

PCM MIME 接受 `audio/l16`、`audio/pcm`，已提供的 rate/channels 必须符合声明；WAV 接受 `audio/wav`、`audio/x-wav`。未知 MIME、非法 Base64、空片段、缺少音频、截断样本、格式不一致或超过 64 MiB 失败关闭。上游 error、内容拦截及已知非完整 finishReason 保持失败语义。最终只有一段 `audio/wav` 媒体，交由宿主资源库正常保存与权限控制。

一次合成只提交一次，不自动重新创建付费请求。`usageMetadata` 保留为用量信息，不改变按次计费口径。

## 一手依据

[卡藏 Gemini TTS 文档](https://console.prompt-hubs.com/docs/model/gemini-3.8-flash-tts)确认实际代理端点、voice 字段、style、30 音色和多段 raw PCM。
[Google 音频格式文档](https://ai.google.dev/gemini-api/docs/speech-generation)确认 16-bit signed little-endian PCM。请求形状以卡藏代理文档为准，不套用 Google Interactions 接口。

核对日期：2026-10-14。预置音色：Zephyr、Puck、Charon、Kore、Fenrir、Leda、Orus、Aoede、Callirrhoe、Autonoe、Enceladus、Iapetus、Umbriel、Algieba、Despina、Erinome、Algenib、Rasalgethi、Laomedeia、Achernar、Alnilam、Schedar、Gacrux、Pulcherrima、Achird、Zubenelgenubi、Vindemiatrix、Sadachbia、Sadaltager、Sulafat。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "kacang-gemini-tts",
  "name": "卡藏 Gemini 语音合成",
  "version": "1.0.0",
  "author": "卡藏 API / 影策",
  "description": "gemini-3.8-flash-tts 专用语音协议，默认 Kore 音色，按顺序拼接内联音频并保存 WAV。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "kacang-gemini-tts",
        "label": "卡藏 Gemini TTS",
        "description": "Gemini 原生 generateContent 语音合成；纯文本朗读，30 个预置音色，默认 WAV / 24kHz / 单声道。",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://newapi.prompt-hubs.com/v1",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model / URL model",
            "description": "固定 API 模型 ID：gemini-3.8-flash-tts。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "contents[0].parts[0].text",
            "description": "逐字朗读稿件，纯文本；上游输入上限 8192 token。"
          },
          {
            "name": "audioVoice",
            "type": "string",
            "mapping": "generationConfig.speechConfig.voiceConfig.voice",
            "description": "默认 Kore；支持已公布的 30 个音色，以及用户明确提供的扩展音色 ID。"
          },
          {
            "name": "audioInstructions",
            "type": "string",
            "mapping": "contents[0].parts[0].speech_metadata.style",
            "description": "语气、节奏和音量；默认自然、友好、清晰。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "gemini-3.8-flash-tts"
              ]
            },
            "message": "卡藏 Gemini TTS 协议仅适用于 gemini-3.8-flash-tts"
          },
          {
            "assert": {
              "$gt": [
                {
                  "$len": {
                    "$trim": {
                      "$ref": "request.prompt"
                    }
                  }
                },
                0
              ]
            },
            "message": "朗读稿件不能为空"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                0
              ]
            },
            "message": "卡藏 Gemini TTS 不支持参考图片"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "卡藏 Gemini TTS 不支持参考视频"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                0
              ]
            },
            "message": "卡藏 Gemini TTS 不支持参考音频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1beta/models/{{model}}:generateContent",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "contents": [
              {
                "role": "user",
                "parts": [
                  {
                    "text": {
                      "$ref": "request.prompt"
                    },
                    "speech_metadata": {
                      "style": {
                        "$coalesce": [
                          {
                            "$ref": "request.extra.audioInstructions"
                          },
                          "自然、友好、清晰"
                        ]
                      }
                    }
                  }
                ]
              }
            ],
            "generationConfig": {
              "responseModalities": [
                "AUDIO"
              ],
              "speechConfig": {
                "voiceConfig": {
                  "voice": {
                    "$if": {
                      "condition": {
                        "$in": [
                          {
                            "$coalesce": [
                              {
                                "$ref": "request.extra.audioVoice"
                              },
                              "alloy"
                            ]
                          },
                          [
                            "alloy"
                          ]
                        ]
                      },
                      "then": "Kore",
                      "else": {
                        "$ref": "request.extra.audioVoice"
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "response": {
          "status": {
            "$if": {
              "condition": {
                "$in": [
                  {
                    "$ref": "response.candidates.0.finishReason"
                  },
                  [
                    "MAX_TOKENS",
                    "SAFETY",
                    "RECITATION",
                    "OTHER"
                  ]
                ]
              },
              "then": "failed",
              "else": "succeeded"
            }
          },
          "errorPaths": [
            "error",
            "promptFeedback.blockReason"
          ],
          "messagePaths": [
            "error.message",
            "promptFeedback.blockReason",
            "candidates.0.finishReason"
          ],
          "resultKind": "audio",
          "inlineAudio": {
            "partsPath": "candidates.0.content.parts",
            "dataPath": "inlineData.data",
            "mimeTypePath": "inlineData.mimeType",
            "encoding": "pcm-s16le",
            "sampleRate": 24000,
            "channels": 1
          },
          "usage": {
            "$ref": "response.usageMetadata"
          }
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
