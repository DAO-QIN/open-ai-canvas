# AutoDL ComfyUI 视频

该插件把影策统一视频请求转换为 AutoDL.Art ComfyUI 工作流参数。工作流媒体契约决定图片语义：多参考图工作流将所有已选图片（含画布历史首尾帧标记）按 `media.order` 映射为 `ref_image_N`；首尾帧工作流保留显式角色。`@图片1` 对应最终参考图顺序的 `ref_image_0`，不再因过滤角色而错位。

维护入口为 `workflow-media.json`（图片模式、图片上下限、音频上限及字段差异）和 `manifest.template.json`（工作流参数及接口定义）。新增工作流时同步这两处，执行 `python plugin-packages/autodl-comfyui/build.py` 构建确定性插件包。校验和请求映射都从同一份媒体契约生成，宿主无需新增模型 ID 判断。只有确认的必填约束才设置非零下限，当前 U24 至少一张图；其他工作流沿用可选输入。

完整接口、工作流分支和字段规则见 [docs/interface.md](docs/interface.md)。

未列出的工作流可直接填写服务商提供的模型 ID，画面规格也可输入自定义分辨率。已有工作流继续使用各自的图片与音频校验；超出数量限制时会提示调整，不会静默丢弃参考音频。
