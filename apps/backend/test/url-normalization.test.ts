import { describe, it, expect } from "vitest";
import {
  normalizeCompanyUrl,
  tryNormalizeCompanyUrl,
} from "../src/customer-zero/url-normalization.js";

describe("normalizeCompanyUrl", () => {
  it("accepts a bare domain without protocol", () => {
    expect(normalizeCompanyUrl("moonsharedliving.com").url).toBe(
      "https://moonsharedliving.com",
    );
  });

  it("accepts www without protocol", () => {
    expect(normalizeCompanyUrl("www.moonsharedliving.com").url).toBe(
      "https://www.moonsharedliving.com",
    );
  });

  it("accepts https and http as typed", () => {
    expect(normalizeCompanyUrl("https://moonsharedliving.com").url).toBe(
      "https://moonsharedliving.com",
    );
    expect(normalizeCompanyUrl("http://moonsharedliving.com").url).toBe(
      "http://moonsharedliving.com",
    );
  });

  it("trims stray whitespace and keeps paths", () => {
    expect(normalizeCompanyUrl("  moonsharedliving.com/es  ").url).toBe(
      "https://moonsharedliving.com/es",
    );
  });

  it("rejects things that cannot be a website", () => {
    expect(tryNormalizeCompanyUrl("")).toBeNull();
    expect(tryNormalizeCompanyUrl("no tengo web")).toBeNull();
    expect(tryNormalizeCompanyUrl("moonsharedliving")).toBeNull();
  });
});
