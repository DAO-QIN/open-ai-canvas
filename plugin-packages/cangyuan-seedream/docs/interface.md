# 沧元 Seedream Pro 接口

供应商依据：[模型参数](https://ai.cangyuansuanli.cn/docs/models/doubao-seedream-5-0-pro)、[Image API](https://ai.cangyuansuanli.cn/docs/api/image)。仅支持文档明确列出的参数。

## 身份与配置

插件 ID `cangyuan-seedream`，Provider ID `cangyuan-seedream-5-pro`。渠道 `apiKey` 使用 Bearer 鉴权，默认入口 `https://direct-api.cangyuansuanli.cn/v1`。不在插件内保存凭据。支持后台系统渠道、自定义渠道、画布、创作与 Agent。

## 请求与参数

`model` 固定 `doubao-seedream-5-0-pro`；`prompt` 必填非空；`imageCount` 对应 `n=1`；`aspectRatio` 对应 `size`，默认 `1:1`。推荐 `1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9`，也可在后台添加自定义正整数比例或 `WIDTHxHEIGHT`。推荐比例不是上游完整允许集合，插件不将其设为不可扩展白名单；像素范围未发布，不借用其他供应商限制，最终可用范围由上游验证。

无 `images` 时 JSON POST `/v1/images/generations`；有参考图时 JSON POST `/v1/images/edits`，以相同路径 GET `/{task_id}` 轮询。`images` 按 order 排序为 HTTPS URL 数组，最多 10 张；本地素材由宿主转换为公网可读地址，插件拒绝 data URI、HTTP 和 mask。不发送未声明的 reference 字段。

`providerOptions.cangyuan-seedream-5-pro.output_format` 支持 `jpeg / png`，默认 `jpeg`；`response_format` 支持 `url / b64_json`，默认 `url`。`async` 固定 true。无取消接口，不捏造取消请求。宿主默认提示词 32000 字符、参考图 20 MB 为本应用限制；20 MB 与供应商本地上传接口上限一致，不代表远程 URL 限制。未发送 quality、resolution、watermark、background、seed、stream、sequential_image_generation 等未声明字段。

## 响应与错误

创建响应 `id / task_id` 映射统一任务 ID；`status` 交由宿主映射 queued、processing、completed、failed 等状态。沿原端点轮询，间隔由宿主控制。完成后 `data` 中全部 `url / b64_json` 结果及 `usage` 交给宿主下载、持久化。`error.code`、`error.message / message` 保持失败语义。失败不自动重新提交收费任务。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "cangyuan-seedream",
  "name": "沧元 Seedream 5.0 Pro",
  "version": "1.0.0",
  "author": "沧元算力 / 影绘",
  "description": "沧元 Seedream Pro 异步文生图与多参考图编辑协议。",
  "enabled": true,
  "installable": true,
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
        "id": "cangyuan-seedream-5-pro",
        "label": "沧元 Seedream 5.0 Pro",
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
        "baseUrl": "https://direct-api.cangyuansuanli.cn/v1",
        "requiresPublicMediaUrls": true,
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
            "default": "1:1",
            "pricing": true
          },
          {
            "name": "count",
            "label": "生成数量",
            "type": "integer",
            "binding": "imageCount",
            "min": 1,
            "max": 1,
            "step": 1,
            "default": 1
          },
          {
            "name": "outputFormat",
            "label": "输出格式",
            "type": "string",
            "binding": "providerOptions.cangyuan-seedream-5-pro.output_format",
            "values": [
              "jpeg",
              "png"
            ],
            "default": "jpeg"
          },
          {
            "name": "responseFormat",
            "label": "响应格式",
            "type": "string",
            "binding": "providerOptions.cangyuan-seedream-5-pro.response_format",
            "values": [
              "url",
              "b64_json"
            ],
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
            "description": "仅 doubao-seedream-5-0-pro，不使用方舟或可美模型别名。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "非空图片描述；32000 字符为宿主默认限制。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size",
            "description": "默认 1:1，八种推荐比例或自定义 WIDTHxHEIGHT。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "固定 1 张。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images",
            "description": "最多 10 张 HTTPS 参考图，按 order 排序；不支持 mask。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "providerOptions.cangyuan-seedream-5-pro",
            "description": "output_format 默认 jpeg；response_format 默认 url。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "doubao-seedream-5-0-pro"
              ]
            },
            "message": "此协议仅适用于沧元 doubao-seedream-5-0-pro。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$ref": "request.imageCount"
                },
                1
              ]
            },
            "message": "Seedream Pro 每次只能生成 1 张图片。"
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
            "message": "图片提示词不能为空。"
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
            "message": "参考图最多 10 张。"
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
            "message": "此协议不支持蒙版。"
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
                        "$ne": [
                          {
                            "$first": {
                              "$split": [
                                {
                                  "$ref": "media.value"
                                },
                                ":"
                              ]
                            }
                          },
                          "https"
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "参考图必须为 HTTPS URL，由宿主转换本地素材。"
          },
          {
            "assert": {
              "$or": [
                {
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
                                  "1:1"
                                ]
                              },
                              ":"
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
                                      "1:1"
                                    ]
                                  },
                                  ":"
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
                                      "1:1"
                                    ]
                                  },
                                  ":"
                                ]
                              },
                              1
                            ]
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "1:1"
                          ]
                        },
                        {
                          "$concat": [
                            {
                              "$toString": {
                                "$toInt": {
                                  "$at": [
                                    {
                                      "$split": [
                                        {
                                          "$coalesce": [
                                            {
                                              "$ref": "request.aspectRatio"
                                            },
                                            "1:1"
                                          ]
                                        },
                                        ":"
                                      ]
                                    },
                                    0
                                  ]
                                }
                              }
                            },
                            ":",
                            {
                              "$toString": {
                                "$toInt": {
                                  "$at": [
                                    {
                                      "$split": [
                                        {
                                          "$coalesce": [
                                            {
                                              "$ref": "request.aspectRatio"
                                            },
                                            "1:1"
                                          ]
                                        },
                                        ":"
                                      ]
                                    },
                                    1
                                  ]
                                }
                              }
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
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
                                  "1:1"
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
                                      "1:1"
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
                                      "1:1"
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
                    },
                    {
                      "$eq": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "1:1"
                          ]
                        },
                        {
                          "$concat": [
                            {
                              "$toString": {
                                "$toInt": {
                                  "$at": [
                                    {
                                      "$split": [
                                        {
                                          "$coalesce": [
                                            {
                                              "$ref": "request.aspectRatio"
                                            },
                                            "1:1"
                                          ]
                                        },
                                        "x"
                                      ]
                                    },
                                    0
                                  ]
                                }
                              }
                            },
                            "x",
                            {
                              "$toString": {
                                "$toInt": {
                                  "$at": [
                                    {
                                      "$split": [
                                        {
                                          "$coalesce": [
                                            {
                                              "$ref": "request.aspectRatio"
                                            },
                                            "1:1"
                                          ]
                                        },
                                        "x"
                                      ]
                                    },
                                    1
                                  ]
                                }
                              }
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "尺寸必须为正整数比例或 WIDTHxHEIGHT；可用范围由上游验证。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.cangyuan-seedream-5-pro.output_format"
                    },
                    "jpeg"
                  ]
                },
                [
                  "jpeg",
                  "png"
                ]
              ]
            },
            "message": "输出格式仅支持 jpeg / png。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.cangyuan-seedream-5-pro.response_format"
                    },
                    "url"
                  ]
                },
                [
                  "url",
                  "b64_json"
                ]
              ]
            },
            "message": "响应格式仅支持 url / b64_json。"
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
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "n": 1,
            "size": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "1:1"
              ]
            },
            "images": {
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
                "then": {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    },
                    "as": "media",
                    "in": {
                      "$ref": "media.value"
                    }
                  }
                },
                "else": null
              }
            },
            "async": true,
            "response_format": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.cangyuan-seedream-5-pro.response_format"
                },
                "url"
              ]
            },
            "output_format": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.cangyuan-seedream-5-pro.output_format"
                },
                "jpeg"
              ]
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/images/generations/{{taskId}}",
          "pathTemplate": {
            "$concat": [
              {
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
              "/",
              {
                "$ref": "taskId"
              }
            ]
          }
        },
        "response": {
          "taskIdPaths": [
            "id",
            "task_id"
          ],
          "statusPaths": [
            "status"
          ],
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "images": {
            "$ref": "response.data"
          },
          "usage": {
            "$ref": "response.usage"
          }
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
