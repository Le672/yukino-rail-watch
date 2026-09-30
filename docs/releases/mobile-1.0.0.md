# Android / iOS 1.0.0 Preview

- 新增独立手机界面：余票、位置、使用说明底部导航，窄屏与安全区域适配。
- 原生余票监控、通知和本机设置保存；支持车次 / 区间查询、车型插图、GPS 地图与实时 / 预估速度。
- Android 后台检查使用 WorkManager，最短 15 分钟；iOS 后台刷新由系统安排，无法保证每分钟检查。GPS 只在前台位置页开启。
- 应用图标沿用浅绿底列车图案。新增隐私页及中文发行教程。

## 下载与签名状态

`*-debug.apk` 可安装到 Android，用于测试，使用临时调试签名。`*-unsigned.aab` 尚未签名，不能直接安装或作为正式版本上传；如有 `*-release.apk` / `*-signed.aab`，它们由仓库所有者配置的签名密钥构建。

`*-simulator.zip` 内为 Mac / Xcode iOS 模拟器应用，**不是 IPA，不能安装到实体 iPhone**。实体 iPhone 与 TestFlight / App Store 发行须由你的 Apple 开发者账号签名。本预览版未提交应用商店。

[安装、签名和发行教程](https://github.com/Le672/yukino-rail-watch/blob/main/docs/mobile-distribution.md) · [隐私政策](https://cr.yukino.bond/rail-privacy.html)

真机省电策略、实际后台到票提醒和 GPS 性能仍需在你的设备上检验。
