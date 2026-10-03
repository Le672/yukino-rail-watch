# Android / iOS 1.0.1 Preview

- 改用 12306 官方停站表、站序、到发时间、跨日资料和正晚点；暂无官方报告时按官方计划时刻估算。
- RailGo 仅补充车型、配属及铁路坐标，停止整段车次、时刻表和正晚点查询；同车次车型请求合并并缓存 12 小时。
- 官方结果先显示，车型随后补充，不阻塞查询与通知。保留独立手机布局、原生定位／通知、2D／卫星地图与测速。
- Android 后台最短约 15 分钟，iOS 后台刷新由系统决定；GPS 仅在前台主动开启。

## 附件用途

`*-debug.apk` 是可安装到 Android 的测试签名包。`*-unsigned.aab` 尚未签名，不能直接安装或上传商店。

`*-simulator.zip` 仅供 Mac / Xcode iOS 模拟器使用，不是 IPA，不能安装到实体 iPhone。真机、TestFlight 与 App Store 仍需自己的 Apple 开发者账号签名。

[发行教程](https://github.com/Le672/yukino-rail-watch/blob/main/docs/mobile-distribution.md) · [数据来源](https://github.com/Le672/yukino-rail-watch/blob/main/docs/rail-data-sources.md) · [隐私政策](https://cr.yukino.bond/rail-privacy.html)