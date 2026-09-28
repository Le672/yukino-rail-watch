import catalogue from "../data/train-art.json";

export type TrainArt = {
  model: string;
  livery: string;
  features: string;
  source: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
};

const references = new Map<string, TrainArt>(catalogue.map((item) => [item.model, item]));
const assets = import.meta.glob<string>("../assets/trains/*.svg", { eager: true, query: "?url&no-inline", import: "default" });

export type ResolvedTrainArt = TrainArt & { image: string; coupled: boolean };

// Only formatting differences and explicit same-model coupling are accepted.
// Never strip a suffix, infer a trainset from its service code, or match a prefix.
export function resolveTrainArt(raw: string | null | undefined): ResolvedTrainArt | null {
  if (!raw) return null;
  const normalized = raw.normalize("NFKC").trim().toUpperCase().replace(/[–—−]/g, "-");
  let model = normalized;
  let coupled = false;
  const doubled = normalized.match(/^([A-Z0-9-]+)\s*\+\s*([A-Z0-9-]+)$/);
  if (doubled) {
    if (doubled[1] !== doubled[2]) return null;
    model = doubled[1];
    coupled = true;
  } else if (/\s*重联$/.test(normalized)) {
    model = normalized.replace(/\s*重联$/, "").trim();
    coupled = true;
  }
  const reference = references.get(model);
  const image = assets[`../assets/trains/${model}.svg`];
  return reference && image ? { ...reference, image, coupled } : null;
}

export const trainArtCatalogue: TrainArt[] = catalogue;
