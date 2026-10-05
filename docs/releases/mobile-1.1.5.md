# Android / iOS 1.1.5 Preview

- 列车位置页 2D 地图默认使用高德国内底图，显示中文地名；保留 OpenStreetMap 备用来源。
- 铁路线路、停站和设备位置随底图统一转换坐标，切换卫星图保留视野与缩放；GPS 匹配和测速仍使用原始 WGS84 数据。
- 底图加载失败或 15 秒无瓦片时可重试或切换来源；适配窄屏地图控制栏。
- 保留手机独立布局、原生定位、余票监控和通知。

## 附件用途

`*-debug.apk` 可用于 Android 测试安装；`*-unsigned.aab` 尚未签名，不能直接安装或上传商店。

`*-simulator.zip` 仅供 Mac / Xcode iOS 模拟器使用，不是 IPA，不能安装到实体 iPhone。真机、TestFlight 与 App Store 需 Apple 开发者账号签名。

[发行教程](https://github.com/Le672/yukino-rail-watch/blob/main/docs/mobile-distribution.md) · [地图来源与坐标说明](https://github.com/Le672/yukino-rail-watch/blob/main/docs/rail-position.md)
