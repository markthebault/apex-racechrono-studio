import { describe, expect, it } from "vitest";
import { sameCatalogModel } from "./modelIdentity";

const selected = "openai/gpt-6-luna";
const catalog = {
  data: [
    { id: selected, canonical_slug: "openai/gpt-6-luna-20260922" },
    { id: "openai/gpt-6-sol", canonical_slug: "openai/gpt-6-sol-20260922" },
  ],
};

describe("OpenRouter response model identity", () => {
  it("accepts the exact model without needing catalog data", () => {
    expect(sameCatalogModel(selected, selected, undefined)).toBe(true);
  });
  it("accepts the verified deployment in both catalog and API date formats", () => {
    expect(
      sameCatalogModel(selected, "openai/gpt-6-luna-20260922", catalog),
    ).toBe(true);
    expect(
      sameCatalogModel(selected, "openai/gpt-6-luna-2026-09-22", catalog),
    ).toBe(true);
  });
  it.each([
    "openai/gpt-6-sol",
    "openai/gpt-6-luna-20260921",
    "openai/gpt-6-luna-pro",
    "other/gpt-6-luna-20260922",
  ])("rejects a different model or unverified deployment: %s", (returned) => {
    expect(sameCatalogModel(selected, returned, catalog)).toBe(false);
  });
  it.each([undefined, null, {}, { data: [] }, { data: [{ id: selected }] }])(
    "fails closed with missing or malformed verification data: %j",
    (value) => {
      expect(
        sameCatalogModel(selected, "openai/gpt-6-luna-20260922", value),
      ).toBe(false);
    },
  );
  it("does not turn paid/free routing variants into aliases", () => {
    expect(sameCatalogModel(selected + ":free", selected, catalog)).toBe(false);
    expect(sameCatalogModel(selected, selected + ":free", catalog)).toBe(false);
  });
});
