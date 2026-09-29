import { resolveTrainArt, trainArtCatalogue } from "../lib/train-art";

export function TrainIllustration({ model }: { model: string | null }) {
  const art = resolveTrainArt(model);
  if (!art) return <span className="rail-art-missing">{model ? "外观图待核实" : "车型待核实"}</span>;
  const referenceOnly = art.accuracy === "reference";
  return <figure className="rail-train-art" title={`${art.displayModel} · ${art.livery}\n${art.features}\n${referenceOnly ? `参考图，具体版本待核实：${art.referenceNote}\n` : ""}首车 Q 版侧视图，非完整编组；不代表本次列车的特殊涂装。`}>
    <img src={art.image} width={160} height={56} alt={`${art.displayModel}，${art.livery}，Q 版首车侧视图`} loading="lazy" decoding="async" />
    <figcaption>{art.displayModel}{art.coupled ? " · 重联" : ""}{referenceOnly && <span className="rail-art-reference-label">参考外观 · 版本待核实</span>}</figcaption>
  </figure>;
}

export function TrainArtReferences({ models }: { models: (string | null)[] }) {
  const selected = new Set(models.flatMap((model) => { const art = resolveTrainArt(model); return art ? [art.model] : []; }));
  const rows = trainArtCatalogue.filter((item) => selected.has(item.model));
  return <details className="rail-art-references">
    <summary>车型图示说明 · {trainArtCatalogue.length} 款参考外观</summary>
    <p>外观资料：<a href="https://www.china-emu.cn/Trains/ALL/" target="_blank" rel="noreferrer">中国动车组</a>。已核对的图示按车型页实拍重绘车头、窗带与涂装；其余提供参考图。均为首车的 Q 版侧视图，比例压缩，不表示完整编组、车组批次或本次列车的特殊涂装。</p>
    <p>无法确认具体版本时，显示该型号参考图并标注「参考外观 · 版本待核实」。支持已收录的长编、长编组等写法，区分长短编组，并按资料页选择动力车或控制车参考外观；不使用其他型号替代。未收录或车型缺失时仍显示待核实提示。</p>
    <p>原创侧视插画采用 <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a> 许可。参考图片的权利归原作者，本站未转载中国动车组的示例头像或实拍照片。</p>
    {rows.length ? <ul>{rows.map((item) => <li key={item.model}><strong>{item.model}</strong>{item.accuracy === "reference" && <span className="rail-art-reference-note">参考图，具体版本待核实：{item.referenceNote}</span>}<span>{item.livery} · {item.features}</span><span><a href={item.reviewSource} target="_blank" rel="noreferrer">中国动车组车型资料</a> · {item.reviewEdition} · {item.reviewAuthors}</span><span><a href={item.source} target="_blank" rel="noreferrer">实拍参考</a> · {item.author} · {item.licenseUrl ? <a href={item.licenseUrl} target="_blank" rel="noreferrer">{item.license}</a> : item.license}</span></li>)}</ul> : <p>查询结果显示车型插画后，这里将列出对应的实拍参考。</p>}
  </details>;
}
