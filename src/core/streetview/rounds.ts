export interface StreetViewFrame {
  readonly lat: number;
  readonly lng: number;
  readonly heading: number;
  readonly pitch?: number;
  readonly fov?: number;
  readonly label: string;
}

export interface StreetViewCountryRound {
  readonly countryCode: string;
  readonly frames: readonly StreetViewFrame[];
}

// Starter interactive Street View country dataset. Keep exactly three frames per country for the 3-try ruleset.
// Google may snap each coordinate to the nearest available Street View panorama; validate production pools with the Street View Metadata API.
// Current pool: 56 country rounds, 168 frames.
export const streetViewCountryRounds: readonly StreetViewCountryRound[] = [
  {
    countryCode: "AD",
    frames: [
      { lat: 42.5078, lng: 1.5211, heading: 80, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 42.5425, lng: 1.7336, heading: 210, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 42.4637, lng: 1.4913, heading: 315, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "AR",
    frames: [
      { lat: -34.6037, lng: -58.3816, heading: 75, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: -32.8895, lng: -68.8458, heading: 160, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: -31.4201, lng: -64.1888, heading: 250, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "AU",
    frames: [
      { lat: -33.8688, lng: 151.2093, heading: 55, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: -37.8136, lng: 144.9631, heading: 225, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: -31.9523, lng: 115.8613, heading: 15, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "AT",
    frames: [
      { lat: 48.2082, lng: 16.3738, heading: 140, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 47.0707, lng: 15.4395, heading: 75, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 47.2692, lng: 11.4041, heading: 260, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "BE",
    frames: [
      { lat: 50.8503, lng: 4.3517, heading: 95, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 51.2194, lng: 4.4025, heading: 205, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 50.6326, lng: 5.5797, heading: 305, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "BG",
    frames: [
      { lat: 42.6977, lng: 23.3219, heading: 35, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 42.1354, lng: 24.7453, heading: 160, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 43.2141, lng: 27.9147, heading: 250, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "BR",
    frames: [
      { lat: -23.5505, lng: -46.6333, heading: 80, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: -22.9068, lng: -43.1729, heading: 215, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: -15.7939, lng: -47.8828, heading: 120, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "CA",
    frames: [
      { lat: 43.6532, lng: -79.3832, heading: 85, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 49.2827, lng: -123.1207, heading: 305, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 45.5017, lng: -73.5673, heading: 170, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "CH",
    frames: [
      { lat: 47.3769, lng: 8.5417, heading: 60, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 46.2044, lng: 6.1432, heading: 205, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 46.9481, lng: 7.4474, heading: 315, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "CL",
    frames: [
      { lat: -33.4489, lng: -70.6693, heading: 110, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: -36.8201, lng: -73.0444, heading: 240, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: -33.0472, lng: -71.6127, heading: 25, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "CO",
    frames: [
      { lat: 4.7110, lng: -74.0721, heading: 70, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 6.2442, lng: -75.5812, heading: 180, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 3.4516, lng: -76.5320, heading: 285, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "CZ",
    frames: [
      { lat: 50.0755, lng: 14.4378, heading: 130, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 49.1951, lng: 16.6068, heading: 275, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 49.8209, lng: 18.2625, heading: 40, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "DE",
    frames: [
      { lat: 52.5200, lng: 13.4050, heading: 65, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 48.1351, lng: 11.5820, heading: 195, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 53.5511, lng: 9.9937, heading: 310, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "DK",
    frames: [
      { lat: 55.6761, lng: 12.5683, heading: 95, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 56.1629, lng: 10.2039, heading: 185, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 55.4038, lng: 10.4024, heading: 260, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "EE",
    frames: [
      { lat: 59.4370, lng: 24.7536, heading: 80, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 58.3776, lng: 26.7290, heading: 200, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 58.3859, lng: 24.4971, heading: 310, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "ES",
    frames: [
      { lat: 40.4168, lng: -3.7038, heading: 30, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 41.3851, lng: 2.1734, heading: 250, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 37.3891, lng: -5.9845, heading: 105, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "FI",
    frames: [
      { lat: 60.1699, lng: 24.9384, heading: 145, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 61.4978, lng: 23.7610, heading: 270, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 60.4518, lng: 22.2666, heading: 40, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "FR",
    frames: [
      { lat: 48.8566, lng: 2.3522, heading: 70, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 45.7640, lng: 4.8357, heading: 210, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 43.7102, lng: 7.2620, heading: 140, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "GB",
    frames: [
      { lat: 51.5074, lng: -0.1278, heading: 290, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 55.9533, lng: -3.1883, heading: 40, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 53.4808, lng: -2.2426, heading: 160, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "GR",
    frames: [
      { lat: 37.9838, lng: 23.7275, heading: 120, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 40.6401, lng: 22.9444, heading: 245, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 35.3387, lng: 25.1442, heading: 35, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "HR",
    frames: [
      { lat: 45.8150, lng: 15.9819, heading: 155, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 43.5081, lng: 16.4402, heading: 285, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 45.3271, lng: 14.4422, heading: 20, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "HU",
    frames: [
      { lat: 47.4979, lng: 19.0402, heading: 85, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 47.5316, lng: 21.6273, heading: 205, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 46.2530, lng: 20.1414, heading: 310, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "ID",
    frames: [
      { lat: -6.2088, lng: 106.8456, heading: 105, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: -7.2575, lng: 112.7521, heading: 225, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: -6.9175, lng: 107.6191, heading: 15, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "IE",
    frames: [
      { lat: 53.3498, lng: -6.2603, heading: 65, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 51.8985, lng: -8.4756, heading: 180, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 53.2707, lng: -9.0568, heading: 295, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "IL",
    frames: [
      { lat: 32.0853, lng: 34.7818, heading: 75, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 31.7683, lng: 35.2137, heading: 195, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 32.7940, lng: 34.9896, heading: 300, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "IS",
    frames: [
      { lat: 64.1466, lng: -21.9426, heading: 145, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 65.6885, lng: -18.1262, heading: 255, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 63.9998, lng: -22.5583, heading: 30, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "IT",
    frames: [
      { lat: 41.9028, lng: 12.4964, heading: 35, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 45.4642, lng: 9.1900, heading: 200, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 43.7696, lng: 11.2558, heading: 115, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "JP",
    frames: [
      { lat: 35.6595, lng: 139.7005, heading: 35, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 34.6937, lng: 135.5023, heading: 180, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 35.0116, lng: 135.7681, heading: 95, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "KE",
    frames: [
      { lat: -1.2864, lng: 36.8172, heading: 85, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: -4.0435, lng: 39.6682, heading: 210, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: -0.0917, lng: 34.7680, heading: 315, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "KR",
    frames: [
      { lat: 37.5665, lng: 126.9780, heading: 100, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 35.1796, lng: 129.0756, heading: 220, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 35.8714, lng: 128.6014, heading: 20, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "LT",
    frames: [
      { lat: 54.6872, lng: 25.2797, heading: 90, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 54.8985, lng: 23.9036, heading: 210, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 55.7033, lng: 21.1443, heading: 325, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "LU",
    frames: [
      { lat: 49.6116, lng: 6.1319, heading: 115, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 49.4958, lng: 5.9806, heading: 245, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 49.8526, lng: 6.1069, heading: 330, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "LV",
    frames: [
      { lat: 56.9496, lng: 24.1052, heading: 65, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 55.8747, lng: 26.5362, heading: 175, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 56.5047, lng: 21.0108, heading: 295, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "MX",
    frames: [
      { lat: 19.4326, lng: -99.1332, heading: 75, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 20.6597, lng: -103.3496, heading: 230, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 25.6866, lng: -100.3161, heading: 145, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "MY",
    frames: [
      { lat: 3.1390, lng: 101.6869, heading: 95, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 5.4141, lng: 100.3288, heading: 220, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 1.4927, lng: 103.7414, heading: 30, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "NL",
    frames: [
      { lat: 52.3676, lng: 4.9041, heading: 20, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 51.9244, lng: 4.4777, heading: 155, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 52.0705, lng: 4.3007, heading: 280, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "NO",
    frames: [
      { lat: 59.9139, lng: 10.7522, heading: 120, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 60.3913, lng: 5.3221, heading: 240, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 63.4305, lng: 10.3951, heading: 30, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "NZ",
    frames: [
      { lat: -36.8485, lng: 174.7633, heading: 50, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: -41.2865, lng: 174.7762, heading: 175, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: -43.5321, lng: 172.6362, heading: 300, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "PE",
    frames: [
      { lat: -12.0464, lng: -77.0428, heading: 70, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: -16.4090, lng: -71.5375, heading: 185, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: -8.1116, lng: -79.0287, heading: 300, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "PH",
    frames: [
      { lat: 14.5995, lng: 120.9842, heading: 80, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 10.3157, lng: 123.8854, heading: 200, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 7.1907, lng: 125.4553, heading: 315, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "PL",
    frames: [
      { lat: 52.2297, lng: 21.0122, heading: 45, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 50.0647, lng: 19.9450, heading: 160, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 54.3520, lng: 18.6466, heading: 285, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "PT",
    frames: [
      { lat: 38.7223, lng: -9.1393, heading: 95, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 41.1579, lng: -8.6291, heading: 210, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 37.0179, lng: -7.9308, heading: 320, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "RO",
    frames: [
      { lat: 44.4268, lng: 26.1025, heading: 65, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 46.7712, lng: 23.6236, heading: 180, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 45.7489, lng: 21.2087, heading: 300, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "RS",
    frames: [
      { lat: 44.7866, lng: 20.4489, heading: 110, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 45.2671, lng: 19.8335, heading: 230, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 43.3209, lng: 21.8958, heading: 15, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "SE",
    frames: [
      { lat: 59.3293, lng: 18.0686, heading: 80, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 57.7089, lng: 11.9746, heading: 195, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 55.6050, lng: 13.0038, heading: 305, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "SG",
    frames: [
      { lat: 1.3521, lng: 103.8198, heading: 115, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 1.3009, lng: 103.8387, heading: 245, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 1.3733, lng: 103.9497, heading: 20, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "SI",
    frames: [
      { lat: 46.0569, lng: 14.5058, heading: 70, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 46.5547, lng: 15.6459, heading: 190, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 45.5481, lng: 13.7302, heading: 300, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "SK",
    frames: [
      { lat: 48.1486, lng: 17.1077, heading: 125, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 48.7164, lng: 21.2611, heading: 240, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 49.2235, lng: 18.7394, heading: 35, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "TH",
    frames: [
      { lat: 13.7563, lng: 100.5018, heading: 95, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 18.7883, lng: 98.9853, heading: 210, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 7.8804, lng: 98.3923, heading: 320, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "TR",
    frames: [
      { lat: 41.0082, lng: 28.9784, heading: 55, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 39.9334, lng: 32.8597, heading: 175, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 38.4237, lng: 27.1428, heading: 290, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "TW",
    frames: [
      { lat: 25.0330, lng: 121.5654, heading: 90, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 22.6273, lng: 120.3014, heading: 205, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 24.1477, lng: 120.6736, heading: 315, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "UA",
    frames: [
      { lat: 50.4501, lng: 30.5234, heading: 60, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 49.8397, lng: 24.0297, heading: 190, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 46.4825, lng: 30.7233, heading: 305, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "AE",
    frames: [
      { lat: 25.2048, lng: 55.2708, heading: 85, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 24.4539, lng: 54.3773, heading: 210, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 25.3463, lng: 55.4209, heading: 320, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "US",
    frames: [
      { lat: 40.7580, lng: -73.9855, heading: 25, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: 37.7749, lng: -122.4194, heading: 285, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: 41.8781, lng: -87.6298, heading: 130, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "UY",
    frames: [
      { lat: -34.9011, lng: -56.1645, heading: 100, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: -34.4626, lng: -57.8400, heading: 215, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: -31.3833, lng: -57.9667, heading: 325, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
  {
    countryCode: "ZA",
    frames: [
      { lat: -33.9249, lng: 18.4241, heading: 45, pitch: 0, fov: 90, label: "Frame 1" },
      { lat: -26.2041, lng: 28.0473, heading: 250, pitch: 0, fov: 90, label: "Frame 2" },
      { lat: -29.8587, lng: 31.0218, heading: 130, pitch: 0, fov: 90, label: "Frame 3" },
    ],
  },
];
