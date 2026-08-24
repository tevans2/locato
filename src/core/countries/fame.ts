// Rough "how likely is a casual player to recognize this country" ranking, used to ease new
// players in: early solo rounds draw from famous countries first, then widen out.
// Tier 1 — globally famous; Tier 2 — regionally familiar; everything else is Tier 3.
export const FAME_TIER_1_CODES: readonly string[] = [
  "US", "CA", "MX", "BR", "AR", "GB", "FR", "DE", "IT", "ES", "PT", "NL", "BE", "CH", "AT",
  "PL", "GR", "RU", "UA", "TR", "CN", "JP", "KR", "IN", "TH", "SG", "ID", "AU", "NZ",
  "EG", "ZA", "NG", "KE", "MA", "ET", "SA", "AE", "IL", "IR", "IQ", "CU", "PE", "VE", "CL", "CO",
];

export const FAME_TIER_2_CODES: readonly string[] = [
  "HU", "CZ", "SK", "RO", "BG", "HR", "RS", "BA", "SI", "ME", "MK", "AL", "LT", "LV", "EE",
  "BY", "MD", "LU", "MC", "AD", "MT", "CY", "IS", "IE", "DK", "SE", "NO", "FI",
  "GE", "AM", "AZ", "KZ", "UZ", "MN", "NP", "LK", "BD", "MM", "KH", "LA", "VN", "PH", "MY",
  "PK", "AF", "SY", "JO", "LB", "QA", "KW", "OM", "YE", "BH",
  "DZ", "TN", "LY", "SD", "GH", "SN", "CI", "CM", "CD", "AO", "ZW", "ZM", "MZ", "MG", "UG",
  "TZ", "RW", "SO", "ML", "BF", "GA", "NA", "BW", "MU", "SC", "MR",
  "PA", "CR", "DO", "HT", "JM", "TT", "BS", "BB", "GY", "SR", "EC", "BO", "PY", "UY", "HN", "GT", "SV", "NI", "BZ",
  "FJ", "PG", "WS", "TO", "TW",
];

export type FameTier = 1 | 2 | 3;

export function fameTier(code: string): FameTier {
  if (FAME_TIER_1_CODES.includes(code)) return 1;
  if (FAME_TIER_2_CODES.includes(code)) return 2;
  return 3;
}
