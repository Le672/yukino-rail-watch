import catalogueData from "../data/train-art.json";

export type TrainArt = {
  model: string;
  asset?: string;
  aliases?: string[];
  accuracy: "reviewed" | "reference";
  referenceNote?: string;
  referenceLabel?: string;
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
  let reference = references.get(model);
  // A newly encountered description may still use the original image of that
  // exact base model. Keep the full description and make uncertainty visible.
  // Letter/number suffixes remain part of the identity and are never removed.
  if (!reference) {
    const described = model.match(/^([^()]+)(?:\([^()]+\))+$/);
    const base = described && references.get(described[1]);
    if (base) reference = {
      ...base, accuracy: "reference",
      referenceNote: `接口返回「${model}」，该说明尚未单独核对；图为 ${base.model} 的基础外观参考，不能确认此版本的车头、涂装或完整编组。`,
    };
  }
  const image = reference && assets[`../assets/trains/${reference.asset || reference.model}.svg`];
  return reference && image ? { ...reference, image, coupled, displayModel: model } : null;
}

export function resolveTrainArts(raw: string | null | undefined): ResolvedTrainArt[] {
  const single = resolveTrainArt(raw);
  if (single) return [single];
  if (!raw) return [];
  const parts = normalizeModel(raw).split("+");
  if (parts.length < 2 || parts.length > 4) return [];
  const matched = parts.map(resolveTrainArt);
  // A partial match must not suggest the entire combination has been identified.
  return matched.every((item): item is ResolvedTrainArt => item !== null) ? matched : [];
}

export const trainArtCatalogue: TrainArt[] = catalogue;
