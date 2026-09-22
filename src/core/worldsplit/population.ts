/**
 * Rounded 2024 population estimates, in millions, used as stable gameplay weights.
 * The values intentionally trade false precision for reproducible rounds. They are
 * based on the UN World Population Prospects 2024 estimates distributed by Our
 * World in Data (https://ourworldindata.org/population-growth-over-time).
 */
export const WORLD_SPLIT_POPULATION_MILLIONS: Readonly<Record<string, number>> = {
  AF: 43, AL: 2.8, DZ: 47, AD: 0.082, AO: 38, AG: 0.094, AR: 46, AM: 3, AU: 27, AT: 9.2, AZ: 10.4,
  BS: 0.4, BH: 1.6, BD: 174, BB: 0.28, BY: 9.1, BE: 12, BZ: 0.42, BJ: 14, BT: 0.79, BO: 12,
  BA: 3.2, BW: 2.7, BR: 212, BN: 0.46, BG: 6.7, BF: 24, BI: 14, CV: 0.53, KH: 17, CM: 30,
  CA: 40, CF: 5.3, TD: 20, CL: 20, CN: 1419, CO: 53, KM: 0.87, CG: 6.3, CR: 5.2, CI: 31,
  HR: 3.9, CU: 11, CY: 1.4, CZ: 11, CD: 109, DK: 6, DJ: 1.2, DM: 0.066, DO: 11, EC: 18,
  EG: 117, SV: 6.4, GQ: 1.9, ER: 3.7, EE: 1.4, SZ: 1.2, ET: 132, FJ: 0.93, FI: 5.6,
  FR: 66, GA: 2.5, GM: 2.8, GE: 3.8, DE: 85, GH: 35, GR: 10, GD: 0.12, GT: 18, GN: 15,
  GW: 2.2, GY: 0.83, HT: 12, HN: 11, HU: 9.6, IS: 0.39, IN: 1450, ID: 283, IR: 91,
  IQ: 46, IE: 5.3, IL: 9.8, IT: 59, JM: 2.8, JP: 124, JO: 11, KZ: 20, KE: 56, KI: 0.13,
  KW: 5, KG: 7.2, LA: 7.8, LV: 1.9, LB: 5.8, LS: 2.3, LR: 5.5, LY: 7.4, LI: 0.04,
  LT: 2.9, LU: 0.67, MG: 32, MW: 22, MY: 36, MV: 0.53, ML: 25, MT: 0.54, MH: 0.042,
  MR: 5.2, MU: 1.3, MX: 130, FM: 0.11, MD: 3, MC: 0.039, MN: 3.5, ME: 0.64, MA: 38,
  MZ: 35, MM: 55, NA: 3, NR: 0.013, NP: 30, NL: 18, NZ: 5.3, NI: 7, NE: 27, NG: 233,
  KP: 26, MK: 1.8, NO: 5.6, OM: 5.3, PK: 251, PW: 0.018, PA: 4.5, PG: 10, PY: 7,
  PE: 34, PH: 116, PL: 38, PT: 10.5, QA: 2.7, RO: 19, RU: 145, RW: 14, KN: 0.048,
  LC: 0.18, VC: 0.1, WS: 0.22, SM: 0.034, ST: 0.24, SA: 34, SN: 18, RS: 6.6, SC: 0.13,
  SL: 8.8, SG: 6, SK: 5.4, SI: 2.1, SB: 0.82, SO: 19, ZA: 64, KR: 52, SS: 12,
  ES: 48, LK: 23, SD: 50, SR: 0.64, SE: 10.6, CH: 9, SY: 25, TJ: 10, TZ: 69,
  TH: 72, TL: 1.4, TG: 9.5, TO: 0.1, TT: 1.5, TN: 12, TR: 87, TM: 7.5, TV: 0.011,
  UG: 50, UA: 38, AE: 10, GB: 69, US: 345, UY: 3.4, UZ: 36, VU: 0.34, VE: 29,
  VN: 101, YE: 41, ZM: 21, ZW: 17, VA: 0.001, PS: 5.5, TW: 23.5,
};
