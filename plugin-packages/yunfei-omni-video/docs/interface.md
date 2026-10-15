# omni-flash 视频接口合同

## 请求和素材

- 创建与查询均设置 `originPath=true`，渠道地址已有 `/v1` 时不会重复拼接；鉴权使用 `Authorization: Bearer`，凭据不放入 URL。
- 顶层 JSON 仅发送 `model/prompt/duration/resolution/aspect_ratio` 及实际使用的素材数组。时长为整数；不发送兼容字段 seconds、size、images、音轨控制、随机种子、n 或未公布参数。
- 图片按用户顺序映射为 `reference_images` 对象数组，普通参考使用 `role=reference`，首尾帧分别使用 `first_frame/last_frame`。首尾帧各最多一张；拒绝与普通图、参考音频或视频同时使用。
- 音频与视频按用户顺序映射到 `reference_audios/reference_videos`。空数组省略，避免覆盖上游兼容字段优先级。HTTP(S) 与 data URL 的实际安全和媒体校验由宿主执行，插件不放宽出站限制。
- 文档未列 omni-flash 专属规格上限；仅默认开放通用示例 8秒/720p/16:9。默认引用数量由用户选定，属于平台限制。后台可调整引用数量；提示词 8000 字符及宿主媒体策略继续生效。

## 任务状态、响应和成片

- 创建返回 `id`；queued 为排队，in_progress/processing 为生成中，completed 为完成，failed 为失败。error 对象/字符串、非成功业务 code、缺失或未知状态保留失败语义。
- 仅 completed 时取有效 HTTP(S) 的顶层 url，缺省时取 output 数组中第一个有效 url。提前返回 URL 不视为完成；completed 未提供媒体地址则宿主返回失败。
- 成片 URL 为临时资源，宿主及时下载并保存。没有声明供应商未公布的 /content 或取消端点；查询、下载重试与恢复始终使用原任务 ID，不重新创建付费任务。
- 真实测试按文档建议每 5 秒查询，遇到 completed/failed 结束。未将模型广场的价格自动换算为平台售卖积分，启用及定价由管理员决定。

## 字段映射

| 统一字段 | 类型 | 上游字段 | 说明 |
| --- | --- | --- | --- |
| `model` | string | `model` | 精确模型 ID：omni-flash。 |
| `prompt` | string | `prompt` | 视频描述；宿主默认 8000 字符是平台限制。 |
| `duration` | integer | `duration` | 当前默认及开放 8 秒，采用文档示例；不是供应商上限。 |
| `resolution` | string | `resolution` | 当前默认及开放 720p。 |
| `aspectRatio` | string | `aspect_ratio` | 当前默认及开放 16:9。 |
| `images` | media[] | `reference_images` | 保序对象数组；首尾帧保留 first_frame/last_frame，普通图 role=reference。支持媒体 data URL 与 HTTP(S)。 |
| `videos` | media[] | `reference_videos` | 保序视频数组，默认平台上限 1 项，可由管理员调整。 |
| `audios` | media[] | `reference_audios` | 保序音频数组，默认平台上限 1 项，可由管理员调整。 |

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "yunfei-omni-video",
  "name": "爱困 Gemini 视频 · omni-flash",
  "version": "1.0.0",
  "author": "影策",
  "description": "独立适配 img.yunfei.best 的 omni-flash JSON 视频任务接口。",
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
        "id": "yunfei-omni-flash-video",
        "label": "爱困 Gemini 视频 · omni-flash",
        "description": "img.yunfei.best 原生异步 JSON；默认 8秒/720p/16:9，首尾帧或图/视/音参考。",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://img.yunfei.best",
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
            "description": "精确模型 ID：omni-flash。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频描述；宿主默认 8000 字符是平台限制。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "当前默认及开放 8 秒，采用文档示例；不是供应商上限。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "当前默认及开放 720p。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "当前默认及开放 16:9。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "保序对象数组；首尾帧保留 first_frame/last_frame，普通图 role=reference。支持媒体 data URL 与 HTTP(S)。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference_videos",
            "description": "保序视频数组，默认平台上限 1 项，可由管理员调整。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference_audios",
            "description": "保序音频数组，默认平台上限 1 项，可由管理员调整。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "omni-flash"
              ]
            },
            "message": "爱困视频协议仅适用于 omni-flash"
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
            "message": "视频提示词不能为空"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.output.duration"
                    },
                    8
                  ]
                },
                8
              ]
            },
            "message": "当前协议开放文档示例的 8 秒规格"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.output.aspectRatio"
                    },
                    "16:9"
                  ]
                },
                "16:9"
              ]
            },
            "message": "当前协议开放文档示例的 16:9 比例"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$lower": {
                    "$coalesce": [
                      {
                        "$ref": "request.output.resolution"
                      },
                      "720p"
                    ]
                  }
                },
                "720p"
              ]
            },
            "message": "当前协议开放文档示例的 720p 分辨率"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.output.count"
                    },
                    1
                  ]
                },
                1
              ]
            },
            "message": "每次任务仅生成一个视频"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.output.generateAudio"
                    },
                    false
                  ]
                },
                false
              ]
            },
            "message": "供应商未公布音轨控制参数"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.output.watermark"
                    },
                    false
                  ]
                },
                false
              ]
            },
            "message": "供应商未公布水印控制参数"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$in": [
                          {
                            "$ref": "media.role"
                          },
                          [
                            "first_frame"
                          ]
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "首帧最多一张"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$in": [
                          {
                            "$ref": "media.role"
                          },
                          [
                            "last_frame"
                          ]
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "尾帧最多一张"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$in": [
                              {
                                "$ref": "media.role"
                              },
                              [
                                "first_frame",
                                "last_frame"
                              ]
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$filter": {
                              "from": {
                                "$sortByOrder": {
                                  "$ref": "request.images"
                                }
                              },
                              "as": "media",
                              "where": {
                                "$in": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  [
                                    "",
                                    "reference_image",
                                    "style_reference",
                                    "subject_reference",
                                    "element_reference"
                                  ]
                                ]
                              }
                            }
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.videos"
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.audios"
                          }
                        },
                        0
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "按供应商文档，首尾帧模式与普通参考素材模式分开使用"
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
                        "$not": {
                          "$in": [
                            {
                              "$ref": "media.role"
                            },
                            [
                              "",
                              "reference_image",
                              "style_reference",
                              "subject_reference",
                              "element_reference",
                              "first_frame",
                              "last_frame"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "当前视频协议不支持该素材角色"
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
                        "$not": {
                          "$in": [
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
                            [
                              "http",
                              "https",
                              "data"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "参考素材须为 HTTP(S) 链接或含媒体类型的 Base64 data URL"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.videos"
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$ref": "media.role"
                            },
                            [
                              "",
                              "reference_video",
                              "source_video"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "当前视频协议不支持该素材角色"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.videos"
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$in": [
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
                            [
                              "http",
                              "https",
                              "data"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "参考素材须为 HTTP(S) 链接或含媒体类型的 Base64 data URL"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.audios"
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$ref": "media.role"
                            },
                            [
                              "",
                              "reference_audio"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "当前视频协议不支持该素材角色"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.audios"
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$in": [
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
                            [
                              "http",
                              "https",
                              "data"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "参考素材须为 HTTP(S) 链接或含媒体类型的 Base64 data URL"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": {
              "$coalesce": [
                {
                  "$ref": "request.output.duration"
                },
                8
              ]
            },
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.output.resolution"
                  },
                  "720p"
                ]
              }
            },
            "aspect_ratio": {
              "$coalesce": [
                {
                  "$ref": "request.output.aspectRatio"
                },
                "16:9"
              ]
            },
            "reference_images": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.images"
                    }
                  },
                  "as": "media",
                  "in": {
                    "url": {
                      "$ref": "media.value"
                    },
                    "role": {
                      "$if": {
                        "condition": {
                          "$in": [
                            {
                              "$ref": "media.role"
                            },
                            [
                              "first_frame",
                              "last_frame"
                            ]
                          ]
                        },
                        "then": {
                          "$ref": "media.role"
                        },
                        "else": "reference"
                      }
                    }
                  }
                }
              }
            },
            "reference_videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.videos"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "reference_audios": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.audios"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "originPath": true
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$ref": "response.error"
              },
              "then": "failed",
              "else": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$ref": "response.status"
                      },
                      [
                        "queued",
                        "in_progress",
                        "processing",
                        "completed",
                        "failed"
                      ]
                    ]
                  },
                  "then": {
                    "$ref": "response.status"
                  },
                  "else": "failed"
                }
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.error"
              },
              {
                "$ref": "response.message"
              },
              "供应商未返回有效任务状态"
            ]
          },
          "errorPaths": [
            "error.code",
            "code"
          ],
          "videos": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "completed"
                    ]
                  },
                  {
                    "$not": {
                      "$ref": "response.error"
                    }
                  }
                ]
              },
              "then": {
                "$first": {
                  "$filter": {
                    "from": {
                      "$concatArrays": [
                        [
                          {
                            "$ref": "response.url"
                          }
                        ],
                        {
                          "$map": {
                            "from": {
                              "$ref": "response.output"
                            },
                            "as": "item",
                            "in": {
                              "$ref": "item.url"
                            }
                          }
                        }
                      ]
                    },
                    "as": "url",
                    "where": {
                      "$in": [
                        {
                          "$first": {
                            "$split": [
                              {
                                "$ref": "url"
                              },
                              ":"
                            ]
                          }
                        },
                        [
                          "http",
                          "https"
                        ]
                      ]
                    }
                  }
                }
              },
              "else": null
            }
          },
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
