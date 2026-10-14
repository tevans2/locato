/**
 * Quick match: "find me a game" instead of a room code. Players asking for the same game share
 * a public room; it starts on its own once enough of them are in. Quick matches use each game's
 * standard settings, so signed-in players earn a skill rating (Elo) per game from them.
 */

export type QuickMatchGame = "flags" | "capitals" | "map-tap" | "flyover";

export interface QuickMatchGameInfo {
  readonly id: QuickMatchGame;
  readonly label: string;
  readonly pitch: string;
  /** What the room is created with (its kind follows from these). */
  readonly categoryIds: readonly string[];
}

export const QUICK_MATCH_GAMES: readonly QuickMatchGameInfo[] = [
  { id: "flags", label: "Flags race", pitch: "First to name the flag takes the round.", categoryIds: ["flags"] },
  { id: "capitals", label: "Capitals race", pitch: "Name the country behind each capital first.", categoryIds: ["capitals"] },
  { id: "map-tap", label: "MapTap", pitch: "Pin places on the globe; closest scores most.", categoryIds: ["map-tap"] },
  { id: "flyover", label: "Flyover", pitch: "Same route, same clock: fly over the most countries.", categoryIds: ["flyover"] },
];

export function isQuickMatchGame(value: unknown): value is QuickMatchGame {
  return QUICK_MATCH_GAMES.some((game) => game.id === value);
}

export function quickMatchGameInfo(game: QuickMatchGame): QuickMatchGameInfo {
  return QUICK_MATCH_GAMES.find((info) => info.id === game) ?? QUICK_MATCH_GAMES[0]!;
}

/** A quick match needs this many players before its countdown starts. */
export const QUICK_MATCH_MIN_PLAYERS = 2;
/** From the second player arriving to the game starting, so more can join. */
export const QUICK_MATCH_COUNTDOWN_MS = 15_000;
/** Once the room is full there's no one left to wait for. */
export const QUICK_MATCH_FULL_COUNTDOWN_MS = 3_000;

// ---- Ratings ---------------------------------------------------------------------------------

/** Everyone starts here. */
export const RATING_START = 1000;
/** How far one game can move a new player's rating, then an established one's. */
export const RATING_K_NEW = 40;
export const RATING_K = 24;
/** Games before a rating counts as established. */
export const RATING_PROVISIONAL_GAMES = 10;

export interface RatedStanding {
  readonly id: string;
  readonly rating: number;
  /** Rated games played before this one. */
  readonly games: number;
  /** Finishing position, 1 = won; equal ranks are a draw between those players. */
  readonly rank: number;
}

/**
 * Multiplayer Elo: every pair of players is a game, scored by who finished higher (a draw when
 * level). Each player's change is the average over their pairings times their K, so a game counts
 * the same whatever the room size. Returns the rounded change per id.
 */
export function ratingChanges(standings: readonly RatedStanding[]): ReadonlyMap<string, number> {
  const changes = new Map<string, number>();
  if (standings.length < 2) return changes;
  for (const player of standings) {
    let total = 0;
    for (const other of standings) {
      if (other.id === player.id) continue;
      const actual = player.rank < other.rank ? 1 : player.rank === other.rank ? 0.5 : 0;
      const expected = 1 / (1 + 10 ** ((other.rating - player.rating) / 400));
      total += actual - expected;
    }
    const k = player.games < RATING_PROVISIONAL_GAMES ? RATING_K_NEW : RATING_K;
    changes.set(player.id, Math.round((k * total) / (standings.length - 1)));
  }
  return changes;
}
