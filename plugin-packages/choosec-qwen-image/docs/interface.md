# ChooseC 千问 2.1 图片接口字段

## 协议身份

- 插件和 Provider ID：`choosec-qwen-image`，版本 `1.1.1`。
- 能力：`image`；模型：`qwen-image-2.1-turbo`。
- Base URL：`https://api.choosec.cn`；现有渠道的 `https://api.choosec.cn/v1` 同样由宿主 URL 拼接规则处理。
- 文生图：`POST /v1/images/generations`，JSON；参考图：`POST /v1/images/edits`，multipart。均在当前请求中返回图片结果。
- 鉴权：配置字段 `apiKey` 为必填 secret，由宿主发送 `Authorization: Bearer <apiKey>`。
- 只申请 `generation.run` 和 `media.read`；没有 `host:` 执行器、独立路由或脚本运行时。

## 配置字段与参数映射

| 统一字段 | 上游字段 | 默认值 / 范围 |
| --- | --- | --- |
| `model` | `model` | 固定 `qwen-image-2.1-turbo` |
| `prompt` | `prompt` | 必填文字描述 |
| `aspectRatio` | `size` | 默认 `2048x2048`，允许自定义像素与可编辑比例预设 |
| `imageResolution` | 宿主换算 `size` | 默认 `2k`，初始渠道档位为 `1k/2k`；不发送独立 resolution |
| `images` | `image[]` 文件 | 0–10 张，有图时切换编辑接口，宿主读取 URL / data URL 后按顺序上传；无图时无文件 |
| `quality` | `quality` | `standard` |
| `imageCount` | `n` | 整数 1–10，默认 1 |
| `providerOptions.choosec-qwen-image.style` | `style` | `vivid` |
| `providerOptions.choosec-qwen-image.response_format` | `response_format` | `url` |

`imageParameters` 是后台「能力与参数」及生成面板共同使用的动态参数合同。选择此协议即填入上述默认值，初始参考图上限 10 张、单图 10MB，关闭独立蒙版、透明背景参数、输出编码及压缩控件。画风、响应格式及原始质量默认 `userVisible:false`，只在后台配置；隐藏不等于禁用，仍保留默认值和请求绑定。其他插件未声明展示设置时沿用现有显示行为。

页面中的尺寸、质量、画风和响应格式是默认值，不能当成唯一合法值。管理员可以配置比例、精确像素及其他参数，用户可输入自定义尺寸。初始像素预设提供 1K/2K，2K 面积不超过 2048×2048；4K 不在默认可用档位，管理员可在实际验证后配置。提示词沿用影绘现有 32000 字符平台限制，不将它描述为供应商极限。

官方 [Turbo 模型卡](https://huggingface.co/Qwen/Qwen-Image-2.1-Turbo) 支持图片编辑与 2K，但模型能力不代表中转协议相同。ChooseC 的真实错误响应明确要求输入图片改走 `/v1/images/edits`，因此本插件使用其 OpenAI Images 编辑入口和 [New API 文档](https://docs.newapi.pro/zh/docs/plugins/usage) 的 multipart `image[]` 文件合同，不再向生成入口发送官方托管 API 的 JSON `image`。生成数量保留 ChooseC 页面已有 1–10 配置，以实际渠道限制为准。

## 请求

```json
{"model":"qwen-image-2.1-turbo","prompt":"中文海报","size":"2048x2048","n":1}
```

默认文生图只含 `model/prompt/size/n`；`standard/vivid/url` 采用上游缺省行为，不重复发送可选字段。管理员配置其他质量、画风或响应格式时，发送对应字段。有参考图时这四项改为 multipart 普通字段，参考图按顺序放入重复的 `image[]` 文件部分。宿主读取真实图片字节并生成 boundary，不把 base64 当普通表单文字，不要求上游访问私有素材地址。两种请求都不发送 JSON `image/images`、独立 `resolution`、`output_format`、`background` 或 mask。比例和清晰度由宿主的可编辑预设换成像素后发送 `size`，精确像素原样发送。模型 ID、空提示词、参考图数量/缺少地址、独立蒙版、非法像素和数量范围在发送前校验。

提交失败后向用户返回真实失败；不因 502 或长时间等待自动重新提交创建请求，避免未知上游状态下重复出图与计费。

## 响应映射与错误

兼容 OpenAI Images 的 `data[].url` 及 `data[].b64_json`，保留全部返回图片和 `usage`。URL 标记为临时媒体，由宿主下载并持久化；下载失败保留失败语义。错误读取 `error.code` 和 `error.message`，HTTP 错误和缺少图片的响应不得作为可用图片结果。

## 兼容边界

该站创建端点与通用 `openai-image` 一致；独立插件用于隔离模型身份、默认参数和能力范围。`dashscope-qwen-image` 的百炼嵌套 `input/parameters` 与异步任务协议不是此接口。安装、切换协议或填充默认值不自动改变售价、计费方式和模型启用状态。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "choosec-qwen-image",
  "name": "ChooseC 千问 2.1 图片",
  "version": "1.1.1",
  "author": "影绘",
  "description": "ChooseC 千问 2.1 图片适配：文生图使用 JSON，参考图通过 edits 文件上传；默认 2K，可编辑尺寸与前台展示。",
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
            "default": "2048x2048",
            "pricing": true,
            "description": "WIDTHxHEIGHT；默认 2K，可编辑比例预设与自定义像素，不将示例写成白名单。"
          },
          {
            "name": "imageResolution",
            "label": "清晰度",
            "type": "string",
            "binding": "resolution",
            "default": "2k",
            "pricing": true,
            "description": "宿主按档位换算 size，不发送独立 resolution。默认 1K/2K，4K 由管理员验证后配置。"
          },
          {
            "name": "quality",
            "label": "图片质量",
            "type": "string",
            "binding": "quality",
            "default": "standard",
            "pricing": true,
            "userVisible": false
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
            "default": "vivid",
            "userVisible": false
          },
          {
            "name": "responseFormat",
            "label": "响应格式",
            "type": "string",
            "binding": "providerOptions.choosec-qwen-image.response_format",
            "default": "url",
            "userVisible": false
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
            "description": "WIDTHxHEIGHT，默认 2048x2048；比例由宿主按可编辑预设换算成像素。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image[]",
            "description": "0–10 张参考图；有图时走 edits，由宿主读取 URL / data URL 并按顺序上传 image[] 文件。"
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
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                10
              ]
            },
            "message": "千问参考图最多 10 张"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "where": {
                        "$gt": [
                          {
                            "$len": {
                              "$trim": {
                                "$coalesce": [
                                  {
                                    "$ref": "media.dataUrl"
                                  },
                                  {
                                    "$ref": "media.url"
                                  }
                                ]
                              }
                            }
                          },
                          0
                        ]
                      }
                    }
                  }
                },
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                }
              ]
            },
            "message": "参考图缺少可用的 URL 或 data URL"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "media.role"
                          },
                          "mask"
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "此兼容接口不接受独立蒙版参数，请使用普通参考图"
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
          "pathTemplate": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$ref": "request.images"
                    }
                  },
                  0
                ]
              },
              "then": "/v1/images/edits",
              "else": "/v1/images/generations"
            }
          },
          "contentType": "application/json",
          "contentTypeTemplate": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$ref": "request.images"
                    }
                  },
                  0
                ]
              },
              "then": "multipart/form-data",
              "else": "application/json"
            }
          },
          "files": [
            {
              "name": "image[]",
              "source": {
                "$sortByOrder": {
                  "$ref": "request.images"
                }
              }
            }
          ],
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
                "2048x2048"
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
