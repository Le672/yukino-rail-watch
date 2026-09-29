import { resolveTrainArts } from "../lib/train-art";

export function TrainIllustration({ model }: { model: string | null }) {
  const arts = resolveTrainArts(model);
  if (!arts.length) return <span className="rail-art-missing">{model ? "外观资料暂未提供" : "车型暂未提供"}</span>;
  const referenceOnly = arts.some(art => art.accuracy === "reference");
  return <figure className="rail-train-art" title={arts.map(art => `${art.displayModel} · ${art.livery}\n${art.features}\n${art.accuracy === "reference" ? `参考图，具体版本待核实：${art.referenceNote}\n` : ""}Q 版侧视图，非完整编组；不代表本次列车的特殊涂装。`).join("\n\n")}>
    <div className="rail-train-art-images">{arts.map((art, index) => <img key={`${art.model}-${index}`} src={art.image} style={{ width: `${100 / arts.length}%` }} width={160 / arts.length} height={56} alt={`${art.displayModel}，${art.livery}，Q 版侧视图`} loading="lazy" decoding="async" />)}</div>
    <figcaption>{arts.map(art => art.displayModel).join(" + ")}{arts.some(art => art.coupled) ? " · 重联" : ""}{referenceOnly && <span className="rail-art-reference-label">{arts.some(art => art.referenceLabel === "系列外观参考") ? "系列外观参考 · 版本待核实" : "参考外观 · 版本待核实"}</span>}</figcaption>
  </figure>;
}
