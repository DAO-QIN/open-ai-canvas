# 沧元 Midjourney

独立声明式协议插件（`yingce.plugin/v2`），提供普通线路和 1K/2K 线路。使用宿主的渠道鉴权、出站安全检查、下载和资源持久化，不执行额外服务代码。

普通线路使用 `midjourney`，无分辨率和速度档，通过互斥的 `mj_version` / `niji_version` 选择版本，都不传时上游默认 8.2。Provider ID `cangyuan-midjourney-v7` 是现有绑定的稳定标识，不表示固定 V7。旧上游名 `midjourney-v7` 已不在供应商模型清单中。1K/2K 仍使用 `midjourney-1k` / `midjourney-2k`，不存在独立的 `midjourney-v8.2` 模型名。

两条线路不能互换。异步创建后沿同一任务轮询；`n=1` 表示一次请求，返回的所有图片均交给宿主保存。普通线路最多五张参考图；1K/2K 最多四张，editor 只允许一张源图。供应商 CDN 下载失败时保留真实错误和原任务，不自动换模型或重新收费提交。

完整接口见 [docs/interface.md](docs/interface.md)。
