# 车型 Q 版首车侧视图

2026-09-28：43 款完整型号，网页与 Windows 共用相同 SVG 及目录。

## 外观依据

每个完整型号分别选择并检查实拍照片。照片的原始文件页、摄影者、许可和图示特征记录在 `src/data/train-art.json`，页面底部「车型图示说明」可查看当前结果的对应来源。原始照片只用于核对，没有在应用内转载。

制造商资料用于交叉核对系列特征，尤其是容易混淆的 CR300AF 红色色带和 CR300BF 橙金色带：

- [中车四方 CR400AF](https://www.crrcgc.cc/sfgf/2015-11/04/article_E7691BD1DADD4C799E29B682C86DADD3.html)
- [中车四方 CR400AF-S / CR400AF-BS](https://www.crrcgc.cc/sfgf/2021-11/22/article_37881FC7258B4931A76E69A92BDB09EA.html)
- [中车四方 CR300AF](https://www.crrcgc.cc/sfgf/2025-07/28/article_2025072816400583232.html)
- [中车唐山 CR300BF](https://www.crrcgc.cc/ts/2021-07/14/article_6BED145B23FA4DC08C0365019A312B26.html)
- [中车 CR400BF 智能型](https://www.crrcgc.cc/en/2023-04/26/article_245382ABF91B45DD8107FF509E7BDE94.html)
- [中车 CRH380B](https://www.crrcgc.cc/en/2016-02/29/article_C49CC51D1D83478CA25A35C2A9CA53A9.html)
- [中车 CRH380CL](https://www.crrcgc.cc/en/2016-02/24/article_A32ED35065C04812BEF99AD79FFAB34F.html)

SVG 由 `scripts/draw-train-art.mjs` 绘制。Q 版压缩了首车比例；不是完整列车编组图，也不推测本次车组编号、纪念涂装或实际车辆调配。插画许可为 CC BY-SA 4.0，参考照片保留其各自许可和署名。

## 匹配约束

- 只查询目录中的完整型号，保留 AF / BF、A / B、Z / S、G 等所有后缀。
- 不按 G / D / C 等车次前缀猜测车型，不用同系列另一型号代替。
- 仅接受首尾空白、全角字符、连字符格式和明确的同型号重联标记。
- 多型号候选、未知后缀或未知型号显示「外观图待核实」，不画通用列车占位。
- CRH1E、CRH2C、CRH2E、CRH3A、CR200J 等仅有大类名而不能区分头型或代际的输入，暂不提供图示。CR400BF-C 的现有参考不足以核对全部外观细节，暂不收录。普速客车不会搭配猜测的机车型号。

## 扩展

新增型号须先核对该完整型号的照片、许可和外观特征，更新目录，增加对应绘图参数，然后运行 `node scripts/draw-train-art.mjs`。无明确参考资料时保持未收录。
