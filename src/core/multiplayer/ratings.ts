/**
 * Multiplayer skill ratings. Every finished room game with two or more signed-in players is
 * rated, one rating per game type (room kind: quiz race, MapTap, GeoGuessr, Flyover), Elo-style.
 */

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
