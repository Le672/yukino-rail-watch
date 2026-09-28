# Yukino Rail Watch · 余票提醒

独立的 12306 余票查询、网页通知和 Windows 托盘提醒项目。网页入口为 [cr.yukino.bond](https://cr.yukino.bond)，也可通过主站 [余票提醒](https://www.yukino.bond/cr) 使用。子域已完成 Pages 绑定和 DNS 配置，并验证 HTTPS 页面可以访问。

## 功能

- 输入日期、出发站、到达站、可选车次和关注席别，查询 12306 官方余票数据。
- 自定 1–60 分钟检查间隔。网页保持打开且允许通知时，可收到浏览器系统通知。
- Windows 便携版关闭窗口后留在托盘继续监控，发现有票时发送系统通知。
- 只有从无票变为有票时才重复提醒；重新启动监控会提示当时已有的余票。
- 按日期、车站区间、车次和发车时间匹配 RailGo 车型与配属资料，并提供 rail.re 历史交路入口。

只查询公开信息，不登录 12306，也不提供购票或抢票。上游限流、网络故障及浏览器休眠都可能影响提醒，以 12306 官网为准。

## 车型来源

车型数据由 [RailGo](https://railgo.dev/) 提供，网页和 Windows 客户端直接访问 RailGo 服务，公开的余票 API 不中转车型数据。按区间缓存 30 分钟，服务失败后暂缓 5 分钟重试；车型缺失或冲突不影响 12306 余票查询。页面标明来源和车型资料查询时间，实际编组可能调整。

每趟车提供 [rail.re](https://rail.re/) 历史交路入口用于核对历史记录；历史动车组编号不等同于出行当天的确定车型。使用须遵守 [RailGo 数据服务说明](https://api.railgo.dev/) 的非商业、署名和禁止公开接口中转要求。

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

产物位于 `release/`，GitHub Actions 也会在每次推送 `main` 时构建并上传便携版。桌面版默认使用已部署的 `https://www.yukino.bond/api/rail`；可通过 `RAIL_API_URL` 环境变量指定自己的 API。

## 网页部署

本项目适合连接到 Cloudflare Pages：构建命令 `pnpm build`，产物目录 `dist`，Functions 位于 `functions/`。将 `cr.yukino.bond` 添加到对应 Pages 项目的自定义域名，并在 Cloudflare DNS 中配置记录。域名是否可用须以公开 DNS 与实际 HTTPS 访问验证；仓库创建本身不会开通域名。

代码从 [YUKINO.BOND](https://github.com/Le672/raptor) 中的余票模块独立整理。
