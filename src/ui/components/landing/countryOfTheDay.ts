import type { Country, CountryIndex } from "../../../core/countries";

interface DailyCountryFact {
  readonly code: string;
  readonly fact: string;
  readonly source: string;
  readonly sourceName: string;
}

// Short, hand-checked facts rather than generated trivia. Sources checked 2026-10-04.
// Keep the order stable: every visitor gets the same feature on the same UTC day.
export const DAILY_COUNTRY_FACTS: readonly DailyCountryFact[] = [
  { code: "BW", fact: "The Okavango Delta floods during the dry season. Instead of reaching the ocean, its waters spread into the sands of the Kalahari.", source: "https://whc.unesco.org/en/list/1432/", sourceName: "UNESCO" },
  { code: "JP", fact: "On the island of Yakushima, a forest of Japanese cedars includes trees over 1,000 years old. Some have been growing for thousands of years.", source: "https://whc.unesco.org/en/list/662/", sourceName: "UNESCO" },
  { code: "IT", fact: "Padua’s university botanical garden was founded in 1545. It still has its original circular layout and continues to support scientific research.", source: "https://whc.unesco.org/en/list/824/", sourceName: "UNESCO" },
  { code: "CN", fact: "Fujian’s tulou are giant earthen homes built around a shared courtyard. A single building could house an entire clan of up to 800 people.", source: "https://whc.unesco.org/en/list/1113/", sourceName: "UNESCO" },
  { code: "NA", fact: "In the Namib Sand Sea, fog is the main source of water. Life among these enormous desert dunes depends on moisture drifting in from the ocean.", source: "https://whc.unesco.org/en/list/1430/", sourceName: "UNESCO" },
  { code: "NO", fact: "Norway’s Svalbard Global Seed Vault stores backup copies of crop seeds from gene banks around the world, deep inside an Arctic mountain.", source: "https://www.regjeringen.no/en/topics/food-fisheries-and-agriculture/svalbard-global-seed-vault/mer-om-det-fysiske-anlegget/id2365142/", sourceName: "Norwegian government" },
  { code: "NZ", fact: "In 1993, Tongariro became the first UNESCO World Heritage site listed under its cultural landscape criteria, recognising the mountains’ significance to Māori.", source: "https://whc.unesco.org/en/list/421/", sourceName: "UNESCO" },
  { code: "MX", fact: "Xochimilco’s canals surround artificial islands called chinampas, built for farming. They preserve a way of growing food from before Spanish colonisation.", source: "https://whc.unesco.org/en/list/412/", sourceName: "UNESCO" },
  { code: "TR", fact: "Hunter-gatherers built Göbekli Tepe’s monumental stone enclosures as early as 9600 BCE. Its distinctive T-shaped pillars are carved with wild animals.", source: "https://whc.unesco.org/en/list/1572/", sourceName: "UNESCO" },
  { code: "AU", fact: "Shark Bay has living stromatolites: rock-like structures built by microbes. They offer a glimpse of marine ecosystems from over three billion years ago.", source: "https://whc.unesco.org/en/list/578/", sourceName: "UNESCO" },
  { code: "UY", fact: "A former meat factory in Fray Bentos is a UNESCO World Heritage site. It once shipped corned beef and meat extract from Uruguay to Europe.", source: "https://whc.unesco.org/en/list/1464/", sourceName: "UNESCO" },
  { code: "AR", fact: "Patagonia’s Cave of the Hands preserves stencilled human hands alongside hunting scenes. Its cave art dates back as far as 13,000 years.", source: "https://whc.unesco.org/en/list/936/", sourceName: "UNESCO" },
];

export const UTC_DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2026, 0, 1);

export interface CountryOfTheDay extends DailyCountryFact {
  readonly country: Country;
}

export function getCountryOfTheDay(countryIndex: CountryIndex, now = Date.now()): CountryOfTheDay | null {
  const available = DAILY_COUNTRY_FACTS.filter(({ code }) => countryIndex.byCode.has(code));
  if (!available.length) return null;
  const day = Math.floor((now - EPOCH) / UTC_DAY_MS);
  const feature = available[((day % available.length) + available.length) % available.length]!;
  return { ...feature, country: countryIndex.byCode.get(feature.code)! };
}
