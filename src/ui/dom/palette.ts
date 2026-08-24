// Single source of truth for player and role colors across solo MapTap, daily, and
// multiplayer reveals. Keep in sync with the CSS custom properties in game.css.
export const PLAYER_COLORS = ["#38bdf8", "#fb923c", "#a78bfa", "#34d399", "#f472b6", "#fbbf24", "#60a5fa", "#f87171"] as const;

export const GUESS_COLOR = PLAYER_COLORS[0];
export const TARGET_COLOR = "#fb7185";

export function playerColor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length]!;
}
