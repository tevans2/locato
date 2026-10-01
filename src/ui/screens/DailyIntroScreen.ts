import { DAILY_FORMAT, DAILY_HINT_PENALTY, DAILY_WRONG_GUESS_PENALTY, type DailyChallenge } from "../../core/dailyChallenge";
import type { Screen } from "../../app/router";
import type { ShellContext } from "../shell/types";
import { el } from "../dom/createElement";
import { createSitePage } from "../shell/SiteHeader";
import { shellIcon } from "../shell/icons";
import "../../styles/daily-result.css";

export function createDailyIntroScreen(options: {
  readonly shell: ShellContext;
  readonly challenge: DailyChallenge;
  readonly roundsPlayed: number;
  readonly onStart: () => void;
}): Screen {
  const { challenge, roundsPlayed } = options;
  const format = challenge.challengeVersion === 2 ? DAILY_FORMAT : [
    { label: "Mixed country questions", rounds: "1–8", icon: "flag" as const },
    { label: "Map Tap", rounds: "9", icon: "globe" as const },
    { label: "Street View", rounds: "10", icon: "binoculars" as const },
  ];
  return createSitePage(options.shell, {
    section: "daily", id: "daily-intro", className: "daily-intro-screen",
    content: [el("section", { className: "daily-intro-panel", children: [
      el("p", { className: "daily-result-kicker", text: `Daily challenge · ${challenge.date}` }),
      el("h1", { className: "daily-theme-title", text: challenge.theme?.title ?? "Today's world tour" }),
      el("p", { className: "daily-intro-description", text: challenge.theme?.description ?? "Ten geography questions, the same for everyone today." }),
      el("div", { className: "daily-intro-meta", children: [
        el("span", { text: "10 rounds" }), el("span", { text: "100 points" }), el("span", { text: "One scored attempt today" }),
      ] }),
      ...(roundsPlayed > 0 ? [el("p", { className: "daily-resume-note", text: `${roundsPlayed} of 10 rounds completed. Continue where you left off.` })] : []),
      el("button", { className: "shell-btn shell-btn-primary daily-start-button", attrs: { type: "button", "data-action": "start-daily" }, children: [
        el("span", { text: roundsPlayed > 0 ? "Resume today's challenge" : "Start today's challenge" }), shellIcon("arrow-right", 18, 2),
      ], on: { click: options.onStart } }),
      el("section", { className: "daily-format", attrs: { "aria-label": "Today's round order" }, children: format.map((stage) => el("article", { children: [
        shellIcon(stage.icon, 21, 1.7), el("span", { text: `Round${stage.rounds.includes("–") ? "s" : ""} ${stage.rounds}` }), el("strong", { text: stage.label }),
      ] })) }),
      el("p", { className: "daily-intro-balance", text: challenge.challengeVersion === 2
        ? "Start with familiar flags, build through moderate questions, and take on two tougher country questions. Four country rounds and both final rounds follow today's theme."
        : "Your saved challenge continues with its original questions and order." }),
      el("section", { className: "daily-scoring", children: [
        el("h2", { text: "How scoring works" }),
        el("p", { text: `Each round is worth 10 points. A hint costs ${DAILY_HINT_PENALTY} points and a wrong guess costs ${DAILY_WRONG_GUESS_PENALTY} points. Passing or revealing an answer earns 0. Map Tap awards points for how close you pin the location.` }),
        el("p", { className: "muted", text: "Score comes first on the leaderboard; time breaks ties. Your progress saves as you play." }),
      ] }),
    ] })],
  });
}

export function createDailyPracticeCompleteScreen(shell: ShellContext, count: number, onBack: () => void): Screen {
  return createSitePage(shell, { section: "daily", id: "daily-practice-result", content: [
    el("section", { className: "daily-intro-panel", children: [
      el("p", { className: "daily-result-kicker", text: "Daily practice" }),
      el("h1", { className: "daily-theme-title", text: "Another step forward" }),
      el("p", { className: "daily-intro-description", text: `You revisited ${count} question${count === 1 ? "" : "s"} from your daily challenge. Your scored daily result stays the same.` }),
      el("button", { className: "shell-btn shell-btn-primary", text: "Back to daily result", attrs: { type: "button" }, on: { click: onBack } }),
    ] }),
  ] });
}
