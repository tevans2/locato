import { normalizeAnswerVariants, type Country, type CountryIndex, type CountryId } from "../countries";

const MIN_AUTO_MATCH_LENGTH = 3;
const MIN_SUBMIT_MATCH_LENGTH = 1;

function detectUniqueCountryAnswer(
  index: CountryIndex,
  value: string,
  guessedCountryIds: ReadonlySet<CountryId>,
  minimumMatchLength: number,
): Country | null {
  const guesses = normalizeAnswerVariants(value).filter((guess) => guess.length >= minimumMatchLength);

  for (const guess of guesses) {
    const countryIds = index.byAnswer.get(guess);
    if (!countryIds || countryIds.length !== 1) continue;

    const [countryId] = countryIds;
    if (countryId === undefined || guessedCountryIds.has(countryId)) continue;

    return index.byId[countryId] ?? null;
  }

  return null;
}

export function detectCountryGuess(index: CountryIndex, value: string, guessedCountryIds: ReadonlySet<CountryId>): Country | null {
  return detectUniqueCountryAnswer(index, value, guessedCountryIds, MIN_AUTO_MATCH_LENGTH);
}

export function submitCountryGuess(index: CountryIndex, value: string, guessedCountryIds: ReadonlySet<CountryId>): Country | null {
  return detectUniqueCountryAnswer(index, value, guessedCountryIds, MIN_SUBMIT_MATCH_LENGTH);
}
