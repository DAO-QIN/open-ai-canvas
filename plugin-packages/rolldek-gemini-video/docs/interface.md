# RollDek 视频接口合同

## 请求与鉴权

- 插件 ID `rolldek-gemini-video`；两个 Provider ID 见 README。`apiKey` 为必填 secret，使用 Bearer 请求头，不写入 URL 或包内。
- 创建 `POST /v1/videos`；查询 `GET /v1/videos/{{taskId}}`；结果 `GET /v1/videos/{{taskId}}/content`。均使用 `originPath=true`，渠道已有 `/v1` 时也只从站点根路径拼接一次。
- 请求为顶层 JSON：`model`、`prompt`、整数 `duration`、`resolution`、`aspect_ratio`、`n=1`。不发送 WAN 的 `seconds`、`reference_images` 或嵌套 metadata；可选 `size` 与已发送清晰度和比例重复，故省略。
- Gemini `images`、`videos`、`audios` 是保序 HTTPS 地址数组。`first_frame` / `last_frame` 分别映射 `first_frame_url` / `last_frame_url`，不重复放入 `images`。其他明确图片参考角色映射普通参考图；未知角色拒绝，首尾帧各最多一张。
- Gemini `generateAudio` 使用驼峰字段，默认显式 false。`providerOptions.rolldek-gemini-omni-video.preprocess` 和 `.seed` 可选；false 和 0 保留，未设置时省略。参考 `audios` 与生成音频开关独立。
- Veo Fast 不发送参考输入、音轨开关、水印或未知字段；拒绝 Lite 及其他模型 ID。只开放文档所证实的 8 秒/720p/16:9。
- 普通参考图上限为能力配置 `video.references.maxReferenceImages`，图片总数为 `maxImages`，视频/音频上限分别为 `maxVideos` / `maxAudios`，宿主生成前校验。管理员可调整平台数量；插件不把未知供应商极限写死为该默认值。

## 响应、查询与下载

- 创建返回 `id`；`queued` 为排队，`in_progress` 为生成中，`completed` 为完成，`failed` 为失败。缺失或未知状态、error 对象、非成功业务 code 均保持失败语义。
- 仅 `completed` 时读取 `metadata.url`，兼容文档声明的 `url`、`video_url`。提前返回 URL 不得把排队响应视为成功。URL 标记 ephemeral，由宿主及时下载保存；没有有效 HTTPS URL 时使用带 Bearer 的 `/content` 结果端点。
- HTTP 错误、`error.code` / `error.message` 向上返回真实失败。失败停止轮询，取消接口未公布，不虚构取消端点。
- 创建只提交一次。查询超时或服务恢复时继续同一个任务 ID，不重新发起付费创建；真实验证按文档建议每 15 秒查询。

## 参数逐字段定义

### rolldek-gemini-omni-video

| 统一字段 | 类型 | 上游字段 | 说明 |
| --- | --- | --- | --- |
| `model` | string | `model` | 精确模型 ID：gemini-omni-1.1-flash |
| `prompt` | string | `prompt` | 非空提示词；宿主默认 8000 字符，不代表供应商上限。 |
| `duration` | integer | `duration` | 整数秒，开放 4/6/8/10，默认 4。 |
| `resolution` | string | `resolution` | 默认及当前开放 720p。 |
| `aspectRatio` | string | `aspect_ratio` | 开放 16:9/9:16，默认 16:9。 |
| `imageCount` | integer | `n` | 固定单条输出，n=1。 |
| `images` | media[] | `images/first_frame_url/last_frame_url` | 普通图片保序，首尾帧使用独立字段，不在 images 中重复。数量取后台能力配置。 |
| `videos` | media[] | `videos` | HTTPS 视频地址数组；默认最多一项，后台可调整。 |
| `audios` | media[] | `audios` | HTTPS 音频地址数组；默认最多一项，后台可调整。 |
| `generateAudio` | boolean | `generateAudio` | 生成音频开关，默认 false；与输入参考音频 audios 分开。 |
| `providerOptions.rolldek-gemini-omni-video.preprocess` | boolean | `preprocess` | 可选人脸预处理开关，显式 false 保留。 |
| `providerOptions.rolldek-gemini-omni-video.seed` | integer | `seed` | 可选随机种子，显式 0 保留。 |

### rolldek-veo-fast-video

| 统一字段 | 类型 | 上游字段 | 说明 |
| --- | --- | --- | --- |
| `model` | string | `model` | 精确模型 ID：veo-3.1-fast |
| `prompt` | string | `prompt` | 非空提示词；宿主默认 8000 字符，不代表供应商上限。 |
| `duration` | integer | `duration` | 整数秒，开放 8，默认 8。 |
| `resolution` | string | `resolution` | 默认及当前开放 720p。 |
| `aspectRatio` | string | `aspect_ratio` | 开放 16:9，默认 16:9。 |
| `imageCount` | integer | `n` | 固定单条输出，n=1。 |

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "rolldek-gemini-video",
  "name": "RollDek Gemini Omni 与 Veo Fast 视频",
  "version": "1.0.0",
  "author": "RollDek / 影策",
  "description": "独立适配 RollDek Gemini Omni 1.1 Flash 与 Veo 3.1 Fast 原生异步视频接口。",
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
        "id": "rolldek-gemini-omni-video",
        "label": "RollDek Gemini Omni 1.1 Flash",
        "description": "原生异步 JSON；默认 4秒/720p/16:9，支持首尾帧及图/视/音参考。",
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
        "baseUrl": "https://rolldek.com",
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
            "description": "精确模型 ID：gemini-omni-1.1-flash"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "非空提示词；宿主默认 8000 字符，不代表供应商上限。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "整数秒，开放 4/6/8/10，默认 4。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "默认及当前开放 720p。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "开放 16:9/9:16，默认 16:9。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "固定单条输出，n=1。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images/first_frame_url/last_frame_url",
            "description": "普通图片保序，首尾帧使用独立字段，不在 images 中重复。数量取后台能力配置。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos",
            "description": "HTTPS 视频地址数组；默认最多一项，后台可调整。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios",
            "description": "HTTPS 音频地址数组；默认最多一项，后台可调整。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "generateAudio",
            "description": "生成音频开关，默认 false；与输入参考音频 audios 分开。"
          },
          {
            "name": "providerOptions.rolldek-gemini-omni-video.preprocess",
            "type": "boolean",
            "required": false,
            "mapping": "preprocess",
            "description": "可选人脸预处理开关，显式 false 保留。"
          },
          {
            "name": "providerOptions.rolldek-gemini-omni-video.seed",
            "type": "integer",
            "required": false,
            "mapping": "seed",
            "description": "可选随机种子，显式 0 保留。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "gemini-omni-1.1-flash"
              ]
            },
            "message": "当前 RollDek 协议仅适用于 gemini-omni-1.1-flash"
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
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.output.duration"
                    },
                    4
                  ]
                },
                [
                  4,
                  6,
                  8,
                  10
                ]
              ]
            },
            "message": "当前 RollDek 协议开放时长：4/6/8/10 秒"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.output.aspectRatio"
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
            "message": "当前 RollDek 协议不支持所选比例"
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
            "message": "当前 RollDek 协议开放 720p"
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
            "message": "每次任务只生成一个视频"
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
            "message": "RollDek 未公布可控水印参数"
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
                              "first_frame",
                              "last_frame",
                              "style_reference",
                              "subject_reference",
                              "element_reference"
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
            "message": "当前 RollDek 协议不支持该素材角色"
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
            "message": "RollDek 参考素材需要可公开下载的 HTTPS 地址"
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
            "message": "当前 RollDek 协议不支持该素材角色"
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
            "message": "RollDek 参考素材需要可公开下载的 HTTPS 地址"
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
            "message": "当前 RollDek 协议不支持该素材角色"
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
            "message": "RollDek 参考素材需要可公开下载的 HTTPS 地址"
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
                4
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
            "n": 1,
            "images": {
              "$omitEmpty": {
                "$map": {
                  "from": {
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
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "first_frame_url": {
              "$first": {
                "$map": {
                  "from": {
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
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "last_frame_url": {
              "$first": {
                "$map": {
                  "from": {
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
            },
            "generateAudio": {
              "$coalesce": [
                {
                  "$ref": "request.output.generateAudio"
                },
                false
              ]
            },
            "preprocess": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.rolldek-gemini-omni-video.preprocess"
              }
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.rolldek-gemini-omni-video.seed"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "originPath": true
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "originPath": true,
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
                "$ref": "response.message"
              },
              "RollDek 未返回有效任务状态"
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
                    "$eq": [
                      {
                        "$first": {
                          "$split": [
                            {
                              "$coalesce": [
                                {
                                  "$ref": "response.metadata.url"
                                },
                                {
                                  "$ref": "response.url"
                                },
                                {
                                  "$ref": "response.video_url"
                                }
                              ]
                            },
                            ":"
                          ]
                        }
                      },
                      "https"
                    ]
                  }
                ]
              },
              "then": {
                "$coalesce": [
                  {
                    "$ref": "response.metadata.url"
                  },
                  {
                    "$ref": "response.url"
                  },
                  {
                    "$ref": "response.video_url"
                  }
                ]
              },
              "else": null
            }
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "rolldek-veo-fast-video",
        "label": "RollDek Veo 3.1 Fast",
        "description": "原生异步 JSON；仅开放公开示例 8秒/720p/16:9 文生视频，不适用于 Lite。",
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
        "baseUrl": "https://rolldek.com",
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
            "description": "精确模型 ID：veo-3.1-fast"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "非空提示词；宿主默认 8000 字符，不代表供应商上限。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "整数秒，开放 8，默认 8。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "默认及当前开放 720p。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "开放 16:9，默认 16:9。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "固定单条输出，n=1。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "veo-3.1-fast"
              ]
            },
            "message": "当前 RollDek 协议仅适用于 veo-3.1-fast"
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
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.output.duration"
                    },
                    8
                  ]
                },
                [
                  8
                ]
              ]
            },
            "message": "当前 RollDek 协议开放时长：8 秒"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.output.aspectRatio"
                    },
                    "16:9"
                  ]
                },
                [
                  "16:9"
                ]
              ]
            },
            "message": "当前 RollDek 协议不支持所选比例"
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
            "message": "当前 RollDek 协议开放 720p"
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
            "message": "每次任务只生成一个视频"
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
            "message": "RollDek 未公布可控水印参数"
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
            "message": "Veo Fast 当前仅开放已公布的文生视频规格"
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
            "message": "Veo Fast 当前仅开放已公布的文生视频规格"
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
            "message": "Veo Fast 当前仅开放已公布的文生视频规格"
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
            "message": "Veo Fast 当前文档未声明音轨控制参数"
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
            "n": 1
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "originPath": true
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "originPath": true,
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
                "$ref": "response.message"
              },
              "RollDek 未返回有效任务状态"
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
                    "$eq": [
                      {
                        "$first": {
                          "$split": [
                            {
                              "$coalesce": [
                                {
                                  "$ref": "response.metadata.url"
                                },
                                {
                                  "$ref": "response.url"
                                },
                                {
                                  "$ref": "response.video_url"
                                }
                              ]
                            },
                            ":"
                          ]
                        }
                      },
                      "https"
                    ]
                  }
                ]
              },
              "then": {
                "$coalesce": [
                  {
                    "$ref": "response.metadata.url"
                  },
                  {
                    "$ref": "response.url"
                  },
                  {
                    "$ref": "response.video_url"
                  }
                ]
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
