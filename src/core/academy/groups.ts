import type { Continent, CountryCode } from "../countries";
import type { LearningGroup } from "./types";

type GroupDef = Omit<LearningGroup, "order">;

// Listed in suggested global order: famous starter units across every continent first, then
// regional units, then deep cuts. `order` is the array position.
const GROUP_DEFS: readonly GroupDef[] = [
  { id: "europe-big-names", title: "Europe's big names", blurb: "The heavyweights everyone has heard of", continent: "Europe", difficulty: 1, countryCodes: ["GB", "FR", "DE", "IT", "ES", "PT", "GR"] },
  { id: "north-america-headliners", title: "North America's headliners", blurb: "From the Arctic to the Caribbean's biggest island", continent: "North America", difficulty: 1, countryCodes: ["US", "CA", "MX", "CU", "JM"] },
  { id: "east-asia", title: "East Asia", blurb: "Giants, peninsulas and the Mongolian steppe", continent: "Asia", difficulty: 1, countryCodes: ["CN", "JP", "KR", "KP", "TW", "MN"] },
  { id: "south-america-big-names", title: "South America's big names", blurb: "Amazon, Andes and the Pampas", continent: "South America", difficulty: 1, countryCodes: ["BR", "AR", "CL", "CO", "PE", "VE"] },
  { id: "africa-big-names", title: "Africa's big names", blurb: "The continent's most famous faces, north to south", continent: "Africa", difficulty: 1, countryCodes: ["EG", "ZA", "NG", "KE", "MA", "ET"] },
  { id: "middle-east-headliners", title: "Middle East headliners", blurb: "Big names between the Mediterranean and the Gulf", continent: "Asia", difficulty: 1, countryCodes: ["TR", "SA", "AE", "IL", "IR", "IQ"] },
  { id: "alps-low-countries", title: "Alps & Low Countries", blurb: "Mountains, dykes and a pair of tiny monarchies", continent: "Europe", difficulty: 2, countryCodes: ["NL", "BE", "LU", "CH", "AT", "LI"] },
  { id: "down-under", title: "Down Under & Melanesia", blurb: "Australia, New Zealand and their nearest island neighbours", continent: "Oceania", difficulty: 2, countryCodes: ["AU", "NZ", "PG", "FJ", "SB", "VU"] },
  { id: "central-america", title: "Central America", blurb: "The land bridge between two continents", continent: "North America", difficulty: 2, countryCodes: ["GT", "BZ", "SV", "HN", "NI", "CR", "PA"] },
  { id: "northern-lights", title: "Northern lights", blurb: "Ireland, Iceland and the Nordic crosses", continent: "Europe", difficulty: 2, countryCodes: ["IE", "IS", "DK", "NO", "SE", "FI"] },
  { id: "south-asia", title: "South Asia", blurb: "The subcontinent, the Himalaya and the islands below", continent: "Asia", difficulty: 2, countryCodes: ["IN", "PK", "BD", "NP", "BT", "LK", "MV"] },
  { id: "north-africa", title: "North Africa", blurb: "Mediterranean coast and the Sahara's sands", continent: "Africa", difficulty: 2, countryCodes: ["DZ", "TN", "LY", "SD"] },
  { id: "mainland-southeast-asia", title: "The Mekong mainland", blurb: "Rice paddies and temples along the Mekong", continent: "Asia", difficulty: 2, countryCodes: ["TH", "VN", "KH", "LA", "MM"] },
  { id: "heart-of-europe", title: "Heart of Europe", blurb: "Castles and capitals in the middle of the map", continent: "Europe", difficulty: 2, countryCodes: ["PL", "CZ", "SK", "HU", "SI"] },
  { id: "caribbean-classics", title: "Caribbean classics", blurb: "Hispaniola, the Bahamas and the southern isles", continent: "North America", difficulty: 2, countryCodes: ["DO", "HT", "BS", "TT", "BB"] },
  { id: "hidden-south-america", title: "Hidden South America", blurb: "Andean highlands, river republics and the Guianas", continent: "South America", difficulty: 2, countryCodes: ["EC", "BO", "PY", "UY", "GY", "SR"] },
  { id: "southern-africa", title: "Southern Africa", blurb: "Savannah, deserts and Victoria Falls", continent: "Africa", difficulty: 2, countryCodes: ["NA", "BW", "ZW", "ZM", "MZ", "MW", "LS", "SZ"] },
  { id: "black-sea-and-east", title: "Black Sea & the East", blurb: "Russia, Ukraine and the lands round the Black Sea", continent: "Europe", difficulty: 2, countryCodes: ["RU", "UA", "MD", "RO", "BG"] },
  { id: "maritime-southeast-asia", title: "Islands & straits", blurb: "Thousands of islands across the equator", continent: "Asia", difficulty: 2, countryCodes: ["ID", "SG", "MY", "PH", "BN", "TL"] },
  { id: "gulf-of-guinea", title: "Gulf of Guinea", blurb: "Cocoa coast from Côte d'Ivoire to Cameroon", continent: "Africa", difficulty: 2, countryCodes: ["CI", "GH", "TG", "BJ", "CM"] },
  { id: "western-balkans", title: "The Balkans", blurb: "Mountains and Adriatic coastline", continent: "Europe", difficulty: 2, countryCodes: ["HR", "BA", "RS", "ME", "MK", "AL"] },
  { id: "gulf-states", title: "Gulf states", blurb: "Desert states of the Arabian Peninsula", continent: "Asia", difficulty: 2, countryCodes: ["QA", "KW", "BH", "OM", "YE"] },
  { id: "east-africa", title: "East Africa & the Horn", blurb: "Great Lakes, Rift Valley and the Horn of Africa", continent: "Africa", difficulty: 2, countryCodes: ["TZ", "UG", "RW", "BI", "SS", "SO", "ER", "DJ"] },
  { id: "baltics", title: "The Baltics & Belarus", blurb: "Amber coast and eastern forests", continent: "Europe", difficulty: 2, countryCodes: ["EE", "LV", "LT", "BY"] },
  { id: "levant-caucasus", title: "Levant & Caucasus", blurb: "Ancient crossroads from the Mediterranean to the Caspian", continent: "Asia", difficulty: 2, countryCodes: ["JO", "LB", "SY", "PS", "CY", "GE", "AM", "AZ"] },
  { id: "the-stans", title: "The Stans", blurb: "Silk Road nations of Central Asia", continent: "Asia", difficulty: 3, countryCodes: ["KZ", "UZ", "TM", "KG", "TJ", "AF"] },
  { id: "pocket-europe", title: "Pocket-sized Europe", blurb: "Microstates you could walk across in an afternoon", continent: "Europe", difficulty: 3, countryCodes: ["AD", "MC", "SM", "VA", "MT"] },
  { id: "sahel", title: "The Sahel", blurb: "The belt where the Sahara meets the savannah", continent: "Africa", difficulty: 3, countryCodes: ["MR", "ML", "BF", "NE", "TD"] },
  { id: "lesser-antilles", title: "Lesser Antilles", blurb: "The small island chain of the eastern Caribbean", continent: "North America", difficulty: 3, countryCodes: ["AG", "KN", "DM", "LC", "VC", "GD"] },
  { id: "central-africa", title: "Central Africa", blurb: "Rainforest heartland along the Congo River", continent: "Africa", difficulty: 3, countryCodes: ["CD", "CG", "GA", "GQ", "CF", "AO"] },
  { id: "west-african-coast", title: "Atlantic West Africa", blurb: "From Senegal round the bulge to Liberia", continent: "Africa", difficulty: 3, countryCodes: ["SN", "GM", "GW", "GN", "SL", "LR"] },
  { id: "african-islands", title: "Island Africa", blurb: "Madagascar and the island nations offshore", continent: "Africa", difficulty: 3, countryCodes: ["MG", "MU", "SC", "KM", "CV", "ST"] },
  { id: "pacific-islands", title: "Polynesia & Micronesia", blurb: "Atolls scattered across the open Pacific", continent: "Oceania", difficulty: 3, countryCodes: ["WS", "TO", "TV", "KI", "MH", "FM", "NR", "PW"] },
];

export const LEARNING_GROUPS: readonly LearningGroup[] = GROUP_DEFS.map((group, order) => ({ ...group, order }));

const GROUP_BY_ID = new Map(LEARNING_GROUPS.map((group) => [group.id, group]));
const GROUP_BY_COUNTRY = new Map<CountryCode, LearningGroup>(
  LEARNING_GROUPS.flatMap((group) => group.countryCodes.map((code) => [code, group] as const)),
);

/** Every country code covered by the Academy, in group order. */
export const ACADEMY_COUNTRY_CODES: readonly CountryCode[] = LEARNING_GROUPS.flatMap((group) => group.countryCodes);

export function findGroup(id: string): LearningGroup | undefined {
  return GROUP_BY_ID.get(id);
}

export function groupsForContinent(continent: Continent): readonly LearningGroup[] {
  return LEARNING_GROUPS.filter((group) => group.continent === continent);
}

export function groupForCountry(code: CountryCode): LearningGroup | undefined {
  return GROUP_BY_COUNTRY.get(code.toUpperCase());
}
