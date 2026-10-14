// Mystery country. Imports the country profiles, so load it lazily from the browser (its screen
// is a separate chunk); never import it from the main bundle.
export { bearingDegrees, compassFor, mysteryClues, mysteryHintText } from "./clues";
export type { Comparison, Compass, MysteryClues } from "./clues";
export {
  MYSTERY_DAILY_FIRST_DATE,
  MYSTERY_GUESS_PENALTY,
  MYSTERY_HINT_PENALTY,
  MYSTERY_MAX_GUESSES,
  MYSTERY_MAX_HINTS,
  MYSTERY_MAX_POINTS,
  MYSTERY_MIN_SOLVED_POINTS,
  MYSTERY_RUN_TIERS,
  createDailyMysteryTarget,
  createMysteryRound,
  createMysteryTargets,
  guessMystery,
  hintMystery,
  mysteryDailyNumber,
  mysteryDailyShareText,
  mysteryPoints,
  mysteryRoundPoints,
  mysteryShareSquare,
  revealMystery,
} from "./round";
export type { MysteryGuess, MysteryGuessError, MysteryRound, MysteryStatus } from "./round";
