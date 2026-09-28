import { resolveTrainArt, trainArtCatalogue } from "../lib/train-art";

export function TrainIllustration({ model }: { model: string | null }) {
  const art = resolveTrainArt(model);
  if (!art) return <span className="rail-art-missing">{model ? "外观图待核实" : "车型待核实"}</span>;
  return <figure className="rail-train-art" title={`${art.model} · ${art.livery}\n${art.features}\n首车 Q 版侧视图，非完整编组；不代表本次列车的特殊涂装。`}>
    <img src={art.image} width={160} height={56} alt={`${art.model}，${art.livery}，Q 版首车侧视图`} loading="lazy" decoding="async" />
    <figcaption>{art.model}{art.coupled ? " · 重联" : ""}</figcaption>
  </figure>;
}

export function TrainArtReferences({ models }: { models: (string | null)[] }) {
  const selected = new Set(models.flatMap((model) => { const art = resolveTrainArt(model); return art ? [art.model] : []; }));
  const rows = trainArtCatalogue.filter((item) => selected.has(item.model));
  return <details className="rail-art-references">
    <summary>车型图示说明 · 已核对 {trainArtCatalogue.length} 款型号</summary>
    <p>图示根据对应完整型号的实拍外观绘制，为首车的 Q 版侧视图，不表示完整编组或本次车组的特殊涂装。只精确匹配完整型号；缺少资料、型号不明确或存在冲突时不显示替代图。</p>
    <p>插画采用 <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a> 许可。外观参考照片及摄影者如下，照片保留各自许可。</p>
    {rows.length ? <ul>{rows.map((item) => <li key={item.model}><strong>{item.model}</strong><span>{item.livery} · {item.features}</span><span><a href={item.source} target="_blank" rel="noreferrer">实拍参考</a> · {item.author} · <a href={item.licenseUrl} target="_blank" rel="noreferrer">{item.license}</a></span></li>)}</ul> : <p>查询结果显示车型插画后，这里将列出对应的实拍参考。</p>}
  </details>;
}
