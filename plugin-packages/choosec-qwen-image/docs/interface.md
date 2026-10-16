# ChooseC 千问 2.1 图片接口字段

## 协议身份

- 插件和 Provider ID：`choosec-qwen-image`，版本 `1.0.0`。
- 能力：`image`；模型：`qwen-image-2.1-turbo`。
- Base URL：`https://api.choosec.cn`；现有渠道的 `https://api.choosec.cn/v1` 同样由宿主 URL 拼接规则处理。
- 创建：`POST /v1/images/generations`，JSON 同步图片响应。
- 鉴权：配置字段 `apiKey` 为必填 secret，由宿主发送 `Authorization: Bearer <apiKey>`。
- 只申请 `generation.run` 和 `media.read`；没有 `host:` 执行器、独立路由或脚本运行时。

## 配置字段与参数映射

| 统一字段 | 上游字段 | 默认值 / 范围 |
| --- | --- | --- |
| `model` | `model` | 固定 `qwen-image-2.1-turbo` |
| `prompt` | `prompt` | 必填文字描述 |
| `aspectRatio` | `size` | 默认 `1024x1024`，允许自定义像素与可编辑比例预设 |
| `quality` | `quality` | `standard` |
| `imageCount` | `n` | 整数 1–10，默认 1 |
| `providerOptions.choosec-qwen-image.style` | `style` | `vivid` |
| `providerOptions.choosec-qwen-image.response_format` | `response_format` | `url` |

`imageParameters` 是后台「能力与参数」及生成面板共同使用的动态参数合同。选择此协议即填入上述默认值，关闭独立分辨率、透明背景、输出编码及压缩控件。默认参考图数量为 0，蒙版关闭；当前插件范围为已公布的文生图调用。

页面中的尺寸、质量、画风和响应格式是示例默认值，不能当成唯一合法值。插件不把这些默认值写成枚举白名单：管理员可以配置比例、精确像素及其他参数，用户可以输入自定义尺寸；供应商对取值的实际限制由其 API 校验。初始比例使用宿主 1K 像素换算预设，可在后台编辑，不代表供应商尺寸上限。参考编辑及蒙版尚无该站明确调用说明，当前插件仍聚焦文生图。提示词沿用影绘现有 32000 字符平台限制，不将它描述为供应商极限。未声明的媒体字节限制为 0。

## 请求

```json
{"model":"qwen-image-2.1-turbo","prompt":"中文海报","size":"1024x1024","n":1}
```

默认请求与站点示例一致，仅含 `model/prompt/size/n`；`standard/vivid/url` 是页面标注的默认值，采用上游缺省行为，不重复发送可选字段。用户或管理员明确配置其他质量、画风或响应格式时，原样发送对应字段。不发送独立 `resolution`、`output_format`、`background`、参考图或蒙版字段，不推测 edits、任务查询和取消端点。比例由宿主的可编辑预设换成像素后发送 `size`，精确像素原样发送。模型 ID、空提示词、引用、非正整数像素和数量范围在发送请求前校验；动态参数保留渠道配置值，不用示例覆盖。

## 响应映射与错误

兼容 OpenAI Images 的 `data[].url` 及 `data[].b64_json`，保留全部返回图片和 `usage`。URL 标记为临时媒体，由宿主下载并持久化；下载失败保留失败语义。错误读取 `error.code` 和 `error.message`，HTTP 错误和缺少图片的响应不得作为可用图片结果。

## 兼容边界

该站创建端点与通用 `openai-image` 一致；独立插件用于隔离模型身份、默认参数和能力范围。`dashscope-qwen-image` 的百炼嵌套 `input/parameters` 与异步任务协议不是此接口。安装、切换协议或填充默认值不自动改变售价、计费方式和模型启用状态。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "choosec-qwen-image",
  "name": "ChooseC 千问 2.1 图片",
  "version": "1.0.0",
  "author": "影绘",
  "description": "ChooseC qwen-image-2.1-turbo 文生图协议与可配置参数默认值。",
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
        "id": "choosec-qwen-image",
        "label": "ChooseC 千问 2.1 Turbo 图片",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.choosec.cn",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "imageParameters": [
          {
            "name": "size",
            "label": "画幅 / 尺寸",
            "type": "string",
            "binding": "aspectRatio",
            "encoding": "pixels",
            "default": "1024x1024",
            "pricing": true,
            "description": "WIDTHxHEIGHT；1024x1024 是示例默认值，可编辑比例、像素预设与自定义尺寸。"
          },
          {
            "name": "quality",
            "label": "图片质量",
            "type": "string",
            "binding": "quality",
            "default": "standard",
            "pricing": true
          },
          {
            "name": "count",
            "label": "生成数量",
            "type": "integer",
            "binding": "imageCount",
            "min": 1,
            "max": 10,
            "step": 1,
            "default": 1
          },
          {
            "name": "style",
            "label": "画风",
            "type": "string",
            "binding": "providerOptions.choosec-qwen-image.style",
            "default": "vivid"
          },
          {
            "name": "responseFormat",
            "label": "响应格式",
            "type": "string",
            "binding": "providerOptions.choosec-qwen-image.response_format",
            "default": "url"
          }
        ],
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "精确模型 ID qwen-image-2.1-turbo。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "生成图像的文字描述。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "size",
            "description": "WIDTHxHEIGHT，默认 1024x1024；比例由宿主按可编辑预设换算成像素。"
          },
          {
            "name": "quality",
            "type": "string",
            "mapping": "quality",
            "description": "默认 standard，支持值由渠道配置及供应商决定。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "mapping": "n",
            "description": "1–10 张，默认 1 张。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "style,response_format",
            "description": "choosec-qwen-image 命名空间的画风与响应格式，默认 vivid 和 url。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "qwen-image-2.1-turbo"
              ]
            },
            "message": "当前 ChooseC 千问图片协议仅适用于 qwen-image-2.1-turbo"
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
            "message": "请输入图片提示词"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$split": [
                          {
                            "$coalesce": [
                              {
                                "$ref": "request.aspectRatio"
                              },
                              "1024x1024"
                            ]
                          },
                          "x"
                        ]
                      }
                    },
                    2
                  ]
                },
                {
                  "$gt": [
                    {
                      "$toInt": {
                        "$at": [
                          {
                            "$split": [
                              {
                                "$coalesce": [
                                  {
                                    "$ref": "request.aspectRatio"
                                  },
                                  "1024x1024"
                                ]
                              },
                              "x"
                            ]
                          },
                          0
                        ]
                      }
                    },
                    0
                  ]
                },
                {
                  "$gt": [
                    {
                      "$toInt": {
                        "$at": [
                          {
                            "$split": [
                              {
                                "$coalesce": [
                                  {
                                    "$ref": "request.aspectRatio"
                                  },
                                  "1024x1024"
                                ]
                              },
                              "x"
                            ]
                          },
                          1
                        ]
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "ChooseC size 须为正整数 WIDTHxHEIGHT；比例须先按渠道预设换算"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.imageCount"
                    },
                    0
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.imageCount"
                    },
                    10
                  ]
                }
              ]
            },
            "message": "ChooseC 单次生成数量须为 1–10，未指定时默认 1"
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
            "message": "当前 ChooseC 插件的文生图接口不接受参考图或蒙版"
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
            "message": "ChooseC 图片接口不接受视频引用"
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
            "message": "ChooseC 图片接口不接受音频引用"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/images/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "size": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "1024x1024"
              ]
            },
            "quality": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$coalesce": [
                          {
                            "$ref": "request.quality"
                          },
                          "standard"
                        ]
                      },
                      [
                        "auto",
                        "standard"
                      ]
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.quality"
                  }
                }
              }
            },
            "n": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.imageCount"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.imageCount"
                },
                "else": 1
              }
            },
            "style": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$coalesce": [
                          {
                            "$ref": "request.providerOptions.choosec-qwen-image.style"
                          },
                          "vivid"
                        ]
                      },
                      "vivid"
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.providerOptions.choosec-qwen-image.style"
                  }
                }
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$coalesce": [
                          {
                            "$ref": "request.providerOptions.choosec-qwen-image.response_format"
                          },
                          "url"
                        ]
                      },
                      "url"
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.providerOptions.choosec-qwen-image.response_format"
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
                "$gt": [
                  {
                    "$len": {
                      "$ref": "response.data"
                    }
                  },
                  0
                ]
              },
              "then": "succeeded",
              "else": "failed"
            }
          },
          "message": {
            "$ref": "response.error.message"
          },
          "images": {
            "$map": {
              "from": {
                "$ref": "response.data"
              },
              "as": "item",
              "in": {
                "url": {
                  "$omitEmpty": {
                    "$ref": "item.url"
                  }
                },
                "dataUrl": {
                  "$if": {
                    "condition": {
                      "$ref": "item.b64_json"
                    },
                    "then": {
                      "$concat": [
                        "data:image/png;base64,",
                        {
                          "$ref": "item.b64_json"
                        }
                      ]
                    },
                    "else": null
                  }
                }
              }
            }
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message"
          ],
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
