import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { TrainIllustration } from "../components/TrainIllustration";
import { resolveTrainArt, resolveTrainArts, trainArtCatalogue } from "../lib/train-art";
import coverage from "../../docs/train-art-coverage.json";

afterEach(cleanup);

describe("exact model illustrations", () => {
  it("resolves every catalogued model to its own referenced asset", () => {
    expect(new Set(trainArtCatalogue.map((item) => item.model)).size).toBe(trainArtCatalogue.length);
    for (const item of trainArtCatalogue) {
      const art = resolveTrainArt(item.model);
      expect(art?.model).toBe(item.model);
      expect(art?.image).toContain(item.asset || item.model);
      expect(item.source).toMatch(/^https:\/\/(commons\.wikimedia\.org\/wiki\/File:|www\.china-emu\.cn\/Trains\/Model\/Detail-|www\.mtr\.com\.hk\/archive\/corporate\/en\/press_release\/)/);
      expect(item.author).not.toBe("");
      if (item.licenseUrl) expect(item.licenseUrl).toMatch(/^https:/);
      else expect(item.license).toBe("原作者保留权利");
      expect(item.reviewSource).toMatch(/^https:\/\/(www\.china-emu\.cn\/Trains\/Model\/Detail-|commons\.wikimedia\.org\/wiki\/File:)/);
      expect(item.reviewAuthors).not.toBe("");
    }
  });

  it("never substitutes another model, a service code or an unlisted generation", () => {
    for (const model of [null, "", "G547", "CR400", "CR400AF-BZZ", "CR400AF-UNKNOWN", "CRH999A", "CR400AF/CR400BF", "CR400AF 或 CR400BF"]) {
      expect(resolveTrainArt(model)).toBeNull();
    }
  });

  it("restores the ten original images with an explicit uncertainty flag", () => {
    const models = ["CR400AF-S", "CR400BF-S", "CR400BF-A", "CR400BF-Z", "CRH1B", "CRH2A", "CRH2B", "CRH5G", "CRH6A", "CRH6F"];
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
    expect(view.container.querySelector("figure")?.title).toContain("参考图，具体版本待核实");
    view.rerender(createElement(TrainIllustration, { model: "CR400AF" }));
    expect(screen.queryByText("参考外观 · 版本待核实")).toBeNull();
  });

  it("resolves the reported CR200J1-C long formation and keeps short and long end cars distinct", () => {
    const long = resolveTrainArt("CR200J1-C(长编)");
    expect(long).toMatchObject({ model: "CR200J1-C(长编)", accuracy: "reference", displayModel: "CR200J1-C(长编)" });
    expect(long?.image).toContain("CR200J1-C-long");
    for (const model of ["CR200J1-C（长编）", "CR200J1-C (长编组)", "CR200J1-C(18编组)"]) {
      expect(resolveTrainArt(model)?.image).toBe(long?.image);
    }
    expect(resolveTrainArt("CR200J1-C")?.image).not.toBe(long?.image);
    expect(resolveTrainArt("CR200J1-C(短编)")?.model).toBe("CR200J1-C");
    expect(resolveTrainArt("CR200J1-C(未知编组)")).toMatchObject({ accuracy: "reference", displayModel: "CR200J1-C(未知编组)" });
    expect(resolveTrainArt("CR200J1-C+CR200J3-C")).toBeNull();
  });

  it("renders the reported train model with an image and uncertainty caption, not an empty placeholder", () => {
    render(createElement(TrainIllustration, { model: "CR200J1-C(长编)" }));
    expect(screen.getByRole("img", { name: /^CR200J1-C\(长编\)，/ })).toBeTruthy();
    expect(screen.getByText("参考外观 · 版本待核实")).toBeTruthy();
    expect(screen.queryByText("外观图待核实")).toBeNull();
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

  it("covers the complete audited passenger inventories and every observed live model label", () => {
    for (const model of [...coverage.chinaPassengerModels, ...coverage.railGoModels, ...coverage.observedRouteModels]) {
      expect(resolveTrainArts(model).length, `Missing artwork: ${model}`).toBeGreaterThan(0);
    }
  });

  it("renders G2949's standardised CRH380A as its independently catalogued version", () => {
    expect(resolveTrainArt("CRH380A (统型)")?.image).not.toBe(resolveTrainArt("CRH380A")?.image);
    render(createElement(TrainIllustration, { model: "CRH380A (统型)" }));
    expect(screen.getByRole("img", { name: /^CRH380A\(统型\)，/ })).toBeTruthy();
    expect(screen.queryByText("外观图待核实")).toBeNull();
  });

  it("resolves MTR aliases and trainsets to a reviewed silver, orange and red livery", () => {
    for (const model of ["CRH380A(港铁动感号)", "CRH380A（港鐵）", "CRH380A(MTR)", "CRH380A-0251", "CRH380A-0259"]) {
      const art = resolveTrainArt(model);
      expect(art).toMatchObject({ model: "CRH380A(港铁)", accuracy: "reviewed" });
      expect(art?.image).not.toBe(resolveTrainArt("CRH380A")?.image);
      expect(art?.livery).toContain("橙色弧线");
    }
    expect(resolveTrainArt("CRH380A-0250")).toBeNull();
    render(createElement(TrainIllustration, { model: "CRH380A(港铁动感号)" }));
    expect(screen.getByRole("img", { name: /港铁动感号/ })).toBeTruthy();
    expect(screen.queryByText("参考外观 · 版本待核实")).toBeNull();
  });

  it("retains the same base model's original image for a new description and makes that uncertainty visible", () => {
    const art=resolveTrainArt("CRH380A（某新版本）");
    expect(art).toMatchObject({ model: "CRH380A", accuracy: "reference", displayModel: "CRH380A(某新版本)" });
    expect(art?.referenceNote).toContain("该说明尚未单独核对");
    expect(resolveTrainArt("CRH380A-UNKNOWN")).toBeNull();
    render(createElement(TrainIllustration, { model: "25G (DC600V 供电)" }));
    expect(screen.getByRole("img", { name: /^25G\(DC600V供电\)，/ })).toBeTruthy();
    expect(screen.getByText("参考外观 · 版本待核实")).toBeTruthy();
  });

  it("shows both known vehicles in a combination and never hides an unidentified part", () => {
    render(createElement(TrainIllustration, { model: "CR400AF+CR400BF" }));
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(resolveTrainArts("25G + 25K")).toHaveLength(2);
    expect(resolveTrainArts("CR400AF+CRH999A")).toHaveLength(0);
  });
});
