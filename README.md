# Yukino Rail Watch · 余票提醒

独立的 12306 余票查询、网页通知和 Windows 托盘提醒项目。网页入口为 [cr.yukino.bond](https://cr.yukino.bond)，也可通过主站 [余票提醒](https://www.yukino.bond/cr) 使用。子域已完成 Pages 绑定和 DNS 配置，并验证 HTTPS 页面可以访问。

## 下载

[下载最新 Windows 便携版](https://github.com/Le672/yukino-rail-watch/releases/latest) · [全部版本](https://github.com/Le672/yukino-rail-watch/releases)

在版本页的 Assets 中下载 `.exe`，双击运行即可。每个正式版本同时提供 `SHA256SUMS.txt`。

## 功能

- 按车次查询：只输入车次，自动从 12306 识别该日期的始发和终到站，查询全程余票。日期默认中国时区的今天，可自行修改。
- 按区间查询：只选择出发站和到达站，查询该区间全部车次，无需填写车次。中途乘车请使用此方式。
- 自定 1–60 分钟检查间隔。网页保持打开且允许通知时，可收到浏览器系统通知。
- Windows 便携版关闭窗口后留在托盘继续监控，发现有票时发送系统通知。
- 只有从无票变为有票时才重复提醒；重新启动监控会提示当时已有的余票。
- 按日期、车站区间、车次和发车时间匹配 RailGo 车型与配属资料。
- Windows 1.7.1 和网页支持 GPS／设备实时定位，匹配当前铁路区间与下一停靠站，显示精度、更新时间及距下一站的线路距离。仅在乘坐所选车次时开启。
- 新增实时测速卡片，优先显示设备瞬时速度，缺少读数时用最近 8 秒 GPS 定位短时估算；标明来源、读数年龄及误差参考，无有效测速时自动切换为明确标注的预估速度。
- 无 GPS 时结合铁路区间距离、车型和当日停站时刻预估当前速度，包含分段线性加速、巡航、线性减速；停站显示 0，地图位置跟随同一曲线的距离积分。自定义观察时间也可查看预估速度。临时停车与实际限速可能造成偏差。
- 完整地图支持 2D／卫星图切换、拖动缩放、全程／当前位置视图；停止定位或隐藏窗口后停止位置读取，GPS 失效时明确切回时刻表估算。
- 162 个车型/版本条目，使用 159 张 Q 版侧视图，覆盖统型、NG、阶段、长短编组及 11 类普速客车；无法确认具体版本的图旁标注「参考外观 · 版本待核实」。
- 插画采用 CC BY-SA 4.0 许可，实拍资料与参考涂装记录见 [图示依据](docs/rail-train-art.md)。

只查询公开信息，不登录 12306，也不提供购票或抢票。上游限流、网络故障及浏览器休眠都可能影响提醒，以 12306 官网为准。

升级到 1.2.0 后保留原查询条件；旧版监控会先暂停，请选择查询方式后重新开启。切换方式或修改条件时会停止当前监控并清空旧结果。

## 车型来源

车型数据由 [RailGo](https://railgo.dev/) 提供，网页和 Windows 客户端直接访问 RailGo 服务，公开的余票 API 不中转车型数据。按区间缓存 30 分钟，服务失败后暂缓 5 分钟重试；车型缺失或冲突不影响 12306 余票查询。页面底部统一显示 RailGo 数据服务署名卡片，点击可打开数据服务文档，实际编组可能调整。

使用须遵守 [RailGo 数据服务说明](https://api.railgo.dev/) 的非商业、署名和禁止公开接口中转要求。

## 本地开发

需要 Node.js 22 和 pnpm 11。

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm exec wrangler pages dev dist
```

最后一步在本地启动 Cloudflare Pages Functions，网页 API 才能查询 12306。单独运行 Vite 开发服务器时只有界面。

## Windows 便携版

```powershell
pnpm desktop:build
```

产物位于 `release/`，GitHub Actions 会在推送 `main` 时运行测试、构建便携版并保留 Actions 附件；当 `package.json` 与 `electron-builder.json` 的版本一致且该版本尚未发布时，自动创建对应 `v版本号` 的 Release，上传 `.exe` 和校验文件后发布。已发布版本的附件保持不变；发布新软件版本前请同步升级两个文件中的版本号，可在 `docs/releases/版本号.md` 添加中文说明。桌面版默认使用已部署的 `https://www.yukino.bond/api/rail`；可通过 `RAIL_API_URL` 环境变量指定自己的 API。

## 网页部署

本项目适合连接到 Cloudflare Pages：构建命令 `pnpm build`，产物目录 `dist`，Functions 位于 `functions/`。将 `cr.yukino.bond` 添加到对应 Pages 项目的自定义域名，并在 Cloudflare DNS 中配置记录。域名是否可用须以公开 DNS 与实际 HTTPS 访问验证；仓库创建本身不会开通域名。

代码从 [YUKINO.BOND](https://github.com/Le672/raptor) 中的余票模块独立整理。

车型覆盖清单：[完整核对清单](docs/train-art-coverage.json)，包含中国动车组客运型号、RailGo 型号与实测返回名称；括号版本优先使用独立图，无法确认时保留基础外观并标注。

## 列车位置与下一站（1.4.0）

选择「列车位置与下一站」，输入车次和始发日期即可查询。按当天停站时刻表判断下一停靠站，结合铁路线路点绘制估算位置，支持实时北京时间、自定义观察时间、跨日和正晚点。G6003 在 2026-09-29 10:01 的下一停靠站是广州南，不把沿线通过站当作停靠站。位置为时刻与线路估算，非 GPS 定位。具体数据与限制见 [功能说明](docs/rail-position.md)。

GPS 与地图来源、许可和定位精度限制：[定位功能说明](docs/rail-position.md)。

