import type { MapTapCategory, MapTapDifficulty, MapTapLocation, MapTapRoundTarget } from "./types";

export const MAP_TAP_CATEGORY_OPTIONS: readonly { readonly value: MapTapCategory; readonly label: string; readonly description: string }[] = [
  { value: "city", label: "Cities", description: "Capitals and major cities" },
  { value: "region", label: "Regions", description: "Famous areas of the world" },
  { value: "mountain", label: "Mountains", description: "Iconic summits and peaks" },
  { value: "mountain-range", label: "Mountain ranges", description: "The world's great ranges" },
  { value: "ocean", label: "Oceans & seas", description: "Open water around the globe" },
  { value: "poi", label: "Natural wonders", description: "Deserts, lakes and wild places" },
  { value: "landmark", label: "Landmarks", description: "Famous human-made places" },
];

export const MAP_TAP_CATEGORIES: readonly MapTapCategory[] = MAP_TAP_CATEGORY_OPTIONS.map((category) => category.value);

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
  { id: "andes-central", name: "The Andes", category: "mountain-range", lat: -32.6532, lng: -70.0112, difficulty: "medium", wikiSlug: "Andes" },
  { id: "mount-fuji", name: "Mount Fuji", category: "mountain", lat: 35.3606, lng: 138.7274, difficulty: "easy", wikiSlug: "Mount_Fuji" },
  { id: "mount-everest", name: "Mount Everest", category: "mountain", lat: 27.9881, lng: 86.9250, difficulty: "easy", wikiSlug: "Mount_Everest" },
  { id: "matterhorn", name: "Matterhorn", category: "mountain", lat: 45.9763, lng: 7.6586, difficulty: "medium", wikiSlug: "Matterhorn" },
  { id: "denali", name: "Denali", category: "mountain", lat: 63.0695, lng: -151.0074, difficulty: "medium", wikiSlug: "Denali" },
  { id: "mont-blanc", name: "Mont Blanc", category: "mountain", lat: 45.8326, lng: 6.8652, difficulty: "medium", wikiSlug: "Mont_Blanc" },
  { id: "table-mountain", name: "Table Mountain", category: "mountain", lat: -33.9628, lng: 18.4098, difficulty: "medium", wikiSlug: "Table_Mountain" },
  { id: "mount-etna", name: "Mount Etna", category: "mountain", lat: 37.7510, lng: 14.9934, difficulty: "medium", wikiSlug: "Mount_Etna" },
  { id: "rocky-mountains", name: "The Rocky Mountains", category: "mountain-range", lat: 39.7392, lng: -105.9903, difficulty: "hard", wikiSlug: "Rocky_Mountains" },
  { id: "atlas-mountains", name: "Atlas Mountains", category: "mountain-range", lat: 31.0594, lng: -7.9159, difficulty: "hard", wikiSlug: "Atlas_Mountains" },
  { id: "drakensberg", name: "Drakensberg", category: "mountain-range", lat: -29.3833, lng: 29.4500, difficulty: "hard", wikiSlug: "Drakensberg" },
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

  // More world cities
  { id: "toronto", name: "Toronto", category: "city", lat: 43.6532, lng: -79.3832, difficulty: "easy", wikiSlug: "Toronto" },
  { id: "san-francisco", name: "San Francisco", category: "city", lat: 37.7749, lng: -122.4194, difficulty: "easy", wikiSlug: "San_Francisco" },
  { id: "rome", name: "Rome", category: "city", lat: 41.9028, lng: 12.4964, difficulty: "easy", wikiSlug: "Rome" },
  { id: "beijing", name: "Beijing", category: "city", lat: 39.9042, lng: 116.4074, difficulty: "easy", wikiSlug: "Beijing" },
  { id: "nairobi", name: "Nairobi", category: "city", lat: -1.2921, lng: 36.8219, difficulty: "medium", wikiSlug: "Nairobi" },
  { id: "bangkok", name: "Bangkok", category: "city", lat: 13.7563, lng: 100.5018, difficulty: "medium", wikiSlug: "Bangkok" },
  { id: "jakarta", name: "Jakarta", category: "city", lat: -6.2088, lng: 106.8456, difficulty: "medium", wikiSlug: "Jakarta" },
  { id: "lima", name: "Lima", category: "city", lat: -12.0464, lng: -77.0428, difficulty: "medium", wikiSlug: "Lima" },
  { id: "berlin", name: "Berlin", category: "city", lat: 52.5200, lng: 13.4050, difficulty: "medium", wikiSlug: "Berlin" },
  { id: "madrid", name: "Madrid", category: "city", lat: 40.4168, lng: -3.7038, difficulty: "medium", wikiSlug: "Madrid" },
  { id: "addis-ababa", name: "Addis Ababa", category: "city", lat: 8.9806, lng: 38.7578, difficulty: "hard", wikiSlug: "Addis_Ababa" },
  { id: "samarkand", name: "Samarkand", category: "city", lat: 39.6542, lng: 66.9597, difficulty: "hard", wikiSlug: "Samarkand" },
  { id: "auckland", name: "Auckland", category: "city", lat: -36.8509, lng: 174.7645, difficulty: "hard", wikiSlug: "Auckland" },
  { id: "casablanca", name: "Casablanca", category: "city", lat: 33.5731, lng: -7.5898, difficulty: "hard", wikiSlug: "Casablanca" },
  { id: "havana", name: "Havana", category: "city", lat: 23.1136, lng: -82.3666, difficulty: "hard", wikiSlug: "Havana" },

  // Broad geographic regions (coordinates use a representative centre)
  { id: "patagonia", name: "Patagonia", category: "region", lat: -46.5, lng: -70.0, difficulty: "easy", wikiSlug: "Patagonia" },
  { id: "sahara", name: "The Sahara", category: "region", lat: 23.4, lng: 13.0, difficulty: "easy", wikiSlug: "Sahara" },
  { id: "scandinavia", name: "Scandinavia", category: "region", lat: 62.0, lng: 15.0, difficulty: "easy", wikiSlug: "Scandinavia" },
  { id: "siberia", name: "Siberia", category: "region", lat: 61.0, lng: 105.0, difficulty: "medium", wikiSlug: "Siberia" },
  { id: "balkans", name: "The Balkans", category: "region", lat: 42.5, lng: 22.0, difficulty: "medium", wikiSlug: "Balkans" },
  { id: "sahel", name: "The Sahel", category: "region", lat: 15.0, lng: 5.0, difficulty: "medium", wikiSlug: "Sahel" },
  { id: "levant", name: "The Levant", category: "region", lat: 33.5, lng: 36.0, difficulty: "medium", wikiSlug: "Levant" },
  { id: "mesopotamia", name: "Mesopotamia", category: "region", lat: 33.0, lng: 44.0, difficulty: "medium", wikiSlug: "Mesopotamia" },
  { id: "outback", name: "The Australian Outback", category: "region", lat: -25.0, lng: 133.0, difficulty: "medium", wikiSlug: "Outback" },
  { id: "great-plains", name: "The Great Plains", category: "region", lat: 41.0, lng: -101.0, difficulty: "hard", wikiSlug: "Great_Plains" },
  { id: "horn-of-africa", name: "The Horn of Africa", category: "region", lat: 8.0, lng: 48.0, difficulty: "hard", wikiSlug: "Horn_of_Africa" },
  { id: "caucasus", name: "The Caucasus", category: "region", lat: 42.25, lng: 44.0, difficulty: "hard", wikiSlug: "Caucasus" },
  { id: "punjab", name: "Punjab", category: "region", lat: 31.0, lng: 74.0, difficulty: "hard", wikiSlug: "Punjab" },
  { id: "maghreb", name: "The Maghreb", category: "region", lat: 29.0, lng: 3.0, difficulty: "hard", wikiSlug: "Maghreb" },
  { id: "polynesia", name: "Polynesia", category: "region", lat: -16.0, lng: -151.0, difficulty: "hard", wikiSlug: "Polynesia" },

  // Mountain ranges
  { id: "himalayas", name: "The Himalayas", category: "mountain-range", lat: 28.0, lng: 84.0, difficulty: "easy", wikiSlug: "Himalayas" },
  { id: "alps", name: "The Alps", category: "mountain-range", lat: 46.5, lng: 10.5, difficulty: "easy", wikiSlug: "Alps" },
  { id: "appalachians", name: "The Appalachian Mountains", category: "mountain-range", lat: 38.0, lng: -79.0, difficulty: "medium", wikiSlug: "Appalachian_Mountains" },
  { id: "ural-mountains", name: "The Ural Mountains", category: "mountain-range", lat: 60.0, lng: 59.0, difficulty: "medium", wikiSlug: "Ural_Mountains" },
  { id: "carpathians", name: "The Carpathian Mountains", category: "mountain-range", lat: 47.0, lng: 25.5, difficulty: "medium", wikiSlug: "Carpathian_Mountains" },
  { id: "great-dividing-range", name: "The Great Dividing Range", category: "mountain-range", lat: -25.0, lng: 148.0, difficulty: "medium", wikiSlug: "Great_Dividing_Range" },
  { id: "tian-shan", name: "The Tian Shan", category: "mountain-range", lat: 42.0, lng: 80.0, difficulty: "hard", wikiSlug: "Tian_Shan" },
  { id: "altai-mountains", name: "The Altai Mountains", category: "mountain-range", lat: 49.0, lng: 89.0, difficulty: "hard", wikiSlug: "Altai_Mountains" },
  { id: "zagros-mountains", name: "The Zagros Mountains", category: "mountain-range", lat: 32.5, lng: 47.0, difficulty: "hard", wikiSlug: "Zagros_Mountains" },
  { id: "southern-alps-nz", name: "New Zealand's Southern Alps", category: "mountain-range", lat: -43.6, lng: 170.2, difficulty: "hard", wikiSlug: "Southern_Alps" },
  { id: "cascades", name: "The Cascade Range", category: "mountain-range", lat: 45.0, lng: -121.0, difficulty: "hard", wikiSlug: "Cascade_Range" },
  { id: "ethiopian-highlands", name: "The Ethiopian Highlands", category: "mountain-range", lat: 12.5, lng: 39.5, difficulty: "hard", wikiSlug: "Ethiopian_Highlands" },

  // Oceans and major seas (coordinates use a representative centre)
  { id: "pacific-ocean", name: "Pacific Ocean", category: "ocean", lat: 0.0, lng: -155.0, difficulty: "easy", wikiSlug: "Pacific_Ocean" },
  { id: "atlantic-ocean", name: "Atlantic Ocean", category: "ocean", lat: 0.0, lng: -30.0, difficulty: "easy", wikiSlug: "Atlantic_Ocean" },
  { id: "indian-ocean", name: "Indian Ocean", category: "ocean", lat: -20.0, lng: 80.0, difficulty: "easy", wikiSlug: "Indian_Ocean" },
  { id: "arctic-ocean", name: "Arctic Ocean", category: "ocean", lat: 82.0, lng: 0.0, difficulty: "medium", wikiSlug: "Arctic_Ocean" },
  { id: "southern-ocean", name: "Southern Ocean", category: "ocean", lat: -65.0, lng: 30.0, difficulty: "medium", wikiSlug: "Southern_Ocean" },
  { id: "mediterranean-sea", name: "Mediterranean Sea", category: "ocean", lat: 35.0, lng: 18.0, difficulty: "easy", wikiSlug: "Mediterranean_Sea" },
  { id: "caribbean-sea", name: "Caribbean Sea", category: "ocean", lat: 15.0, lng: -75.0, difficulty: "medium", wikiSlug: "Caribbean_Sea" },
  { id: "south-china-sea", name: "South China Sea", category: "ocean", lat: 12.0, lng: 114.0, difficulty: "medium", wikiSlug: "South_China_Sea" },
  { id: "bering-sea", name: "Bering Sea", category: "ocean", lat: 58.0, lng: -178.0, difficulty: "hard", wikiSlug: "Bering_Sea" },
  { id: "coral-sea", name: "Coral Sea", category: "ocean", lat: -18.0, lng: 155.0, difficulty: "hard", wikiSlug: "Coral_Sea" },
  { id: "arabian-sea", name: "Arabian Sea", category: "ocean", lat: 15.0, lng: 65.0, difficulty: "hard", wikiSlug: "Arabian_Sea" },
  { id: "sea-of-japan", name: "Sea of Japan", category: "ocean", lat: 40.0, lng: 135.0, difficulty: "hard", wikiSlug: "Sea_of_Japan" },

  // More natural wonders and geographic features
  { id: "okavango-delta", name: "Okavango Delta", category: "poi", lat: -19.25, lng: 22.75, difficulty: "medium", wikiSlug: "Okavango_Delta" },
  { id: "gobi-desert", name: "Gobi Desert", category: "poi", lat: 42.5, lng: 103.0, difficulty: "medium", wikiSlug: "Gobi_Desert" },
  { id: "lake-titicaca", name: "Lake Titicaca", category: "poi", lat: -15.8, lng: -69.4, difficulty: "medium", wikiSlug: "Lake_Titicaca" },
  { id: "angel-falls", name: "Angel Falls", category: "poi", lat: 5.9675, lng: -62.5356, difficulty: "hard", wikiSlug: "Angel_Falls" },
  { id: "namib-desert", name: "Namib Desert", category: "poi", lat: -24.75, lng: 15.3, difficulty: "hard", wikiSlug: "Namib" },
  { id: "danube-delta", name: "Danube Delta", category: "poi", lat: 45.2, lng: 29.3, difficulty: "hard", wikiSlug: "Danube_Delta" },
  { id: "fjord-geiranger", name: "Geirangerfjord", category: "poi", lat: 62.1, lng: 7.1, difficulty: "hard", wikiSlug: "Geirangerfjord" },
  { id: "socotra", name: "Socotra", category: "poi", lat: 12.46, lng: 53.82, difficulty: "hard", wikiSlug: "Socotra" },

  // More landmarks
  { id: "moai-easter-island", name: "Moai of Easter Island", category: "landmark", lat: -27.125, lng: -109.277, difficulty: "medium", wikiSlug: "Moai" },
  { id: "hagia-sophia", name: "Hagia Sophia", category: "landmark", lat: 41.0086, lng: 28.9802, difficulty: "medium", wikiSlug: "Hagia_Sophia" },
  { id: "forbidden-city", name: "Forbidden City", category: "landmark", lat: 39.9163, lng: 116.3972, difficulty: "medium", wikiSlug: "Forbidden_City" },
  { id: "alhambra", name: "Alhambra", category: "landmark", lat: 37.1761, lng: -3.5881, difficulty: "hard", wikiSlug: "Alhambra" },
  { id: "bagan", name: "Bagan", category: "landmark", lat: 21.1717, lng: 94.8585, difficulty: "hard", wikiSlug: "Bagan" },
  { id: "temple-of-heaven", name: "Temple of Heaven", category: "landmark", lat: 39.8822, lng: 116.4066, difficulty: "hard", wikiSlug: "Temple_of_Heaven" },
  { id: "mont-saint-michel", name: "Mont-Saint-Michel", category: "landmark", lat: 48.6361, lng: -1.5115, difficulty: "hard", wikiSlug: "Mont-Saint-Michel" },
  { id: "lotus-temple", name: "Lotus Temple", category: "landmark", lat: 28.5535, lng: 77.2588, difficulty: "hard", wikiSlug: "Lotus_Temple" },
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
  return MAP_TAP_CATEGORIES.includes(value as MapTapCategory);
}

export function resolveMapTapCategories(values?: readonly string[]): readonly MapTapCategory[] {
  if (!values) return MAP_TAP_CATEGORIES;
  const categories = [...new Set(values.filter(isMapTapCategory))];
  return categories.length > 0 ? categories : MAP_TAP_CATEGORIES;
}

export function isMapTapDifficulty(value: string): value is MapTapDifficulty {
  return ["easy", "medium", "hard"].includes(value);
}
