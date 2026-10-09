# YuxiBox SD 视频接口

## 协议和默认能力

| 协议 | 官方模型 ID | 时长 / 默认 | 参考图片 / 视频 / 音频 |
| --- | --- | --- | --- |
| yuxibox-sd20 | seedance-2.0（YX） | 5、10、15秒 / 15秒 | 9 / 3 / 3 |
| yuxibox-sd25 | seedance-2.5（YX） | 4–30秒，步长1 / 30秒 | 30 / 10 / 10 |
| yuxibox-sd25-per-request | seedance-2.5（YX）-按次 | 4–30秒，步长1 / 30秒 | 30 / 10 / 10 |

模型 ID 保留全角括号，不自行转成其他模型别名。提示词 1–16000 字符；比例支持 `adaptive,16:9,9:16,1:1,4:3,3:4,21:9`，默认 `16:9`；分辨率固定 `720p`。支持文生、图生、混合参考及音频参考输入。生成音频和水印开关未公开，不显示也不发送；音轨有无由上游决定。

官方仅公布 multipart 单图上传 20 MiB；本插件使用 JSON URL 数组，因此不把该上传限制套到所有参考 URL。未公布的 URL 素材字节和时长限制配置为 0（不增加供应商限制），宿主上传和出站校验仍执行。参考数量是网关上限，具体类型仍受模型权限限制。

## 请求映射

Bearer 鉴权。`POST /v1/videos` 发送 JSON 顶层字段：`model`、`prompt`、`seconds`（由统一 duration 转字符串）、`ratio`（由 aspectRatio 映射）。使用 ratio 时省略 size，不发送未公开的 resolution、face_split、videoGenerateAudio、任意 extra JSON 或宿主元数据。

图片映射为 `reference_images:[url]`，视频为 `videos:[url]`，音频为 `audios:[url]`，各自按宿主引用顺序发送；空数组省略。宿主转换已授权素材为公网签名 URL，插件仅做声明式转换。全部图片作为顺序参考图，不宣称首尾帧角色。

无 duration 时采用协议默认值，显式负值拒绝；协议运行时在提交前校验模型匹配、提示词长度、时长、比例、分辨率和素材数量。能力默认配置由前后端共同填入，价格和启用状态由管理员明确配置，不从协议自动推导积分售价。

## 任务与结果

创建响应读取 `id`；`GET /v1/videos/{id}` 查询状态 `queued/in_progress/completed/failed`。错误读取 `error.message`、`error.code`；完成结果读取 `video_url` 或 `download_url`。声明鉴权下载 `GET /v1/videos/{id}/content`，宿主下载转存后再将媒体返回画布。结果标记为 ephemeral，避免依赖上游永久保留。

没有公开取消接口，不声明 DELETE。轮询失败或超时时保存任务 ID 并继续 GET 查询，不重复 POST 付费生成；恢复、转存、SSRF、并发和权限沿用宿主运行时。

## 构建

`node plugin-packages/generate-yuxibox-sd-video.mjs` 生成清单；`node plugin-packages/embed-documentation.mjs yuxibox-sd-video` 嵌入完整文档；使用项目 package-selected.ps1 或 build-packages.sh 生成根目录含 manifest.json 的 `.yingce-plugin` ZIP 包。插件不带可执行代码，权限仅为 generation.run 与 media.read。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "yuxibox-sd-video",
  "name": "YuxiBox SD 视频",
  "version": "1.0.0",
  "author": "YuxiBox / 影策",
  "description": "YuxiBox Seedance 2.0、2.5 按秒及按次的声明式视频协议。",
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
        "id": "yuxibox-sd20",
        "label": "YuxiBox Seedance 2.0（按秒）",
        "description": "seedance-2.0（YX） 专属协议；POST /v1/videos，GET /v1/videos/{id}，GET /v1/videos/{id}/content。",
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
        "baseUrl": "https://yuxibox.cn",
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
            "description": "当前协议对应的官方模型 ID，保留全角括号。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "1–16000 字符。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds",
            "description": "2.0 支持 5/10/15 秒，默认 15；2.5 支持 4–30 秒，默认 30。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "默认 16:9；使用 ratio 时不发送 size。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "fixed 720P",
            "description": "固定 720P，只校验，不发送未公开的分辨率字段。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images[]",
            "description": "按素材顺序发送图片 URL，不发送未经声明的 role。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos[]",
            "description": "按素材顺序发送参考视频 URL。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios[]",
            "description": "按素材顺序发送参考音频 URL。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "seedance-2.0（YX）"
              ]
            },
            "message": "当前 YuxiBox 协议只适用于 seedance-2.0（YX）"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    1
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    16000
                  ]
                }
              ]
            },
            "message": "YuxiBox 视频提示词须为 1–16000 字符"
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
            "message": "YuxiBox 视频时长不能为负数"
          },
          {
            "assert": {
              "$in": [
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
                    "else": 15
                  }
                },
                [
                  5,
                  10,
                  15
                ]
              ]
            },
            "message": "YuxiBox seedance-2.0（YX） 视频时长超出支持范围"
          },
          {
            "assert": {
              "$in": [
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
                [
                  "720p"
                ]
              ]
            },
            "message": "YuxiBox 输出固定为 720P"
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
                  "adaptive",
                  "16:9",
                  "9:16",
                  "1:1",
                  "4:3",
                  "3:4",
                  "21:9"
                ]
              ]
            },
            "message": "YuxiBox 不支持当前画面比例"
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
            "message": "YuxiBox seedance-2.0（YX） 参考图片超出上限"
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
            "message": "YuxiBox seedance-2.0（YX） 参考视频超出上限"
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
            "message": "YuxiBox seedance-2.0（YX） 参考音频超出上限"
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
            "message": "YuxiBox 未公开生成音频开关"
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
            "message": "YuxiBox 未公开水印开关"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "seconds": {
              "$toString": {
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
                  "else": 15
                }
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
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              "queued"
            ]
          },
          "message": {
            "$ref": "response.error.message"
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
        "id": "yuxibox-sd25",
        "label": "YuxiBox Seedance 2.5（按秒）",
        "description": "seedance-2.5（YX） 专属协议；POST /v1/videos，GET /v1/videos/{id}，GET /v1/videos/{id}/content。",
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
        "baseUrl": "https://yuxibox.cn",
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
            "description": "当前协议对应的官方模型 ID，保留全角括号。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "1–16000 字符。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds",
            "description": "2.0 支持 5/10/15 秒，默认 15；2.5 支持 4–30 秒，默认 30。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "默认 16:9；使用 ratio 时不发送 size。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "fixed 720P",
            "description": "固定 720P，只校验，不发送未公开的分辨率字段。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images[]",
            "description": "按素材顺序发送图片 URL，不发送未经声明的 role。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos[]",
            "description": "按素材顺序发送参考视频 URL。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios[]",
            "description": "按素材顺序发送参考音频 URL。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "seedance-2.5（YX）"
              ]
            },
            "message": "当前 YuxiBox 协议只适用于 seedance-2.5（YX）"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    1
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    16000
                  ]
                }
              ]
            },
            "message": "YuxiBox 视频提示词须为 1–16000 字符"
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
            "message": "YuxiBox 视频时长不能为负数"
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
                        "else": 30
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
                        "else": 30
                      }
                    },
                    30
                  ]
                }
              ]
            },
            "message": "YuxiBox seedance-2.5（YX） 视频时长超出支持范围"
          },
          {
            "assert": {
              "$in": [
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
                [
                  "720p"
                ]
              ]
            },
            "message": "YuxiBox 输出固定为 720P"
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
                  "adaptive",
                  "16:9",
                  "9:16",
                  "1:1",
                  "4:3",
                  "3:4",
                  "21:9"
                ]
              ]
            },
            "message": "YuxiBox 不支持当前画面比例"
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
            "message": "YuxiBox seedance-2.5（YX） 参考图片超出上限"
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
            "message": "YuxiBox seedance-2.5（YX） 参考视频超出上限"
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
            "message": "YuxiBox seedance-2.5（YX） 参考音频超出上限"
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
            "message": "YuxiBox 未公开生成音频开关"
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
            "message": "YuxiBox 未公开水印开关"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "seconds": {
              "$toString": {
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
                  "else": 30
                }
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
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              "queued"
            ]
          },
          "message": {
            "$ref": "response.error.message"
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
        "id": "yuxibox-sd25-per-request",
        "label": "YuxiBox Seedance 2.5（按次）",
        "description": "seedance-2.5（YX）-按次 专属协议；POST /v1/videos，GET /v1/videos/{id}，GET /v1/videos/{id}/content。",
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
        "baseUrl": "https://yuxibox.cn",
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
            "description": "当前协议对应的官方模型 ID，保留全角括号。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "1–16000 字符。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds",
            "description": "2.0 支持 5/10/15 秒，默认 15；2.5 支持 4–30 秒，默认 30。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "默认 16:9；使用 ratio 时不发送 size。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "fixed 720P",
            "description": "固定 720P，只校验，不发送未公开的分辨率字段。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images[]",
            "description": "按素材顺序发送图片 URL，不发送未经声明的 role。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos[]",
            "description": "按素材顺序发送参考视频 URL。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios[]",
            "description": "按素材顺序发送参考音频 URL。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "seedance-2.5（YX）-按次"
              ]
            },
            "message": "当前 YuxiBox 协议只适用于 seedance-2.5（YX）-按次"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    1
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    16000
                  ]
                }
              ]
            },
            "message": "YuxiBox 视频提示词须为 1–16000 字符"
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
            "message": "YuxiBox 视频时长不能为负数"
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
                        "else": 30
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
                        "else": 30
                      }
                    },
                    30
                  ]
                }
              ]
            },
            "message": "YuxiBox seedance-2.5（YX）-按次 视频时长超出支持范围"
          },
          {
            "assert": {
              "$in": [
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
                [
                  "720p"
                ]
              ]
            },
            "message": "YuxiBox 输出固定为 720P"
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
                  "adaptive",
                  "16:9",
                  "9:16",
                  "1:1",
                  "4:3",
                  "3:4",
                  "21:9"
                ]
              ]
            },
            "message": "YuxiBox 不支持当前画面比例"
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
            "message": "YuxiBox seedance-2.5（YX）-按次 参考图片超出上限"
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
            "message": "YuxiBox seedance-2.5（YX）-按次 参考视频超出上限"
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
            "message": "YuxiBox seedance-2.5（YX）-按次 参考音频超出上限"
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
            "message": "YuxiBox 未公开生成音频开关"
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
            "message": "YuxiBox 未公开水印开关"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "seconds": {
              "$toString": {
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
                  "else": 30
                }
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
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              "queued"
            ]
          },
          "message": {
            "$ref": "response.error.message"
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
