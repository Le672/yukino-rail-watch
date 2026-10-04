# Android / iOS 1.1.4 Preview

- 车次检索漏项时补查 12306 按日期车次表，余票与位置查询均保持官方数据来源。
- 计划车型与客运担当优先读取 12306，官方缺少车型才使用 RailGo 参考资料；按首站始发日处理跨日车次。
- 担当和车辆配属分别显示，未绑定日期的车型标为参考；保留手机独立布局、原生定位和通知。

## 附件用途

`*-debug.apk` 可用于 Android 测试安装；`*-unsigned.aab` 尚未签名，不能直接安装或上传商店。

`*-simulator.zip` 仅供 Mac / Xcode iOS 模拟器使用，不是 IPA，不能安装到实体 iPhone。真机、TestFlight 与 App Store 需 Apple 开发者账号签名。

[发行教程](https://github.com/Le672/yukino-rail-watch/blob/main/docs/mobile-distribution.md) · [数据来源与日期范围](https://github.com/Le672/yukino-rail-watch/blob/main/docs/rail-data-sources.md)
