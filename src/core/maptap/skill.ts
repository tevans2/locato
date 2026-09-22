import type { MapTapDifficulty } from "./types";

// Adaptive difficulty for casual MapTap play. New players start on easy targets and the game
// ramps up (or eases off) based on how their recent guesses score. Explicit difficulty filters
// bypass selection but results still feed the tracker, so the ramp follows real performance.
export type MapTapSkillLevel = "rookie" | "explorer" | "expert";

export interface MapTapSkill {
  readonly level: MapTapSkillLevel;
  // Most recent normalized round scores (0..1), newest last.
  readonly recentScores: readonly number[];
}

export const MAP_TAP_SKILL_KEY = "locato:maptap-skill:v1";
const HISTORY_LIMIT = 6;

export const defaultMapTapSkill: MapTapSkill = { level: "rookie", recentScores: [] };

export function readMapTapSkill(storage: Storage | null): MapTapSkill {
  if (!storage) return defaultMapTapSkill;
  try {
    const raw = storage.getItem(MAP_TAP_SKILL_KEY);
    if (!raw) return defaultMapTapSkill;
    const parsed = JSON.parse(raw) as Partial<MapTapSkill>;
    if (parsed.level !== "rookie" && parsed.level !== "explorer" && parsed.level !== "expert") return defaultMapTapSkill;
    const recentScores = Array.isArray(parsed.recentScores)
      ? parsed.recentScores.filter((score): score is number => typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1).slice(-HISTORY_LIMIT)
      : [];
    return { level: parsed.level, recentScores };
  } catch {
    return defaultMapTapSkill;
  }
}

export function saveMapTapSkill(storage: Storage | null, skill: MapTapSkill): void {
  if (!storage) return;
  try {
    storage.setItem(MAP_TAP_SKILL_KEY, JSON.stringify(skill));
  } catch {
    // Storage may be unavailable (private mode); the session still adapts in memory.
  }
}

function average(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

// A normalized score is score / maxScore for the finished round.
export function recordMapTapResult(skill: MapTapSkill, normalizedScore: number): MapTapSkill {
  const recentScores = [...skill.recentScores, Math.min(1, Math.max(0, normalizedScore))].slice(-HISTORY_LIMIT);
  const last2 = recentScores.slice(-2);
  const last3 = recentScores.slice(-3);
  let level = skill.level;

  if (level === "rookie" && (last2.length === 2 && average(last2) >= 0.5)) level = "explorer";
  else if (level === "explorer" && last3.length === 3 && average(last3) >= 0.55) level = "expert";
  else if (level === "expert" && last3.length === 3 && average(last3) < 0.25) level = "explorer";
  else if (level === "explorer" && last3.length === 3 && average(last3) < 0.15) level = "rookie";

  return { level, recentScores };
}

// Round index breaks ties so explorer sessions mix easy and medium instead of locking to one.
export function difficultyForSkill(level: MapTapSkillLevel, roundIndex: number): MapTapDifficulty {
  if (level === "rookie") return "easy";
  if (level === "expert") return roundIndex % 2 === 0 ? "medium" : "hard";
  return roundIndex % 2 === 0 ? "easy" : "medium";
}

export function describeMapTapSkill(level: MapTapSkillLevel): string {
  if (level === "rookie") return "Warm-up — easy targets while you find your bearings.";
  if (level === "explorer") return "Finding your range — targets are mixing up a notch.";
  return "Seasoned explorer — expect trickier pins.";
}
