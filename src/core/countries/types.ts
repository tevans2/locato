export type CountryId = number;
export type CountryCode = string;

export const CONTINENTS = [
  "Africa",
  "Asia",
  "Europe",
  "North America",
  "Oceania",
  "South America",
] as const;

export type Continent = (typeof CONTINENTS)[number];

export interface RawCountry {
  readonly name: string;
  readonly code: CountryCode;
  readonly aliases: readonly string[];
  readonly continent: Continent;
  readonly flagSrc: string;
  readonly capital: string;
  readonly capitalAliases: readonly string[];
}

export interface Country {
  readonly id: CountryId;
  readonly name: string;
  readonly code: CountryCode;
  readonly aliases: readonly string[];
  readonly continent: Continent;
  readonly flagSrc: string;
  readonly normalizedName: string;
  readonly acceptedAnswers: readonly string[];
  readonly capital: string;
  readonly capitalAliases: readonly string[];
}


export interface CountryIndex {
  readonly countries: readonly Country[];
  readonly byId: readonly Country[];
  readonly byCode: ReadonlyMap<string, Country>;
  readonly byAnswer: ReadonlyMap<string, readonly CountryId[]>;
  readonly answerSetByCountryId: ReadonlyMap<CountryId, ReadonlySet<string>>;
}

export interface AnswerOptions {
  readonly includeCodes: boolean;
  readonly includeAliases: boolean;
}
