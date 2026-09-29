import catalogueData from "../data/train-art.json";

export type TrainArt = {
  model: string;
  asset?: string;
  aliases?: string[];
  accuracy: "reviewed" | "reference";
  referenceNote?: string;
  livery: string;
  features: string;
  source: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string | null;
  reviewSource: string;
  reviewEdition: string;
  reviewAuthors: string;
};

const catalogue = catalogueData as TrainArt[];
const normalizeModel = (raw: string) => raw.normalize("NFKC").trim().toUpperCase().replace(/[–—−]/g, "-").replace(/\s+/g, "");
const references = new Map<string, TrainArt>();
for (const item of catalogue) {
  for (const name of [item.model, ...(item.aliases || [])]) {
    const key = normalizeModel(name);
    if (references.has(key)) throw new Error(`Duplicate train illustration name: ${name}`);
    references.set(key, item);
  }
}
const assets = import.meta.glob<string>("../assets/trains/*.svg", { eager: true, query: "?url&no-inline", import: "default" });

export type ResolvedTrainArt = TrainArt & { image: string; coupled: boolean; displayModel: string };

// Accept formatting, catalogued formation names and explicit same-model coupling.
// Never strip a suffix, infer a trainset from its service code, or match a prefix.
export function resolveTrainArt(raw: string | null | undefined): ResolvedTrainArt | null {
  if (!raw) return null;
  const normalized = normalizeModel(raw);
  let model = normalized;
  let coupled = false;
  const doubled = normalized.match(/^([^+]+)\+([^+]+)$/);
  if (doubled) {
    if (doubled[1] !== doubled[2]) return null;
    model = doubled[1];
    coupled = true;
  } else if (/\s*重联$/.test(normalized)) {
    model = normalized.replace(/\s*重联$/, "").trim();
    coupled = true;
  }
  const reference = references.get(model);
  const image = reference && assets[`../assets/trains/${reference.asset || reference.model}.svg`];
  return reference && image ? { ...reference, image, coupled, displayModel: model } : null;
}

export const trainArtCatalogue: TrainArt[] = catalogue;
