import type { CountryCode } from "../countries";
import type { AcademySkill, LookalikeSet } from "./types";

export const LOOKALIKES: readonly LookalikeSet[] = [
  // Flags
  { skill: "flag", codes: ["TD", "RO"], tip: "Practically identical blue-yellow-red. Chad's blue is a darker indigo; Romania's is brighter." },
  { skill: "flag", codes: ["ID", "MC", "PL"], tip: "Indonesia and Monaco are both red over white (Monaco's flag is squarer). Poland flips it: white over red." },
  { skill: "flag", codes: ["IE", "CI"], tip: "Ireland runs green-white-orange from the flagpole; Côte d'Ivoire runs orange-white-green." },
  { skill: "flag", codes: ["AU", "NZ"], tip: "Australia has white stars plus a big seven-pointed star under the Union Jack; New Zealand has four red stars." },
  { skill: "flag", codes: ["DK", "NO", "IS", "SE", "FI"], tip: "Denmark: white cross on red. Norway: blue cross edged white on red. Iceland: red cross edged white on blue. Sweden: yellow on blue. Finland: blue on white." },
  { skill: "flag", codes: ["SN", "ML", "GN"], tip: "Senegal and Mali are green-yellow-red; Senegal adds a green star. Guinea reverses the order: red-yellow-green." },
  { skill: "flag", codes: ["NL", "LU"], tip: "Both red-white-blue. Luxembourg's blue is a light sky blue; the Netherlands' is darker." },
  { skill: "flag", codes: ["SI", "SK", "RU"], tip: "All white-blue-red. Slovakia has a big double-cross shield near the hoist; Slovenia a small shield in the top corner; Russia has no emblem." },
  { skill: "flag", codes: ["CO", "EC", "VE"], tip: "Colombia's yellow band fills the top half; Ecuador is the same plus a condor coat of arms; Venezuela has equal stripes and an arc of stars." },
  { skill: "flag", codes: ["HN", "SV", "NI"], tip: "Blue-white-blue. Honduras has five blue stars; El Salvador's triangle emblem sits in a laurel wreath; Nicaragua's triangle is ringed by text." },
  { skill: "flag", codes: ["QA", "BH"], tip: "Qatar is maroon with nine serrated points; Bahrain is red with five." },
  { skill: "flag", codes: ["IT", "MX"], tip: "Both green-white-red. Mexico has an eagle-and-snake coat of arms in the middle; Italy is plain." },
  { skill: "flag", codes: ["BE", "DE"], tip: "Belgium is black-yellow-red in vertical bands; Germany is black-red-gold in horizontal stripes." },
  { skill: "flag", codes: ["HT", "LI"], tip: "Both blue over red. Liechtenstein has a gold crown in the top corner; Haiti has a coat of arms on a white panel in the middle." },
  { skill: "flag", codes: ["YE", "EG", "IQ"], tip: "Red-white-black stripes. Yemen is plain, Egypt has a gold eagle, Iraq has green Arabic script." },
  { skill: "flag", codes: ["JO", "PS", "SD"], tip: "Jordan and Palestine are black-white-green with a red triangle, but only Jordan's has a white star. Sudan is red-white-black with a green triangle." },
  { skill: "flag", codes: ["AE", "KW"], tip: "The UAE has a vertical red band by the flagpole; Kuwait has a black trapezoid there and a red bottom stripe." },
  { skill: "flag", codes: ["TR", "TN"], tip: "Both a white crescent and star on red. Tunisia's sit inside a white disc." },
  { skill: "flag", codes: ["GH", "BO", "LT"], tip: "Ghana is red-gold-green with a black star; Bolivia is red-yellow-green with no star; Lithuania runs yellow-green-red." },
  { skill: "flag", codes: ["AT", "LV"], tip: "Austria is bright red with an equal white stripe; Latvia is a darker carmine with a thinner white stripe." },
  { skill: "flag", codes: ["US", "LR", "MY"], tip: "The US has 50 stars; Liberia has a single white star; Malaysia has a yellow crescent and star." },
  { skill: "flag", codes: ["NE", "IN"], tip: "Both orange-white-green. Niger has an orange disc and is squarer; India has a blue wheel." },
  // Map location
  { skill: "map", codes: ["NE", "NG"], tip: "Niger is the huge Saharan country on top; Nigeria is its populous coastal neighbour to the south." },
  { skill: "map", codes: ["GN", "GW", "GQ"], tip: "Guinea is the big one on the west coast with Guinea-Bissau tucked to its northwest; Equatorial Guinea is far away in Central Africa." },
  { skill: "map", codes: ["SK", "SI"], tip: "Slovakia borders Poland and Hungary; Slovenia sits south of Austria between Italy and Croatia." },
  { skill: "map", codes: ["DM", "DO"], tip: "Dominica is a tiny island in the Lesser Antilles; the Dominican Republic shares Hispaniola with Haiti." },
  { skill: "map", codes: ["CG", "CD"], tip: "The Republic of the Congo is the smaller one west of the Congo River; DR Congo is the giant to its east." },
  { skill: "map", codes: ["AT", "AU"], tip: "Austria is the landlocked Alpine country in Europe; Australia is the continent-sized island down under." },
  { skill: "map", codes: ["EE", "LV", "LT"], tip: "North to south they go alphabetically: Estonia, Latvia, Lithuania." },
  { skill: "map", codes: ["GY", "SR"], tip: "West to east along the coast: Guyana, then Suriname, then French Guiana." },
  { skill: "map", codes: ["UY", "PY"], tip: "Uruguay is on the Atlantic between Brazil and Argentina; Paraguay is landlocked further north." },
  { skill: "map", codes: ["RW", "BI"], tip: "Rwanda sits directly north of Burundi; Burundi is the one on the shore of Lake Tanganyika." },
  { skill: "map", codes: ["MV", "MU", "SC"], tip: "The Maldives lie southwest of India; Mauritius is east of Madagascar; the Seychelles are north of Madagascar." },
  // Outline shape
  { skill: "shape", codes: ["TG", "BJ"], tip: "Both are thin north-south strips. Togo is the narrower western one; Benin widens out in the north." },
  { skill: "shape", codes: ["HR", "BA"], tip: "Croatia is the crescent that wraps around Bosnia and Herzegovina, the chunky triangle it hugs." },
  { skill: "shape", codes: ["SI", "SK"], tip: "Slovenia is small and compact (often said to look like a chicken); Slovakia is a long east-west shape." },
  { skill: "shape", codes: ["MW", "MZ"], tip: "Malawi is a long, thin sliver along its lake; Mozambique is the big coastal shape wrapped around it." },
  // Capitals
  { skill: "capital", codes: ["SK", "SI"], tip: "Bratislava is Slovakia's capital, on the Danube near Vienna; Ljubljana is Slovenia's." },
  { skill: "capital", codes: ["CG", "CD"], tip: "Brazzaville (Congo) and Kinshasa (DR Congo) face each other across the Congo River." },
  { skill: "capital", codes: ["JM", "VC"], tip: "Kingston is Jamaica's capital; Kingstown (with a 'w') is Saint Vincent and the Grenadines'." },
  { skill: "capital", codes: ["HU", "RO"], tip: "Budapest straddles the Danube in Hungary; Bucharest is Romania's capital." },
  { skill: "capital", codes: ["CH", "DE"], tip: "Bern is Switzerland's capital; Berlin is Germany's." },
  { skill: "capital", codes: ["LR", "SL"], tip: "Monrovia (Liberia) is named after US President Monroe; Freetown (Sierra Leone) was founded for freed slaves." },
  { skill: "capital", codes: ["SV", "CR", "DO"], tip: "San Salvador is El Salvador's, San José is Costa Rica's, and Santo Domingo is the Dominican Republic's." },
  { skill: "capital", codes: ["AO", "ZM"], tip: "Luanda is on Angola's Atlantic coast; Lusaka is landlocked Zambia's capital." },
  { skill: "capital", codes: ["AU", "NZ"], tip: "Canberra, not Sydney, is Australia's capital; Wellington, not Auckland, is New Zealand's." },
];

export function lookalikesFor(code: CountryCode, skill?: AcademySkill): readonly LookalikeSet[] {
  const upper = code.toUpperCase();
  return LOOKALIKES.filter((set) => (skill === undefined || set.skill === skill) && set.codes.includes(upper));
}
