import { resolveTrainArts, trainArtCatalogue } from "../lib/train-art";

export function TrainIllustration({ model }: { model: string | null }) {
  const arts = resolveTrainArts(model);
  if (!arts.length) return <span className="rail-art-missing">{model ? "外观资料暂未提供" : "车型暂未提供"}</span>;
  const referenceOnly = arts.some(art => art.accuracy === "reference");
  return <figure className="rail-train-art" title={arts.map(art => `${art.displayModel} · ${art.livery}\n${art.features}\n${art.accuracy === "reference" ? `参考图，具体版本待核实：${art.referenceNote}\n` : ""}Q 版侧视图，非完整编组；不代表本次列车的特殊涂装。`).join("\n\n")}>
    <div className="rail-train-art-images">{arts.map((art, index) => <img key={`${art.model}-${index}`} src={art.image} style={{ width: `${100 / arts.length}%` }} width={160 / arts.length} height={56} alt={`${art.displayModel}，${art.livery}，Q 版侧视图`} loading="lazy" decoding="async" />)}</div>
    <figcaption>{arts.map(art => art.displayModel).join(" + ")}{arts.some(art => art.coupled) ? " · 重联" : ""}{referenceOnly && <span className="rail-art-reference-label">{arts.some(art => art.referenceLabel === "系列外观参考") ? "系列外观参考 · 版本待核实" : "参考外观 · 版本待核实"}</span>}</figcaption>
  </figure>;
}

export function TrainArtReferences({ models }: { models: (string | null)[] }) {
  const selected = new Set(models.flatMap((model) => resolveTrainArts(model).map(art => art.model)));
  const rows = trainArtCatalogue.filter((item) => selected.has(item.model));
  return <details className="rail-art-references">
    <summary>车型图示说明 · {trainArtCatalogue.length} 款参考外观</summary>
    <p>动车组外观资料：<a href="https://www.china-emu.cn/Trains/ALL/" target="_blank" rel="noreferrer">中国动车组</a>；普速客车参考照片及署名见下方条目。已核对的图示按车型页实拍重绘车头、窗带与涂装；其余提供参考图。动车组展示首车，普速客车展示车厢，均为比例压缩的 Q 版侧视图，不表示完整编组、车组批次或本次列车的特殊涂装。</p>
    <p>无法确认具体版本时，保留同一基础型号的参考图并标注「参考外观 · 版本待核实」。支持统型、旧型、NG、阶段、长短编组及供电描述；已收录的具体版本优先使用独立图。普速客车展示车厢外观，未确认牵引机车型号时不配机车图。</p>
    <p>原创侧视插画采用 <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a> 许可。参考图片的权利归原作者，本站未转载中国动车组的示例头像或实拍照片。</p>
    {rows.length ? <ul>{rows.map((item) => <li key={item.model}><strong>{item.model}</strong>{item.accuracy === "reference" && <span className="rail-art-reference-note">参考图，具体版本待核实：{item.referenceNote}</span>}<span>{item.livery} · {item.features}</span><span><a href={item.reviewSource} target="_blank" rel="noreferrer">外观参考资料</a> · {item.reviewEdition} · {item.reviewAuthors}</span><span><a href={item.source} target="_blank" rel="noreferrer">实拍参考</a> · {item.author} · {item.licenseUrl ? <a href={item.licenseUrl} target="_blank" rel="noreferrer">{item.license}</a> : item.license}</span></li>)}</ul> : <p>查询结果显示车型插画后，这里将列出对应的实拍参考。</p>}
  </details>;
}
