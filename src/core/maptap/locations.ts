import type { MapTapCategory, MapTapDifficulty, MapTapLocation, MapTapRoundTarget } from "./types";

export const MAP_TAP_LOCATIONS: readonly MapTapLocation[] = [
  // Cities
  { id: "tokyo", name: "Tokyo", category: "city", lat: 35.6762, lng: 139.6503, difficulty: "easy", wikiSlug: "Tokyo" },
  { id: "cape-town", name: "Cape Town", category: "city", lat: -33.9249, lng: 18.4241, difficulty: "easy", wikiSlug: "Cape_Town" },
  { id: "new-york-city", name: "New York City", category: "city", lat: 40.7128, lng: -74.0060, difficulty: "easy", wikiSlug: "New_York_City" },
  { id: "london", name: "London", category: "city", lat: 51.5074, lng: -0.1278, difficulty: "easy", wikiSlug: "London" },
  { id: "paris", name: "Paris", category: "city", lat: 48.8566, lng: 2.3522, difficulty: "easy", wikiSlug: "Paris" },
  { id: "rio-de-janeiro", name: "Rio de Janeiro", category: "city", lat: -22.9068, lng: -43.1729, difficulty: "easy", wikiSlug: "Rio_de_Janeiro" },
  { id: "sydney", name: "Sydney", category: "city", lat: -33.8688, lng: 151.2093, difficulty: "easy", wikiSlug: "Sydney" },
  { id: "cairo", name: "Cairo", category: "city", lat: 30.0444, lng: 31.2357, difficulty: "easy", wikiSlug: "Cairo" },
  { id: "singapore", name: "Singapore", category: "city", lat: 1.3521, lng: 103.8198, difficulty: "easy", wikiSlug: "Singapore" },
  { id: "dubai", name: "Dubai", category: "city", lat: 25.2048, lng: 55.2708, difficulty: "easy", wikiSlug: "Dubai" },
  { id: "istanbul", name: "Istanbul", category: "city", lat: 41.0082, lng: 28.9784, difficulty: "medium", wikiSlug: "Istanbul" },
  { id: "buenos-aires", name: "Buenos Aires", category: "city", lat: -34.6037, lng: -58.3816, difficulty: "medium", wikiSlug: "Buenos_Aires" },
  { id: "mexico-city", name: "Mexico City", category: "city", lat: 19.4326, lng: -99.1332, difficulty: "medium", wikiSlug: "Mexico_City" },
  { id: "seoul", name: "Seoul", category: "city", lat: 37.5665, lng: 126.9780, difficulty: "medium", wikiSlug: "Seoul" },
  { id: "mumbai", name: "Mumbai", category: "city", lat: 19.0760, lng: 72.8777, difficulty: "medium", wikiSlug: "Mumbai" },
  { id: "lagos", name: "Lagos", category: "city", lat: 6.5244, lng: 3.3792, difficulty: "hard", wikiSlug: "Lagos" },
  { id: "ulanbaatar", name: "Ulaanbaatar", category: "city", lat: 47.8864, lng: 106.9057, difficulty: "hard", wikiSlug: "Ulaanbaatar" },
  { id: "reykjavik", name: "Reykjavík", category: "city", lat: 64.1466, lng: -21.9426, difficulty: "hard", wikiSlug: "Reykjavík" },

  // Mountains and mountain ranges
  { id: "mount-kilimanjaro", name: "Mount Kilimanjaro", category: "mountain", lat: -3.0674, lng: 37.3556, difficulty: "easy", wikiSlug: "Mount_Kilimanjaro" },
  { id: "andes-central", name: "The Andes", category: "mountain", lat: -32.6532, lng: -70.0112, difficulty: "medium", wikiSlug: "Andes" },
  { id: "mount-fuji", name: "Mount Fuji", category: "mountain", lat: 35.3606, lng: 138.7274, difficulty: "easy", wikiSlug: "Mount_Fuji" },
  { id: "mount-everest", name: "Mount Everest", category: "mountain", lat: 27.9881, lng: 86.9250, difficulty: "easy", wikiSlug: "Mount_Everest" },
  { id: "matterhorn", name: "Matterhorn", category: "mountain", lat: 45.9763, lng: 7.6586, difficulty: "medium", wikiSlug: "Matterhorn" },
  { id: "denali", name: "Denali", category: "mountain", lat: 63.0695, lng: -151.0074, difficulty: "medium", wikiSlug: "Denali" },
  { id: "mont-blanc", name: "Mont Blanc", category: "mountain", lat: 45.8326, lng: 6.8652, difficulty: "medium", wikiSlug: "Mont_Blanc" },
  { id: "table-mountain", name: "Table Mountain", category: "mountain", lat: -33.9628, lng: 18.4098, difficulty: "medium", wikiSlug: "Table_Mountain" },
  { id: "mount-etna", name: "Mount Etna", category: "mountain", lat: 37.7510, lng: 14.9934, difficulty: "medium", wikiSlug: "Mount_Etna" },
  { id: "rocky-mountains", name: "The Rocky Mountains", category: "mountain", lat: 39.7392, lng: -105.9903, difficulty: "hard", wikiSlug: "Rocky_Mountains" },
  { id: "atlas-mountains", name: "Atlas Mountains", category: "mountain", lat: 31.0594, lng: -7.9159, difficulty: "hard", wikiSlug: "Atlas_Mountains" },
  { id: "drakensberg", name: "Drakensberg", category: "mountain", lat: -29.3833, lng: 29.4500, difficulty: "hard", wikiSlug: "Drakensberg" },
  { id: "mount-elbrus", name: "Mount Elbrus", category: "mountain", lat: 43.3499, lng: 42.4453, difficulty: "hard", wikiSlug: "Mount_Elbrus" },
  { id: "mauna-kea", name: "Mauna Kea", category: "mountain", lat: 19.8207, lng: -155.4681, difficulty: "hard", wikiSlug: "Mauna_Kea" },

  // Points of interest and natural features
  { id: "petra", name: "Petra", category: "poi", lat: 30.3285, lng: 35.4444, difficulty: "medium", wikiSlug: "Petra" },
  { id: "pyramids-of-giza", name: "Pyramids of Giza", category: "poi", lat: 29.9792, lng: 31.1342, difficulty: "easy", wikiSlug: "Giza_pyramid_complex" },
  { id: "grand-canyon", name: "Grand Canyon", category: "poi", lat: 36.1069, lng: -112.1129, difficulty: "easy", wikiSlug: "Grand_Canyon" },
  { id: "victoria-falls", name: "Victoria Falls", category: "poi", lat: -17.9243, lng: 25.8572, difficulty: "easy", wikiSlug: "Victoria_Falls" },
  { id: "niagara-falls", name: "Niagara Falls", category: "poi", lat: 43.0962, lng: -79.0377, difficulty: "easy", wikiSlug: "Niagara_Falls" },
  { id: "great-barrier-reef", name: "Great Barrier Reef", category: "poi", lat: -18.2871, lng: 147.6992, difficulty: "medium", wikiSlug: "Great_Barrier_Reef" },
  { id: "yellowstone", name: "Yellowstone", category: "poi", lat: 44.4280, lng: -110.5885, difficulty: "medium", wikiSlug: "Yellowstone_National_Park" },
  { id: "serengeti", name: "Serengeti", category: "poi", lat: -2.3333, lng: 34.8333, difficulty: "medium", wikiSlug: "Serengeti" },
  { id: "lake-baikal", name: "Lake Baikal", category: "poi", lat: 53.5587, lng: 108.1650, difficulty: "medium", wikiSlug: "Lake_Baikal" },
  { id: "dead-sea", name: "Dead Sea", category: "poi", lat: 31.5590, lng: 35.4732, difficulty: "medium", wikiSlug: "Dead_Sea" },
  { id: "galapagos-islands", name: "Galápagos Islands", category: "poi", lat: -0.9538, lng: -90.9656, difficulty: "hard", wikiSlug: "Galápagos_Islands" },
  { id: "amazon-rainforest", name: "Amazon Rainforest", category: "poi", lat: -3.4653, lng: -62.2159, difficulty: "hard", wikiSlug: "Amazon_rainforest" },
  { id: "salar-de-uyuni", name: "Salar de Uyuni", category: "poi", lat: -20.1338, lng: -67.4891, difficulty: "hard", wikiSlug: "Salar_de_Uyuni" },
  { id: "suez-canal", name: "Suez Canal", category: "poi", lat: 30.5852, lng: 32.2654, difficulty: "hard", wikiSlug: "Suez_Canal" },
  { id: "panama-canal", name: "Panama Canal", category: "poi", lat: 9.0801, lng: -79.6804, difficulty: "hard", wikiSlug: "Panama_Canal" },

  // Famous landmarks
  { id: "eiffel-tower", name: "Eiffel Tower", category: "landmark", lat: 48.8584, lng: 2.2945, difficulty: "easy", wikiSlug: "Eiffel_Tower" },
  { id: "taj-mahal", name: "Taj Mahal", category: "landmark", lat: 27.1751, lng: 78.0421, difficulty: "easy", wikiSlug: "Taj_Mahal" },
  { id: "machu-picchu", name: "Machu Picchu", category: "landmark", lat: -13.1631, lng: -72.5450, difficulty: "medium", wikiSlug: "Machu_Picchu" },
  { id: "uluru", name: "Uluru", category: "landmark", lat: -25.3444, lng: 131.0369, difficulty: "hard", wikiSlug: "Uluru" },
  { id: "statue-of-liberty", name: "Statue of Liberty", category: "landmark", lat: 40.6892, lng: -74.0445, difficulty: "easy", wikiSlug: "Statue_of_Liberty" },
  { id: "colosseum", name: "Colosseum", category: "landmark", lat: 41.8902, lng: 12.4922, difficulty: "easy", wikiSlug: "Colosseum" },
  { id: "great-wall-china", name: "Great Wall of China", category: "landmark", lat: 40.4319, lng: 116.5704, difficulty: "easy", wikiSlug: "Great_Wall_of_China" },
  { id: "christ-the-redeemer", name: "Christ the Redeemer", category: "landmark", lat: -22.9519, lng: -43.2105, difficulty: "easy", wikiSlug: "Christ_the_Redeemer_(statue)" },
  { id: "burj-khalifa", name: "Burj Khalifa", category: "landmark", lat: 25.1972, lng: 55.2744, difficulty: "easy", wikiSlug: "Burj_Khalifa" },
  { id: "sydney-opera-house", name: "Sydney Opera House", category: "landmark", lat: -33.8568, lng: 151.2153, difficulty: "easy", wikiSlug: "Sydney_Opera_House" },
  { id: "angkor-wat", name: "Angkor Wat", category: "landmark", lat: 13.4125, lng: 103.8670, difficulty: "medium", wikiSlug: "Angkor_Wat" },
  { id: "chichen-itza", name: "Chichén Itzá", category: "landmark", lat: 20.6843, lng: -88.5678, difficulty: "medium", wikiSlug: "Chichen_Itza" },
  { id: "stonehenge", name: "Stonehenge", category: "landmark", lat: 51.1789, lng: -1.8262, difficulty: "medium", wikiSlug: "Stonehenge" },
  { id: "sagrada-familia", name: "Sagrada Família", category: "landmark", lat: 41.4036, lng: 2.1744, difficulty: "medium", wikiSlug: "Sagrada_Família" },
  { id: "golden-gate-bridge", name: "Golden Gate Bridge", category: "landmark", lat: 37.8199, lng: -122.4783, difficulty: "medium", wikiSlug: "Golden_Gate_Bridge" },
  { id: "acropolis", name: "Acropolis of Athens", category: "landmark", lat: 37.9715, lng: 23.7257, difficulty: "medium", wikiSlug: "Acropolis_of_Athens" },
  { id: "neuschwanstein", name: "Neuschwanstein Castle", category: "landmark", lat: 47.5576, lng: 10.7498, difficulty: "hard", wikiSlug: "Neuschwanstein_Castle" },
  { id: "mount-rushmore", name: "Mount Rushmore", category: "landmark", lat: 43.8791, lng: -103.4591, difficulty: "hard", wikiSlug: "Mount_Rushmore" },
  { id: "marina-bay-sands", name: "Marina Bay Sands", category: "landmark", lat: 1.2834, lng: 103.8607, difficulty: "hard", wikiSlug: "Marina_Bay_Sands" },
  { id: "st-basils-cathedral", name: "St. Basil's Cathedral", category: "landmark", lat: 55.7525, lng: 37.6231, difficulty: "hard", wikiSlug: "Saint_Basil's_Cathedral" },
] as const;

export function toMapTapRoundTarget(location: MapTapLocation): MapTapRoundTarget {
  const { id, name, category, difficulty } = location;
  return { id, name, category, difficulty };
}

export function findMapTapLocation(id: string): MapTapLocation | null {
  return MAP_TAP_LOCATIONS.find((location) => location.id === id) ?? null;
}

export function filterMapTapLocations(input: { readonly category?: string | null; readonly difficulty?: string | null }): readonly MapTapLocation[] {
  return MAP_TAP_LOCATIONS.filter((location) => {
    const categoryOk = input.category ? location.category === input.category : true;
    const difficultyOk = input.difficulty ? location.difficulty === input.difficulty : true;
    return categoryOk && difficultyOk;
  });
}

export function isMapTapCategory(value: string): value is MapTapCategory {
  return ["city", "mountain", "poi", "landmark"].includes(value);
}

export function isMapTapDifficulty(value: string): value is MapTapDifficulty {
  return ["easy", "medium", "hard"].includes(value);
}
