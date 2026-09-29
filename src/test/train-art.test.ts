import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { TrainIllustration } from "../components/TrainIllustration";
import { resolveTrainArt, trainArtCatalogue } from "../lib/train-art";

afterEach(cleanup);

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

  it("never substitutes another model, a service code or an unlisted generation", () => {
    for (const model of [null, "", "G547", "CR400", "CR400AF-BZZ", "CR400AF-UNKNOWN", "CRH1E", "CRH2C", "CRH2E", "CRH3A", "CR200J", "CR200J(长编)", "CR400AF/CR400BF", "CR400AF 或 CR400BF", "CR400AF（疑似）"]) {
      expect(resolveTrainArt(model)).toBeNull();
    }
  });

  it("restores the ten original images with an explicit uncertainty flag", () => {
    const models = ["CR400AF-S", "CR400BF-S", "CR400BF-A", "CR400BF-Z", "CRH1B", "CRH2A", "CRH2B", "CRH5G", "CRH6A", "CRH6F"];
    expect(trainArtCatalogue.filter((item) => item.accuracy === "reference").map((item) => item.model).sort()).toEqual([...models].sort());
    for (const model of models) {
      expect(resolveTrainArt(model)).toMatchObject({ model, accuracy: "reference" });
      expect(resolveTrainArt(model)?.referenceNote).toBeTruthy();
    }
    expect(resolveTrainArt("CR400AF")?.accuracy).toBe("reviewed");
  });

  it("shows uncertainty beside the restored image and keeps reviewed images unlabelled", () => {
    const view = render(createElement(TrainIllustration, { model: "CRH2A" }));
    expect(screen.getByRole("img", { name: /^CRH2A，/ })).toBeTruthy();
    expect(screen.getByText("参考外观 · 版本待核实")).toBeTruthy();
    expect(view.container.querySelector("figure")?.title).toContain("原版参考图，具体版本待核实");
    view.rerender(createElement(TrainIllustration, { model: "CR400AF" }));
    expect(screen.queryByText("参考外观 · 版本待核实")).toBeNull();
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
