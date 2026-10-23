# 文本音乐接口合同

核对依据：[Suno v6 文档](https://console.prompt-hubs.com/docs/model/suno-v6)，能力版本 `2026-10-23.001`。

- 默认 Base URL：`https://newapi.prompt-hubs.com/v1`，可由渠道覆盖；Bearer 鉴权。宿主避免重复 `/v1`。
- 创建：`POST /v1/chat/completions`，JSON 仅发送 `model`、一条 `user` 文本 `messages`、`n=1`、`stream=false`，以及模型支持时的 `instrumental` 布尔值。
- `model` 使用管理员配置的实际模型 ID，不固定为 `suno` 或 `suno-v6`。相同接口的模型可复用本协议，未实测的模型不承诺效果。
- Suno v6 接受 1–32 条纯文本消息，合并上限 3000 个 UTF-16 单元。本插件只发送一条合成后的描述，通过 `$utf16len` 校验最终请求，表情符号按两个单元计算。不同兼容模型的上限由 `audio.music.promptMaxChars` 配置。
- `audio.music.instrumentalSupported` 控制是否发送 `instrumental`，默认 true；`defaultInstrumental` 默认 false，用户选择歌曲／纯音乐覆盖默认。关闭支持时省略字段，不发送占位值。旧语音参数和未知 Provider Options 不进入音乐请求。
- 不提供独立歌词、时长、参考素材、音色、语速和格式参数。服务支持更多功能时应依据接口合同扩展，不能猜测字段。
- 响应从 `choices[0].message.content` 提取音频链接，支持普通 Markdown 音频链接及直接链接，去重并保持顺序。忽略封面图片；拒绝非 HTTP(S) 地址。短效签名仅用于立即下载，不泄露到用户文案或源码。
- 默认不承诺返回首数，所有实际音频分别持久化。`audio.outputCount=0` 为随模型；明确配置大于 0 时按该合同检查完整性，不重复第一首补数。
- `error` / `error.message` 为失败，无媒体、伪音频和下载失败不能伪装成功。创建无自动重试，无轮询或独立结果端点；媒体保存恢复沿用宿主机制。
- 生成可能需要数分钟。`audio.music.requestTimeoutSeconds` 默认 600，可设 1–3600 秒，单次创建请求受该上限及外层上下文约束。音频任务在普通任务期限和请求上限加三分钟中取较长值，为短效结果保存预留时间。一次请求只创建一个任务，按次计费，不按返回数量重复收费。连通性只读查询 `/v1/models`，不得以收费生成探测参数。

本页的渠道与接口细节仅供管理员和开发者使用；创作页面使用“歌曲／纯音乐”等简洁文案。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "kacang-audio",
  "name": "文本音乐生成",
  "version": "1.1.0",
  "author": "影绘",
  "description": "通过聊天接口生成音乐，支持歌曲与纯音乐，按实际返回保存所有音频。",
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
        "id": "kacang-suno",
        "label": "文本音乐（聊天接口）",
        "description": "适用于 Suno v6 及采用相同消息、纯音乐开关和音频链接响应格式的模型；不限制模型名。",
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
            "mapping": "model",
            "description": "管理员配置的实际 API 模型 ID，不锁定单个名称。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "messages[0].content",
            "description": "曲风、情绪、乐器与演唱意图。默认上限 3000 个 UTF-16 单元，可按模型配置。"
          },
          {
            "name": "audioInstrumental",
            "type": "boolean",
            "mapping": "instrumental",
            "description": "纯音乐开关，默认 false；模型不支持该字段时可在能力配置中关闭。"
          },
          {
            "name": "taskCount",
            "type": "integer",
            "mapping": "n",
            "description": "每次创建一个音乐任务，固定为 1。"
          },
          {
            "name": "stream",
            "type": "boolean",
            "mapping": "stream",
            "description": "固定 false，不以流式消息接收音乐。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$gt": [
                {
                  "$len": {
                    "$trim": {
                      "$ref": "request.model"
                    }
                  }
                },
                0
              ]
            },
            "message": "请选择音乐模型"
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
            "message": "请描述想生成的音乐"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$utf16len": {
                    "$ref": "request.prompt"
                  }
                },
                {
                  "$coalesce": [
                    {
                      "$ref": "request.extra.audioPromptMaxChars"
                    },
                    3000
                  ]
                }
              ]
            },
            "message": "音乐描述超过当前模型的字数上限，请精简后重试"
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
            "message": "当前音乐模型不支持参考图片"
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
            "message": "当前音乐模型不支持参考视频"
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
            "message": "当前音乐模型不支持参考音频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/chat/completions",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "messages": [
              {
                "role": "user",
                "content": {
                  "$ref": "request.prompt"
                }
              }
            ],
            "instrumental": {
              "$ref": "request.extra.audioInstrumental"
            },
            "n": 1,
            "stream": false
          }
        },
        "response": {
          "status": "completed",
          "taskIdPaths": [
            "id"
          ],
          "errorPaths": [
            "error"
          ],
          "messagePaths": [
            "error.message"
          ],
          "resultKind": "audio",
          "resultEphemeral": true,
          "resultUrlPaths": [
            "choices.0.message.content"
          ]
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
