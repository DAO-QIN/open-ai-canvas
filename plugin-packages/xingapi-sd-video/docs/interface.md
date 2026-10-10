# 星光视频接口合同

- Base URL：`https://xingapi.top/v1`；渠道已带 `/v1` 时宿主去重。
- 鉴权：所有请求 `Authorization: Bearer API_KEY`，密钥由宿主管理。
- 创建：`POST /v1/videos/generations`，`Content-Type: application/json`。
- 正文仅包含 `model`、`prompt`、整数 `duration`、`ratio`、`resolution`，以及当前模型支持的非空 `images`、`videos`、`audios` 字符串数组。
- 查询：`GET /v1/videos/{task_id}`；任务 ID 接受 `task_id` 或 `id`。
- 下载：`GET /v1/videos/{task_id}/content`，`Accept: video/mp4`，沿用同一鉴权。
- `queued/pending` 等待；`running/processing/in_progress` 处理中；`success/completed/succeeded/done/finished` 成功；`failed/error/cancelled/canceled` 失败。
- 未公开取消接口，不能发出取消请求。HTTP 错误和上游错误对象保持失败语义。
- 参考素材需要任务期间持续有效的公网直链；不发送本地路径或 `data:`。宿主把本地素材转换为签名公网链接；不得绕过 SSRF 和归属校验。
- 宿主统一控制超时/轮询/下载重试；恢复已有任务 ID 只查询和下载，不创建新计费任务。创建失败不能盲目重发。
- 与 Dola-pool 的 `reference_images/size`、968 的 `/videos/generations/{id}` 查询路径和 YuxiBox 的 `seconds` 字段不同，不能互换。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 覆盖身份、权限、配置、参数、校验、请求与响应。`documentation` 使用占位表示本文，避免递归。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "xingapi-sd-video",
  "name": "星光 API SD 视频",
  "version": "1.0.0",
  "author": "星光 API / 影策",
  "description": "星光 API Seedance 视频协议，包含 Mini 480P、Mini 720P、933、933 V 和 2.5 的独立参数配置。",
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
        "id": "xingapi-sd-mini-480p",
        "label": "星光 Seedance Mini 480P",
        "description": "seedance-2.0-mini-480P 专属协议；5–10 秒，480p，参考图片/视频/音频 9/0/3。",
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
        "baseUrl": "https://xingapi.top/v1",
        "requiresPublicMediaUrls": true,
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
            "description": "当前协议对应的精确模型 ID；以当前 Key 的 /v1/models 为准。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "动作、主体和镜头描述；提示词上限沿用宿主默认 8000 字符，非上游公布值。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "5–10 秒；省略使用插件默认 5 秒，发送整数。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "16:9 或 9:16，默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "固定 480p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images[]",
            "description": "最多 9 张公网参考图，数组顺序对应 @Image1 等。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos[]",
            "description": "最多 0 条公网参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios[]",
            "description": "最多 3 条公网参考音频。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "seedance-2.0-mini-480P"
              ]
            },
            "message": "当前星光协议仅适用于 seedance-2.0-mini-480P"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$len": {
                    "$ref": "request.prompt"
                  }
                },
                1
              ]
            },
            "message": "星光视频提示词不能为空"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$ref": "request.duration"
                },
                0
              ]
            },
            "message": "星光视频时长不能为负数"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.duration"
                        },
                        "else": 5
                      }
                    },
                    5
                  ]
                },
                {
                  "$lte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.duration"
                        },
                        "else": 5
                      }
                    },
                    10
                  ]
                }
              ]
            },
            "message": "当前星光模型支持 5–10 秒"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "16:9"
                  ]
                },
                [
                  "16:9",
                  "9:16"
                ]
              ]
            },
            "message": "星光视频比例请选择 16:9 或 9:16"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$lower": {
                    "$coalesce": [
                      {
                        "$ref": "request.resolution"
                      },
                      "480p"
                    ]
                  }
                },
                "480p"
              ]
            },
            "message": "当前星光模型输出固定为 480p"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.generateAudio"
                },
                false
              ]
            },
            "message": "星光未公开生成音频开关"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.watermark"
                },
                false
              ]
            },
            "message": "星光未公开水印开关"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                9
              ]
            },
            "message": "当前星光模型最多支持 9 个参考images"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "当前星光模型最多支持 0 个参考videos"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "当前星光模型最多支持 3 个参考audios"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.duration"
                },
                "else": 5
              }
            },
            "ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
            },
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "480p"
                ]
              }
            },
            "images": {
              "$omitEmpty": {
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
              }
            },
            "audios": {
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
          "path": "/v1/videos/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task_id"
              },
              {
                "$coalesce": [
                  {
                    "$ref": "response.id"
                  },
                  {
                    "$ref": "taskId"
                  }
                ]
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$lower": {
                      "$ref": "response.status"
                    }
                  },
                  "finished"
                ]
              },
              "then": "completed",
              "else": {
                "$coalesce": [
                  {
                    "$ref": "response.status"
                  },
                  "queued"
                ]
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.download_url"
              }
            ]
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "xingapi-sd-mini-720p",
        "label": "星光 Seedance Mini 720P",
        "description": "seedance-2.0-mini-720P 专属协议；5–15 秒，720p，参考图片/视频/音频 9/0/0。",
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
        "baseUrl": "https://xingapi.top/v1",
        "requiresPublicMediaUrls": true,
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
            "description": "当前协议对应的精确模型 ID；以当前 Key 的 /v1/models 为准。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "动作、主体和镜头描述；提示词上限沿用宿主默认 8000 字符，非上游公布值。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "5–15 秒；省略使用插件默认 5 秒，发送整数。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "16:9 或 9:16，默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "固定 720p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images[]",
            "description": "最多 9 张公网参考图，数组顺序对应 @Image1 等。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos[]",
            "description": "最多 0 条公网参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios[]",
            "description": "最多 0 条公网参考音频。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "seedance-2.0-mini-720P"
              ]
            },
            "message": "当前星光协议仅适用于 seedance-2.0-mini-720P"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$len": {
                    "$ref": "request.prompt"
                  }
                },
                1
              ]
            },
            "message": "星光视频提示词不能为空"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$ref": "request.duration"
                },
                0
              ]
            },
            "message": "星光视频时长不能为负数"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.duration"
                        },
                        "else": 5
                      }
                    },
                    5
                  ]
                },
                {
                  "$lte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.duration"
                        },
                        "else": 5
                      }
                    },
                    15
                  ]
                }
              ]
            },
            "message": "当前星光模型支持 5–15 秒"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "16:9"
                  ]
                },
                [
                  "16:9",
                  "9:16"
                ]
              ]
            },
            "message": "星光视频比例请选择 16:9 或 9:16"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$lower": {
                    "$coalesce": [
                      {
                        "$ref": "request.resolution"
                      },
                      "720p"
                    ]
                  }
                },
                "720p"
              ]
            },
            "message": "当前星光模型输出固定为 720p"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.generateAudio"
                },
                false
              ]
            },
            "message": "星光未公开生成音频开关"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.watermark"
                },
                false
              ]
            },
            "message": "星光未公开水印开关"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                9
              ]
            },
            "message": "当前星光模型最多支持 9 个参考images"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "当前星光模型最多支持 0 个参考videos"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                0
              ]
            },
            "message": "当前星光模型最多支持 0 个参考audios"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.duration"
                },
                "else": 5
              }
            },
            "ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
            },
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "720p"
                ]
              }
            },
            "images": {
              "$omitEmpty": {
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
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task_id"
              },
              {
                "$coalesce": [
                  {
                    "$ref": "response.id"
                  },
                  {
                    "$ref": "taskId"
                  }
                ]
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$lower": {
                      "$ref": "response.status"
                    }
                  },
                  "finished"
                ]
              },
              "then": "completed",
              "else": {
                "$coalesce": [
                  {
                    "$ref": "response.status"
                  },
                  "queued"
                ]
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.download_url"
              }
            ]
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "xingapi-sd-933",
        "label": "星光 Seedance 2.0 933",
        "description": "seedance2.0-933 专属协议；4–15 秒，720p，参考图片/视频/音频 9/0/3。",
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
        "baseUrl": "https://xingapi.top/v1",
        "requiresPublicMediaUrls": true,
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
            "description": "当前协议对应的精确模型 ID；以当前 Key 的 /v1/models 为准。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "动作、主体和镜头描述；提示词上限沿用宿主默认 8000 字符，非上游公布值。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "4–15 秒；省略使用插件默认 5 秒，发送整数。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "16:9 或 9:16，默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "固定 720p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images[]",
            "description": "最多 9 张公网参考图，数组顺序对应 @Image1 等。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos[]",
            "description": "最多 0 条公网参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios[]",
            "description": "最多 3 条公网参考音频。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "seedance2.0-933"
              ]
            },
            "message": "当前星光协议仅适用于 seedance2.0-933"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$len": {
                    "$ref": "request.prompt"
                  }
                },
                1
              ]
            },
            "message": "星光视频提示词不能为空"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$ref": "request.duration"
                },
                0
              ]
            },
            "message": "星光视频时长不能为负数"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.duration"
                        },
                        "else": 5
                      }
                    },
                    4
                  ]
                },
                {
                  "$lte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.duration"
                        },
                        "else": 5
                      }
                    },
                    15
                  ]
                }
              ]
            },
            "message": "当前星光模型支持 4–15 秒"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "16:9"
                  ]
                },
                [
                  "16:9",
                  "9:16"
                ]
              ]
            },
            "message": "星光视频比例请选择 16:9 或 9:16"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$lower": {
                    "$coalesce": [
                      {
                        "$ref": "request.resolution"
                      },
                      "720p"
                    ]
                  }
                },
                "720p"
              ]
            },
            "message": "当前星光模型输出固定为 720p"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.generateAudio"
                },
                false
              ]
            },
            "message": "星光未公开生成音频开关"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.watermark"
                },
                false
              ]
            },
            "message": "星光未公开水印开关"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                9
              ]
            },
            "message": "当前星光模型最多支持 9 个参考images"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "当前星光模型最多支持 0 个参考videos"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "当前星光模型最多支持 3 个参考audios"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.duration"
                },
                "else": 5
              }
            },
            "ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
            },
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "720p"
                ]
              }
            },
            "images": {
              "$omitEmpty": {
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
              }
            },
            "audios": {
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
          "path": "/v1/videos/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task_id"
              },
              {
                "$coalesce": [
                  {
                    "$ref": "response.id"
                  },
                  {
                    "$ref": "taskId"
                  }
                ]
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$lower": {
                      "$ref": "response.status"
                    }
                  },
                  "finished"
                ]
              },
              "then": "completed",
              "else": {
                "$coalesce": [
                  {
                    "$ref": "response.status"
                  },
                  "queued"
                ]
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.download_url"
              }
            ]
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "xingapi-sd-933-v",
        "label": "星光 Seedance 2.0 933 V",
        "description": "seedance2.0-933-V 专属协议；5–15 秒，720p，参考图片/视频/音频 9/3/3。",
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
        "baseUrl": "https://xingapi.top/v1",
        "requiresPublicMediaUrls": true,
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
            "description": "当前协议对应的精确模型 ID；以当前 Key 的 /v1/models 为准。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "动作、主体和镜头描述；提示词上限沿用宿主默认 8000 字符，非上游公布值。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "5–15 秒；省略使用插件默认 5 秒，发送整数。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "16:9 或 9:16，默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "固定 720p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images[]",
            "description": "最多 9 张公网参考图，数组顺序对应 @Image1 等。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos[]",
            "description": "最多 3 条公网参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios[]",
            "description": "最多 3 条公网参考音频。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "seedance2.0-933-V"
              ]
            },
            "message": "当前星光协议仅适用于 seedance2.0-933-V"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$len": {
                    "$ref": "request.prompt"
                  }
                },
                1
              ]
            },
            "message": "星光视频提示词不能为空"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$ref": "request.duration"
                },
                0
              ]
            },
            "message": "星光视频时长不能为负数"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.duration"
                        },
                        "else": 5
                      }
                    },
                    5
                  ]
                },
                {
                  "$lte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.duration"
                        },
                        "else": 5
                      }
                    },
                    15
                  ]
                }
              ]
            },
            "message": "当前星光模型支持 5–15 秒"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "16:9"
                  ]
                },
                [
                  "16:9",
                  "9:16"
                ]
              ]
            },
            "message": "星光视频比例请选择 16:9 或 9:16"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$lower": {
                    "$coalesce": [
                      {
                        "$ref": "request.resolution"
                      },
                      "720p"
                    ]
                  }
                },
                "720p"
              ]
            },
            "message": "当前星光模型输出固定为 720p"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.generateAudio"
                },
                false
              ]
            },
            "message": "星光未公开生成音频开关"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.watermark"
                },
                false
              ]
            },
            "message": "星光未公开水印开关"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                9
              ]
            },
            "message": "当前星光模型最多支持 9 个参考images"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                3
              ]
            },
            "message": "当前星光模型最多支持 3 个参考videos"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "当前星光模型最多支持 3 个参考audios"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.duration"
                },
                "else": 5
              }
            },
            "ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
            },
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "720p"
                ]
              }
            },
            "images": {
              "$omitEmpty": {
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
              }
            },
            "videos": {
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
            "audios": {
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
          "path": "/v1/videos/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task_id"
              },
              {
                "$coalesce": [
                  {
                    "$ref": "response.id"
                  },
                  {
                    "$ref": "taskId"
                  }
                ]
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$lower": {
                      "$ref": "response.status"
                    }
                  },
                  "finished"
                ]
              },
              "then": "completed",
              "else": {
                "$coalesce": [
                  {
                    "$ref": "response.status"
                  },
                  "queued"
                ]
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.download_url"
              }
            ]
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "xingapi-sd25",
        "label": "星光 Seedance 2.5",
        "description": "seedance2.5 专属协议；5–30 秒，720p，参考图片/视频/音频 30/10/10。",
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
        "baseUrl": "https://xingapi.top/v1",
        "requiresPublicMediaUrls": true,
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
            "description": "当前协议对应的精确模型 ID；以当前 Key 的 /v1/models 为准。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "动作、主体和镜头描述；提示词上限沿用宿主默认 8000 字符，非上游公布值。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "5–30 秒；省略使用插件默认 5 秒，发送整数。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "16:9 或 9:16，默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "固定 720p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images[]",
            "description": "最多 30 张公网参考图，数组顺序对应 @Image1 等。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos[]",
            "description": "最多 10 条公网参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios[]",
            "description": "最多 10 条公网参考音频。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "seedance2.5"
              ]
            },
            "message": "当前星光协议仅适用于 seedance2.5"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$len": {
                    "$ref": "request.prompt"
                  }
                },
                1
              ]
            },
            "message": "星光视频提示词不能为空"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$ref": "request.duration"
                },
                0
              ]
            },
            "message": "星光视频时长不能为负数"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.duration"
                        },
                        "else": 5
                      }
                    },
                    5
                  ]
                },
                {
                  "$lte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.duration"
                        },
                        "else": 5
                      }
                    },
                    30
                  ]
                }
              ]
            },
            "message": "当前星光模型支持 5–30 秒"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "16:9"
                  ]
                },
                [
                  "16:9",
                  "9:16"
                ]
              ]
            },
            "message": "星光视频比例请选择 16:9 或 9:16"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$lower": {
                    "$coalesce": [
                      {
                        "$ref": "request.resolution"
                      },
                      "720p"
                    ]
                  }
                },
                "720p"
              ]
            },
            "message": "当前星光模型输出固定为 720p"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.generateAudio"
                },
                false
              ]
            },
            "message": "星光未公开生成音频开关"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.watermark"
                },
                false
              ]
            },
            "message": "星光未公开水印开关"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                30
              ]
            },
            "message": "当前星光模型最多支持 30 个参考images"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                10
              ]
            },
            "message": "当前星光模型最多支持 10 个参考videos"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                10
              ]
            },
            "message": "当前星光模型最多支持 10 个参考audios"
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
                              "https"
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
            "message": "星光参考素材必须使用公网 http(s) URL；本地素材由宿主转换为签名链接"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.duration"
                },
                "else": 5
              }
            },
            "ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
            },
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "720p"
                ]
              }
            },
            "images": {
              "$omitEmpty": {
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
              }
            },
            "videos": {
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
            "audios": {
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
          "path": "/v1/videos/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task_id"
              },
              {
                "$coalesce": [
                  {
                    "$ref": "response.id"
                  },
                  {
                    "$ref": "taskId"
                  }
                ]
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$lower": {
                      "$ref": "response.status"
                    }
                  },
                  "finished"
                ]
              },
              "then": "completed",
              "else": {
                "$coalesce": [
                  {
                    "$ref": "response.status"
                  },
                  "queued"
                ]
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.download_url"
              }
            ]
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
