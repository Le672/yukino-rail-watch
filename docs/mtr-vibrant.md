# 港铁动感号车型识别

更新日期：2026-09-30。

## 车次依据

逐页核对港铁官方短途时刻表的橙色圆点「港鐵動感號 / Vibrant Express」，读取两个方向及周末附页。核对的两版名单相同，共 77 个车次；可机读的逐项名单见 `src/data/mtr-vibrant-services.json`。

- [2026-07-01 版，适用于 2026-10-11 前](https://www.highspeed.mtr.com.hk/res/pdf/short-haul-train-timetable.pdf)：36 个 G5620 至 G5655 车次、28 个 G5805 至 G5832 车次、6 个 G5857 至 G5862 车次，以及 G6581、G6582、G6583、G6584、G6586、G6587、G6588。
- [2026-10-11 起版](https://www.highspeed.mtr.com.hk/res/pdf/short-haul-train-timetable-new.pdf)：同上。生效范围来自[港铁时刻表下载页](https://www.highspeed.mtr.com.hk/en/ticket/timetable.html)。
- G6585、周末附页 G5679、G5680、G5865、G5866 未标动感号，因此不加入名单。名单不证明每天开行；仅修正查询系统已返回的真实车次。

查询先按日期、车次、出发时刻和站间区间匹配 RailGo 实际车型及配属。明确「港铁公司」等配属的 CRH380A 使用港铁涂装，不受静态名单限制，可覆盖另行加开的班次。明确的其他车型或配属、冲突的数据都不会被名单覆盖。

配属缺失时，名单只能在相应生效日期、广深港走廊及正确方向内补充型号。深圳北、福田、香港西九龙，以及广州南、南沙北（QSQ）、虎门、光明城均按 12306 站码判断，不以 G56/G58/G65 号码前缀泛化。静态名单后续应随港铁调图复核。

## 外观依据

- [港铁官方首列交付新闻稿及资料册](https://www.mtr.com.hk/archive/corporate/en/press_release/PR-16-083-C.pdf)，第 3 页的实拍、第 6 页的车身设计说明与实拍：银色车身；驾驶窗与灯区周围为红色；两侧橙色弧线；每卡白色及红色波纹。
- [中国动车组 CRH380A（港铁）资料](https://www.china-emu.cn/Trains/Model/Detail-30003-101-1.html)，用于核对型号和车头轮廓。

`src/assets/trains/full-model-112.svg` 为本站原创 Q 版首车侧视图，按上述实拍重新绘制；不转载实拍、示例头像或第三方图像。使用既有 CC BY-SA 4.0 许可。图为标准动感号涂装，不表示临时主题贴纸或完整编组。车型目录另支持「港鐵」「动感号」「MTR」及 CRH380A-0251 至 -0259 明确车组号。
