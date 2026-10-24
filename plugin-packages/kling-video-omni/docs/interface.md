# 接口合同

- 创建：POST /v1/videos，JSON、Bearer；model 从模型配置读取。duration_seconds、resolution、aspect_ratio 从统一输出合同读取。使用文档明确继续接受的扁平字段，由服务端归一成 video.v1，不猜测全能参考 operation 值。
- 图片按角色拆成 first_frame_url/reference_images；单张空角色是首帧，多张空角色是普通参考。禁止 last_frame、mask、风格/主体等未声明的特殊角色，避免静默丢弃用途。
- 视频地址与 referenceVideoDurations 按相同 order 稳定排序；durationMs 除以 1000，保留小数，不向下取整。缺失/非正时长、总时长超过 30 秒会在创建前拒绝。
- 音频映射 reference_audios。所有媒体须为公网 HTTP(S) 引用；宿主负责上传与出站安全。
- 查询响应 GET /v1/videos/{id}；id/task_id 是同一任务。queued/in_progress/completed/failed 映射宿主状态。
- 完成优先读 outputs[0].content_url，兼容 video_url/url/result_url；相对链接不直接下载，改走鉴权 GET /v1/videos/{id}/content?download=1。临时结果立即保存，已知任务 ID 只查询和下载，不重新创建；创建超时不得自动重试计费请求。
- 签名结果链接有效期按当前文档为 30 小时；过期重新查询取得链接。宿主下载使用实际 Content-Type，不伪造格式。
- 不发送 n、Extra、未知 providerOptions、凭证或未声明的字段。没有公开取消接口，不声明取消。
- 参考视频有额外成本，插件不推断售价或汇率；管理员应确认价格规则后再开放相应能力。
- 提示词最大长度与素材文件大小没有文档硬上限；8000 字符是宿主默认值，字节上限 0 表示未单独限制，仍受宿主策略约束。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下定义与安装包一致；documentation 使用等义占位，避免递归。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "kling-video-omni",
  "name": "可灵全能视频",
  "version": "1.0.0",
  "author": "影绘",
  "description": "文本、首帧和多素材参考视频；默认 5 秒、720p、16:9，适用于相同接口与能力范围的模型。",
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
        "id": "kling-video-omni",
        "label": "可灵全能视频",
        "description": "文本、首帧和多素材参考视频；默认 5 秒、720p、16:9，适用于相同接口与能力范围的模型。",
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
            "description": "由模型配置提供，不限制模型名称；须使用相同接口和能力范围。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频描述不能为空；默认宿主上限 8000 字符，管理员可调整。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration_seconds",
            "description": "3–30 秒，默认 5 秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "16:9、9:16、1:1、21:9，默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "720p、1080p，默认 720p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "first_frame_url/reference_images",
            "description": "最多 10 张，首帧最多一张；单张空角色作为首帧，其他普通图片作为参考图。不支持尾帧。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference_videos/referenceVideoDurations",
            "description": "最多 5 段，每段 metadata.durationMs 必须为正数；按 order 保持地址和秒数一一对应，总时长最多 30 秒。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference_audios",
            "description": "最多 3 段；全部素材合计最多 15 项。"
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
            "message": "请选择视频模型"
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
            "message": "请填写视频描述"
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
            "message": "视频时长不能为负数"
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
                        "else": 5
                      }
                    },
                    30
                  ]
                }
              ]
            },
            "message": "视频时长需为 3 至 30 秒"
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
                  "21:9"
                ]
              ]
            },
            "message": "请选择支持的画面比例"
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
                  "720p",
                  "1080p"
                ]
              ]
            },
            "message": "请选择 720p 或 1080p"
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
            "message": "每次生成一个视频"
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
            "message": "当前模型不提供音轨开关"
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
            "message": "当前模型不提供水印开关"
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
                    },
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    }
                  ]
                },
                15
              ]
            },
            "message": "参考素材合计最多 15 项"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$add": [
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.videos.0.metadata.durationMs"
                        },
                        0
                      ]
                    },
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.videos.1.metadata.durationMs"
                        },
                        0
                      ]
                    },
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.videos.2.metadata.durationMs"
                        },
                        0
                      ]
                    },
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.videos.3.metadata.durationMs"
                        },
                        0
                      ]
                    },
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.videos.4.metadata.durationMs"
                        },
                        0
                      ]
                    }
                  ]
                },
                30000
              ]
            },
            "message": "参考视频总时长不能超过 30 秒"
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
            "message": "图片最多 10 张"
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
            "message": "不支持该素材用途，当前模型不支持尾帧"
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
            "message": "参考素材需使用可访问的网址"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                5
              ]
            },
            "message": "参考视频最多 5 段"
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
            "message": "不支持该素材用途，当前模型不支持尾帧"
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
            "message": "参考素材需使用可访问的网址"
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
            "message": "参考音频最多 3 段"
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
                              "reference_audio",
                              "audio_reference"
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
            "message": "不支持该素材用途，当前模型不支持尾帧"
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
            "message": "参考素材需使用可访问的网址"
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
                          "$gt": [
                            {
                              "$ref": "media.metadata.durationMs"
                            },
                            0
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "请先读取参考视频时长后再生成"
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
            "first_frame_url": {
              "$first": {
                "$map": {
                  "from": {
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
                                          ""
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
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "else": {
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
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "reference_images": {
              "$omitEmpty": {
                "$map": {
                  "from": {
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
                                          ""
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
                      "then": [],
                      "else": {
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
                                "reference_image"
                              ]
                            ]
                          }
                        }
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
            "referenceVideoDurations": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.videos"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$divide": [
                      {
                        "$ref": "media.metadata.durationMs"
                      },
                      1000
                    ]
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
