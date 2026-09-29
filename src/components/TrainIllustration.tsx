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
    <summary>车型图示说明 · {trainArtCatalogue.length} 款参考外观</summary>
    <p>外观资料：<a href="https://www.china-emu.cn/Trains/ALL/" target="_blank" rel="noreferrer">中国动车组</a>。图示按车型页实拍重新绘制车头、窗带与涂装，为首车的 Q 版侧视图；比例压缩，不表示完整编组、车组批次或本次列车的特殊涂装。</p>
    <p>只匹配已核对的完整型号。同名存在不同头型、代际或涂装且无法区分时，显示「外观图待核实」，不使用相近车型代替。</p>
    <p>原创侧视插画采用 <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a> 许可。参考图片的权利归原作者，本站未转载中国动车组的示例头像或实拍照片。</p>
    {rows.length ? <ul>{rows.map((item) => <li key={item.model}><strong>{item.model}</strong><span>{item.livery} · {item.features}</span><span><a href={item.reviewSource} target="_blank" rel="noreferrer">中国动车组实拍资料</a> · {item.reviewEdition} · {item.reviewAuthors}</span><span><a href={item.source} target="_blank" rel="noreferrer">补充实拍</a> · {item.author} · <a href={item.licenseUrl} target="_blank" rel="noreferrer">{item.license}</a></span></li>)}</ul> : <p>查询结果显示车型插画后，这里将列出对应的实拍参考。</p>}
  </details>;
}
