export interface DailyTheme {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly countryCodes: readonly string[];
  readonly mapTapTargetIds: readonly string[];
}

// Broad themes connect four country prompts and both finales without narrowing every answer.
export const DAILY_THEMES: readonly DailyTheme[] = [
  { id: "islands", title: "Island hopping", description: "Explore island nations, with a few stops elsewhere in the world.", countryCodes: ["GB", "IE", "IS", "JP", "ID", "PH", "LK", "NZ", "AU", "CU", "JM", "HT", "DO", "FJ", "MG", "MU", "MT", "CY", "SG", "WS", "TO"], mapTapTargetIds: ["sydney", "singapore", "sydney-opera-house", "great-barrier-reef"] },
  { id: "mediterranean", title: "Around the Mediterranean", description: "Follow the Mediterranean coast, then test your wider world knowledge.", countryCodes: ["ES", "FR", "IT", "GR", "TR", "EG", "MA", "DZ", "TN", "LY", "HR", "ME", "AL", "MT", "CY", "IL", "LB", "SY", "BA"], mapTapTargetIds: ["istanbul", "sagrada-familia", "colosseum", "cairo", "suez-canal"] },
  { id: "africa", title: "Across Africa", description: "Travel across Africa through flags, cities, shapes and landscapes.", countryCodes: ["ZA", "EG", "MA", "KE", "NG", "ET", "GH", "SN", "CI", "CM", "CD", "AO", "ZW", "ZM", "MZ", "MG", "TZ", "UG", "RW", "NA", "BW", "TN", "DZ"], mapTapTargetIds: ["serengeti", "cape-town", "cairo", "mount-kilimanjaro"] },
  { id: "southern", title: "Southern hemisphere", description: "Head south of the equator, with a few questions from further afield.", countryCodes: ["AU", "NZ", "ZA", "BR", "AR", "CL", "PE", "ID", "EC", "BO", "PY", "UY", "NA", "BW", "MZ", "MG", "TZ", "ZW", "ZM", "AO", "FJ", "PG"], mapTapTargetIds: ["buenos-aires", "great-barrier-reef", "machu-picchu", "rio-de-janeiro", "sydney"] },
  { id: "asia", title: "Across Asia", description: "Discover Asia's countries and places, alongside a few global wildcards.", countryCodes: ["JP", "CN", "IN", "KR", "TH", "ID", "SG", "VN", "PH", "MY", "KH", "LA", "MN", "NP", "LK", "BD", "KZ", "UZ", "PK", "AE", "JO", "OM"], mapTapTargetIds: ["seoul", "mumbai", "angkor-wat", "tokyo", "taj-mahal"] },
  { id: "americas", title: "The Americas", description: "Journey from North to South America, with a few detours around the globe.", countryCodes: ["US", "CA", "MX", "BR", "AR", "CL", "CO", "PE", "CU", "VE", "EC", "BO", "PY", "UY", "CR", "PA", "GT", "HN", "NI", "SV", "BZ", "JM", "DO", "HT"], mapTapTargetIds: ["mexico-city", "buenos-aires", "machu-picchu", "new-york-city", "rio-de-janeiro"] },
  { id: "europe", title: "A European journey", description: "Explore Europe's countries and landmarks, plus a few stops beyond its borders.", countryCodes: ["GB", "FR", "DE", "IT", "ES", "PT", "NL", "BE", "CH", "AT", "PL", "GR", "IE", "DK", "SE", "NO", "FI", "CZ", "HU", "RO", "HR", "RS", "BG", "IS", "EE", "LV", "LT"], mapTapTargetIds: ["sagrada-familia", "stonehenge", "eiffel-tower", "colosseum", "london"] },
];

export function dailyThemeForDate(date: string): DailyTheme {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const position = Number.isFinite(day) ? ((day % DAILY_THEMES.length) + DAILY_THEMES.length) % DAILY_THEMES.length : 0;
  return DAILY_THEMES[position]!;
}
