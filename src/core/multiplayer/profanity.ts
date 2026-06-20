const PROFANE_WORDS = [
  "arse",
  "ass",
  "asshole",
  "bastard",
  "bitch",
  "bollocks",
  "bullshit",
  "crap",
  "cunt",
  "damn",
  "dick",
  "douche",
  "fag",
  "fuck",
  "motherfucker",
  "piss",
  "prick",
  "shit",
  "slut",
  "twat",
  "whore",
] as const;

const PROFANITY_PATTERN = new RegExp(`\\b(${PROFANE_WORDS.join("|")})\\b`, "gi");

function mask(value: string): string {
  return "*".repeat([...value].length);
}

export function filterProfanity(value: string): string {
  return value.replace(PROFANITY_PATTERN, mask);
}
