# 卡藏视频接口合同

- Base URL：`https://newapi.prompt-hubs.com/v1`；宿主去重路径中的 `/v1`。
- 创建：`POST /v1/videos`，JSON 和 Bearer 鉴权；字段 `model`、`prompt`、`duration_seconds`、`aspect_ratio`、`resolution`、`n=1`。
- 参考素材使用供应商明确保留的扁平 JSON 字段，供应商在请求边界归一为 `video.v1`。本插件不发送未确认的 operation 别名。
- Gemini：`first_frame`、`reference_image` 或空角色映射 `images`（最多 1）；`style_reference` 映射 `style_references`（最多 4）；`subject_reference/element_reference` 映射 `element_references`（最多 3）；源视频映射 `input_video`（最多 1）；合计最多 4 项。
- Grok：单个 `first_frame` 或空角色映射 `image`；其他普通参考映射 `images`（最多 14），首帧不能与参考数组混用。素材需要公网 HTTP(S) URL。多图参考最高 720p，上游将 1080p 自动降为 720p；这里保留已请求档位，不伪称实际成片为 1080p。
- 可灵：仅一个 `first_frame` 或空角色映射 `first_frame_url`。可选反向提示词仅从 `providerOptions.kacang-kling-video-30.negativePrompt` 映射；故事板 `multi_prompt` 未公开分段元素的完整合同，暂不声明支持。
- 三类均拒绝尾帧、超额引用及未支持的音视频。Gemini/可灵文档接受内联数据，但系统路径仍由宿主将媒体转换成受控公网引用。风格/元素的精细角色由统一请求合同提供，当前画布只提供普通首帧/参考图选择。
- 查询：`GET /v1/videos/{id}`；响应读取 `id`（或 `task_id`）、`queued/in_progress/completed/failed`、`error.code/error.message`。
- 优先读取 `outputs[0].content_url`，兼容文档中的 `video_url/url/result_url`，标记临时结果并立即下载。创建即完成但仅返回相对内容地址时，使用独立鉴权结果端点 `GET /v1/videos/{id}/content?download=1`，不会把相对地址送给公网下载器。
- 内容端点实际 Content-Type 是媒体类型真相，不能把兼容 mime_type 当作必然 MP4。签名链接约一小时有效；已知 taskId 只查询/下载，不重新创建。未公开取消端点，不声明 DELETE。
- 请求只取声明字段，不透传 Extra、凭证或未知 Provider Options。插件包和源码不含渠道密钥。

模型文档：[Gemini](https://console.prompt-hubs.com/docs/model/gemini-omni-flash-1.1)、[Grok](https://console.prompt-hubs.com/docs/model/grok-imagine-video-1.5)、[可灵](https://console.prompt-hubs.com/docs/model/%E5%8F%AF%E7%81%B53.0-%E7%89%B9%E6%83%A0)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与包内 Manifest 逐字段一致；documentation 以等义占位避免递归。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "kacang-video",
  "name": "卡藏视频",
  "version": "1.0.0",
  "author": "卡藏 API / 影策",
  "description": "适配卡藏 Gemini Omni Flash 1.1、Grok Imagine Video 1.5 和可灵 3.0 特惠，按公开合同提交、查询和下载。",
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
        "id": "kacang-gemini-omni-video",
        "label": "卡藏 Gemini Omni Flash 1.1",
        "description": "gemini-omni-flash-1.1 专用 JSON 视频协议；默认 3 秒、720p、16:9。",
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
        "baseUrl": "https://newapi.prompt-hubs.com/v1",
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
            "description": "精确 API 模型 ID：gemini-omni-flash-1.1"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "主体、动作和镜头描述；上游未公布最大字符数，宿主默认 8000。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration_seconds",
            "description": "3–10 秒，默认 3 秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "支持 16:9、9:16，默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "支持 720p，默认 720p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images/image/first_frame_url/style_references/element_references",
            "description": "按明确素材角色映射，保持同类素材顺序；不支持尾帧。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "input_video",
            "description": "源视频最多一个，与图片合计最多四项。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "gemini-omni-flash-1.1"
              ]
            },
            "message": "当前卡藏协议仅适用于 gemini-omni-flash-1.1"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$len": {
                    "$trim": {
                      "$ref": "request.prompt"
                    }
                  }
                },
                1
              ]
            },
            "message": "卡藏视频提示词不能为空"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$ref": "request.output.duration"
                },
                0
              ]
            },
            "message": "卡藏视频时长不能为负数"
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
                              "$ref": "request.output.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.output.duration"
                        },
                        "else": 3
                      }
                    },
                    3
                  ]
                },
                {
                  "$lte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.output.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.output.duration"
                        },
                        "else": 3
                      }
                    },
                    10
                  ]
                }
              ]
            },
            "message": "当前卡藏模型支持 3–10 秒"
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
            "message": "当前卡藏模型不支持所选比例"
          },
          {
            "assert": {
              "$in": [
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
                [
                  "720p"
                ]
              ]
            },
            "message": "当前卡藏模型不支持所选分辨率"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$ref": "request.output.count"
                },
                1
              ]
            },
            "message": "卡藏每次任务只返回一个视频"
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
            "message": "当前卡藏文档未声明可控音轨开关"
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
            "message": "当前卡藏文档未声明可控水印开关"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                4
              ]
            },
            "message": "当前卡藏模型最多支持 4 项 images"
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
                              "first_frame",
                              "reference_image",
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
            "message": "当前卡藏模型不支持该素材角色（包括尾帧）"
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
            "message": "卡藏素材地址格式不符合该模型合同"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                1
              ]
            },
            "message": "当前卡藏模型最多支持 1 项 videos"
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
                              "source_video",
                              "reference_video"
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
            "message": "当前卡藏模型不支持该素材角色（包括尾帧）"
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
            "message": "卡藏素材地址格式不符合该模型合同"
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
            "message": "当前卡藏模型最多支持 0 项 audios"
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
                            []
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "当前卡藏模型不支持该素材角色（包括尾帧）"
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
            "message": "卡藏素材地址格式不符合该模型合同"
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
                            "",
                            "first_frame",
                            "reference_image"
                          ]
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "Gemini Omni 普通帧参考最多一张"
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
                            "style_reference"
                          ]
                        ]
                      }
                    }
                  }
                },
                4
              ]
            },
            "message": "Gemini Omni 风格参考最多四张"
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
                            "subject_reference",
                            "element_reference"
                          ]
                        ]
                      }
                    }
                  }
                },
                3
              ]
            },
            "message": "Gemini Omni 元素参考最多三张"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$add": [
                    {
                      "$len": {
                        "$ref": "request.images"
                      }
                    },
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    }
                  ]
                },
                4
              ]
            },
            "message": "Gemini Omni 全部参考素材合计最多四项"
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
            "duration_seconds": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.output.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.output.duration"
                },
                "else": 3
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
                            "first_frame",
                            "reference_image"
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
            "style_references": {
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
                            "style_reference"
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
            "element_references": {
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
            "input_video": {
              "$first": {
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
          "query": {
            "download": "1"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.task_id"
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
            "$if": {
              "condition": {
                "$in": [
                  {
                    "$first": {
                      "$split": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "response.outputs.0.content_url"
                            },
                            {
                              "$ref": "response.video_url"
                            },
                            {
                              "$ref": "response.url"
                            },
                            {
                              "$ref": "response.result_url"
                            }
                          ]
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
              },
              "then": {
                "$coalesce": [
                  {
                    "$ref": "response.outputs.0.content_url"
                  },
                  {
                    "$ref": "response.video_url"
                  },
                  {
                    "$ref": "response.url"
                  },
                  {
                    "$ref": "response.result_url"
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
        "id": "kacang-grok-video-15",
        "label": "卡藏 Grok Imagine Video 1.5",
        "description": "grok-imagine-video-1.5 专用 JSON 视频协议；默认 8 秒、480p、16:9。",
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
        "baseUrl": "https://newapi.prompt-hubs.com/v1",
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
            "description": "精确 API 模型 ID：grok-imagine-video-1.5"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "主体、动作和镜头描述；上游未公布最大字符数，宿主默认 8000。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration_seconds",
            "description": "4–15 秒，默认 8 秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "支持 16:9、9:16、1:1、4:3、3:4、3:2、2:3，默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "支持 480p、720p、1080p，默认 480p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images/image/first_frame_url/style_references/element_references",
            "description": "按明确素材角色映射，保持同类素材顺序；不支持尾帧。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "grok-imagine-video-1.5"
              ]
            },
            "message": "当前卡藏协议仅适用于 grok-imagine-video-1.5"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$len": {
                    "$trim": {
                      "$ref": "request.prompt"
                    }
                  }
                },
                1
              ]
            },
            "message": "卡藏视频提示词不能为空"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$ref": "request.output.duration"
                },
                0
              ]
            },
            "message": "卡藏视频时长不能为负数"
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
                              "$ref": "request.output.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.output.duration"
                        },
                        "else": 8
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
                              "$ref": "request.output.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.output.duration"
                        },
                        "else": 8
                      }
                    },
                    15
                  ]
                }
              ]
            },
            "message": "当前卡藏模型支持 4–15 秒"
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
                  "9:16",
                  "1:1",
                  "4:3",
                  "3:4",
                  "3:2",
                  "2:3"
                ]
              ]
            },
            "message": "当前卡藏模型不支持所选比例"
          },
          {
            "assert": {
              "$in": [
                {
                  "$lower": {
                    "$coalesce": [
                      {
                        "$ref": "request.output.resolution"
                      },
                      "480p"
                    ]
                  }
                },
                [
                  "480p",
                  "720p",
                  "1080p"
                ]
              ]
            },
            "message": "当前卡藏模型不支持所选分辨率"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$ref": "request.output.count"
                },
                1
              ]
            },
            "message": "卡藏每次任务只返回一个视频"
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
            "message": "当前卡藏文档未声明可控音轨开关"
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
            "message": "当前卡藏文档未声明可控水印开关"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                14
              ]
            },
            "message": "当前卡藏模型最多支持 14 项 images"
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
                              "first_frame",
                              "reference_image"
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
            "message": "当前卡藏模型不支持该素材角色（包括尾帧）"
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
            "message": "卡藏素材地址格式不符合该模型合同"
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
            "message": "当前卡藏模型最多支持 0 项 videos"
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
                            []
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "当前卡藏模型不支持该素材角色（包括尾帧）"
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
            "message": "卡藏素材地址格式不符合该模型合同"
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
            "message": "当前卡藏模型最多支持 0 项 audios"
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
                            []
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "当前卡藏模型不支持该素材角色（包括尾帧）"
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
            "message": "卡藏素材地址格式不符合该模型合同"
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
                                "first_frame"
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
                        "$ref": "request.images"
                      }
                    },
                    1
                  ]
                }
              ]
            },
            "message": "Grok 首帧与多张参考图不能混用"
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
            "duration_seconds": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.output.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.output.duration"
                },
                "else": 8
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
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.output.resolution"
                  },
                  "480p"
                ]
              }
            },
            "n": 1,
            "image": {
              "$if": {
                "condition": {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        1
                      ]
                    },
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
                                    "first_frame"
                                  ]
                                ]
                              }
                            }
                          }
                        },
                        1
                      ]
                    }
                  ]
                },
                "then": {
                  "$first": {
                    "$map": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  }
                },
                "else": null
              }
            },
            "images": {
              "$if": {
                "condition": {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        1
                      ]
                    },
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
                                    "first_frame"
                                  ]
                                ]
                              }
                            }
                          }
                        },
                        1
                      ]
                    }
                  ]
                },
                "then": null,
                "else": {
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
          "query": {
            "download": "1"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.task_id"
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
            "$if": {
              "condition": {
                "$in": [
                  {
                    "$first": {
                      "$split": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "response.outputs.0.content_url"
                            },
                            {
                              "$ref": "response.video_url"
                            },
                            {
                              "$ref": "response.url"
                            },
                            {
                              "$ref": "response.result_url"
                            }
                          ]
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
              },
              "then": {
                "$coalesce": [
                  {
                    "$ref": "response.outputs.0.content_url"
                  },
                  {
                    "$ref": "response.video_url"
                  },
                  {
                    "$ref": "response.url"
                  },
                  {
                    "$ref": "response.result_url"
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
        "id": "kacang-kling-video-30",
        "label": "卡藏 可灵 3.0 特惠",
        "description": "可灵3.0-特惠 专用 JSON 视频协议；默认 5 秒、720p、16:9。",
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
        "baseUrl": "https://newapi.prompt-hubs.com/v1",
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
            "description": "精确 API 模型 ID：可灵3.0-特惠"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "主体、动作和镜头描述；上游未公布最大字符数，宿主默认 8000。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration_seconds",
            "description": "1–15 秒，默认 5 秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "支持 16:9、9:16，默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "支持 720p，默认 720p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images/image/first_frame_url/style_references/element_references",
            "description": "按明确素材角色映射，保持同类素材顺序；不支持尾帧。"
          },
          {
            "name": "providerOptions.kacang-kling-video-30.negativePrompt",
            "type": "string",
            "required": false,
            "mapping": "negative_prompt",
            "description": "可选反向提示词，省略不发送。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "可灵3.0-特惠"
              ]
            },
            "message": "当前卡藏协议仅适用于 可灵3.0-特惠"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$len": {
                    "$trim": {
                      "$ref": "request.prompt"
                    }
                  }
                },
                1
              ]
            },
            "message": "卡藏视频提示词不能为空"
          },
          {
            "assert": {
              "$gte": [
                {
                  "$ref": "request.output.duration"
                },
                0
              ]
            },
            "message": "卡藏视频时长不能为负数"
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
                              "$ref": "request.output.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.output.duration"
                        },
                        "else": 5
                      }
                    },
                    1
                  ]
                },
                {
                  "$lte": [
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$ref": "request.output.duration"
                            },
                            0
                          ]
                        },
                        "then": {
                          "$ref": "request.output.duration"
                        },
                        "else": 5
                      }
                    },
                    15
                  ]
                }
              ]
            },
            "message": "当前卡藏模型支持 1–15 秒"
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
            "message": "当前卡藏模型不支持所选比例"
          },
          {
            "assert": {
              "$in": [
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
                [
                  "720p"
                ]
              ]
            },
            "message": "当前卡藏模型不支持所选分辨率"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$ref": "request.output.count"
                },
                1
              ]
            },
            "message": "卡藏每次任务只返回一个视频"
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
            "message": "当前卡藏文档未声明可控音轨开关"
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
            "message": "当前卡藏文档未声明可控水印开关"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                1
              ]
            },
            "message": "当前卡藏模型最多支持 1 项 images"
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
                              "first_frame"
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
            "message": "当前卡藏模型不支持该素材角色（包括尾帧）"
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
            "message": "卡藏素材地址格式不符合该模型合同"
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
            "message": "当前卡藏模型最多支持 0 项 videos"
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
                            []
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "当前卡藏模型不支持该素材角色（包括尾帧）"
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
            "message": "卡藏素材地址格式不符合该模型合同"
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
            "message": "当前卡藏模型最多支持 0 项 audios"
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
                            []
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "当前卡藏模型不支持该素材角色（包括尾帧）"
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
            "message": "卡藏素材地址格式不符合该模型合同"
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
            "duration_seconds": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.output.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.output.duration"
                },
                "else": 5
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
            "n": 1,
            "first_frame_url": {
              "$first": {
                "$map": {
                  "from": {
                    "$ref": "request.images"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "negative_prompt": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.kacang-kling-video-30.negativePrompt"
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
          "query": {
            "download": "1"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.task_id"
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
            "$if": {
              "condition": {
                "$in": [
                  {
                    "$first": {
                      "$split": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "response.outputs.0.content_url"
                            },
                            {
                              "$ref": "response.video_url"
                            },
                            {
                              "$ref": "response.url"
                            },
                            {
                              "$ref": "response.result_url"
                            }
                          ]
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
              },
              "then": {
                "$coalesce": [
                  {
                    "$ref": "response.outputs.0.content_url"
                  },
                  {
                    "$ref": "response.video_url"
                  },
                  {
                    "$ref": "response.url"
                  },
                  {
                    "$ref": "response.result_url"
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
