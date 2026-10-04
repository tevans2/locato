import { describe, expect, it } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { DAILY_COUNTRY_FACTS, getCountryOfTheDay, UTC_DAY_MS } from "../src/ui/components/landing/countryOfTheDay";

const countries = indexCountries(rawCountries);

describe("Country of the day", () => {
  it("is stable through the UTC day and changes at midnight for every visitor", () => {
    const start = Date.parse("2026-10-04T00:00:00Z");
    const first = getCountryOfTheDay(countries, start);
    expect(getCountryOfTheDay(countries, start + UTC_DAY_MS - 1)).toEqual(first);
    expect(getCountryOfTheDay(countries, start + UTC_DAY_MS)?.code).not.toBe(first?.code);
    expect(getCountryOfTheDay(countries, Date.parse("2026-10-04T12:00:00+02:00"))).toEqual(
      getCountryOfTheDay(countries, Date.parse("2026-10-04T03:00:00-07:00")),
    );
  });

  it("offers a real country profile and an HTTPS source throughout the rotation", () => {
    const start = Date.parse("2026-10-04T00:00:00Z");
    const features = DAILY_COUNTRY_FACTS.map((_, day) => getCountryOfTheDay(countries, start + day * UTC_DAY_MS)!);
    expect(new Set(features.map(({ code }) => code)).size).toBe(features.length);
    for (const feature of features) {
      expect(feature.country).toBe(countries.byCode.get(feature.code));
      expect(new URL(feature.source).protocol).toBe("https:");
    }
  });

  it("handles a limited country index and dates before the rotation epoch", () => {
    const japan = indexCountries(rawCountries.filter(({ code }) => code === "JP"));
    expect(getCountryOfTheDay(japan, Date.parse("2025-12-01T00:00:00Z"))?.code).toBe("JP");
    expect(getCountryOfTheDay(indexCountries([]))).toBeNull();
  });
});
