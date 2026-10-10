# 卡藏 Suno 接口合同

- Base URL：`https://newapi.prompt-hubs.com/v1`。宿主去重 `/v1`；Bearer 鉴权。
- 创建：`POST /v1/chat/completions`，`application/json`。
- 请求仅包含四项：`model="suno"`、`messages=[{"role":"user","content":提示词}]`、`n=1`、`stream=false`。
- 官方消息数组范围为 1–32 条，本插件每次只发送一条用户音乐描述。每次是一个独立音乐任务；一个任务生成两首。
- 响应为标准聊天 JSON，`choices[0].message.content` 中为 `[音乐音频 1](HTTPS链接)` 和 `[音乐音频 2](HTTPS链接)`。按出现顺序提取、去重并立即下载，两首分别存储。真实响应记录只保留在受保护的操作证据中，不把带签名链接放入源码。
- `error` / `error.message` 表示失败；非音频内容、缺少任一音乐均失败，不能伪造成功或重复第一首补数。
- 不声明轮询、取消、参考素材上传或独立结果端点。创建无自动重试；已生成媒体的保存恢复不重新创建音乐。
- 不发送 temperature、voice、speed、response_format、instructions、duration 或未知 Provider Options。无人声要求只能表达在提示词中，模型实际遵循情况须试听验收。
- 一次按请求计费，与提示词长度、成片时长及返回两首无关。

依据：[Suno 文档](https://console.prompt-hubs.com/docs/model/suno)、[Suno 参数与定价](https://console.prompt-hubs.com/pricing)，核对日期 2026-10-10。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "kacang-audio",
  "name": "卡藏音乐",
  "version": "1.0.0",
  "author": "卡藏 API / 影策",
  "description": "卡藏 Suno 纯文本音乐协议，每次一个任务返回两首音乐，固定非流式输出。",
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
        "label": "卡藏 Suno 音乐",
        "description": "suno 专用聊天格式音乐协议；纯文本、n=1、stream=false，每次返回两首。",
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
            "description": "固定 API 模型 ID：suno。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "messages[0].content",
            "description": "描述曲风、情绪、乐器及人声意图；不提供独立歌词或纯器乐参数。"
          },
          {
            "name": "taskCount",
            "type": "integer",
            "mapping": "n",
            "description": "固定为 1 个音乐任务，每个任务返回两首音乐。"
          },
          {
            "name": "stream",
            "type": "boolean",
            "mapping": "stream",
            "description": "固定为 false；生成可能需要数分钟。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "suno"
              ]
            },
            "message": "卡藏 Suno 协议仅适用于 suno 模型"
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
            "message": "音乐提示词不能为空"
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
            "message": "卡藏 Suno 不支持参考图片"
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
            "message": "卡藏 Suno 不支持参考视频"
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
            "message": "卡藏 Suno 不支持参考音频、改写或续写"
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
