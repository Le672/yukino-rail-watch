import { describe, expect, it } from "vitest";
import { resolveTrainArt, trainArtCatalogue } from "../lib/train-art";

describe("exact model illustrations", () => {
  it("resolves every catalogued model to its own referenced asset", () => {
    expect(new Set(trainArtCatalogue.map((item) => item.model)).size).toBe(trainArtCatalogue.length);
    for (const item of trainArtCatalogue) {
      const art = resolveTrainArt(item.model);
      expect(art?.model).toBe(item.model);
      expect(art?.image).toContain(item.model);
      expect(item.source).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(item.author).not.toBe("");
      expect(item.licenseUrl).toMatch(/^https:/);
      expect(item.reviewSource).toMatch(/^https:\/\/www\.china-emu\.cn\/Trains\/Model\/Detail-/);
      expect(item.reviewAuthors).not.toBe("");
    }
  });

  it("never substitutes a similar model, a service code or an ambiguous generation", () => {
    for (const model of [null, "", "G547", "CR400", "CR400AF-BZZ", "CR400AF-UNKNOWN", "CRH1E", "CRH2C", "CRH2E", "CRH3A", "CR200J", "CR200J(长编)", "CR400AF-S", "CR400BF-S", "CR400BF-A", "CR400BF-Z", "CRH1B", "CRH2A", "CRH2B", "CRH5G", "CRH6A", "CRH6F", "CR400AF/CR400BF", "CR400AF 或 CR400BF", "CR400AF（疑似）"]) {
      expect(resolveTrainArt(model)).toBeNull();
    }
  });

  it("keeps the complete suffix and does not cross AF, BF, A, B, Z or S variants", () => {
    for (const model of ["CR400AF", "CR400AF-A", "CR400AF-B", "CR400AF-BZ", "CR400AF-BS", "CR400BF-BZ", "CR300AF", "CR300BF"]) {
      expect(resolveTrainArt(model)?.model).toBe(model);
    }
  });

  it("accepts harmless formatting and explicit same-model coupling only", () => {
    expect(resolveTrainArt(" ｃｒ４００ａｆ－ｂｚ ")?.model).toBe("CR400AF-BZ");
    expect(resolveTrainArt("CR400AF + CR400AF")?.coupled).toBe(true);
    expect(resolveTrainArt("CR400AF 重联")?.coupled).toBe(true);
    expect(resolveTrainArt("CR400AF+CR400BF")).toBeNull();
  });
});
