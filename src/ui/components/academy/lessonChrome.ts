import type { CountryCode, CountryIndex } from "../../../core/countries";
import type { CompletionSummary, AcademyLevelStatus, LearningGroup } from "../../../core/academy";
import { el } from "../../dom/createElement";
import { confetti, countryOf, flagImage, icon } from "./lessonMedia";

/** Lesson frame pieces: top bar with progress + combo, completion card and friendly states. */

export interface LessonTopBar {
  readonly element: HTMLElement;
  readonly setProgress: (done: number, total: number) => void;
  readonly setStreak: (streak: number) => void;
}

export function createLessonTopBar(options: { readonly title: string; readonly exitLabel?: string; readonly onExit: () => void }): LessonTopBar {
  const exit = el("button", {
    className: "lx-exit",
    attrs: { type: "button", "aria-label": options.exitLabel ?? "Leave lesson" },
    children: [icon("close")],
    on: { click: options.onExit },
  });
  const fill = el("span", { className: "lx-progress-fill" });
  const progress = el("div", {
    className: "lx-progress",
    attrs: { role: "progressbar", "aria-label": "Lesson progress", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" },
    children: [fill],
  });
  const streakCount = el("span", { className: "lx-streak-count", text: "0" });
  const streak = el("span", {
    className: "lx-streak",
    attrs: { "aria-live": "polite" },
    children: [icon("flame"), streakCount, el("span", { className: "lx-sr-only", text: " in a row" })],
  });
  streak.hidden = true;

  const element = el("header", {
    className: "lx-top",
    children: [
      exit,
      el("p", { className: "lx-top-title", text: options.title }),
      el("div", { className: "lx-top-progress", children: [progress, streak] }),
    ],
  });

  return {
    element,
    setProgress: (done, total) => {
      const percent = total <= 0 ? 0 : Math.max(0, Math.min(100, (done / total) * 100));
      fill.style.width = `${percent.toFixed(2)}%`;
      progress.setAttribute("aria-valuenow", String(Math.round(percent)));
      progress.setAttribute("aria-valuetext", `${done} of ${total} steps`);
      fill.classList.toggle("is-started", done > 0);
    },
    setStreak: (value) => {
      const show = value >= 2;
      const grew = show && Number(streakCount.textContent) < value;
      streak.hidden = !show;
      streakCount.textContent = String(value);
      streak.classList.toggle("is-hot", value >= 5);
      if (grew) {
        streak.classList.remove("is-pop");
        void streak.offsetWidth;
        streak.classList.add("is-pop");
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------

export interface CompletionAction {
  readonly label: string;
  readonly run: () => void;
}

export interface CompletionModel {
  readonly title: string;
  readonly subtitle: string;
  readonly correct: number;
  readonly total: number;
  readonly bestStreak: number;
  readonly newCodes: readonly CountryCode[];
  readonly practicedCodes: readonly CountryCode[];
  readonly group: LearningGroup | null;
  readonly groupBefore: CompletionSummary | null;
  readonly groupAfter: CompletionSummary | null;
  readonly levelBefore: AcademyLevelStatus;
  readonly levelAfter: AcademyLevelStatus;
  readonly primary: CompletionAction | null;
  readonly review: CompletionAction | null;
  readonly back: CompletionAction;
  readonly onOpenCountry?: (code: CountryCode) => void;
  readonly countryIndex: CountryIndex;
  readonly random?: () => number;
}

function accuracyLine(percent: number): string {
  if (percent === 100) return "Flawless!";
  if (percent >= 85) return "Superb work.";
  if (percent >= 65) return "Solid progress.";
  if (percent >= 40) return "Every round makes it stick.";
  return "Tough set — that's how it sticks.";
}

function meter(className: string, before: number, after: number, labelText: string): HTMLElement {
  const ghost = el("span", { className: "lx-meter-before" });
  const fill = el("span", { className: "lx-meter-fill" });
  ghost.style.width = `${Math.round(before * 100)}%`;
  fill.style.width = `${Math.round(before * 100)}%`;
  fill.dataset.target = `${Math.round(after * 100)}%`;
  return el("div", {
    className: `lx-meter ${className}`,
    attrs: { role: "img", "aria-label": labelText },
    children: [ghost, fill],
  });
}

/** Grow every meter from its "before" width to its "after" width once visible. */
function animateMeters(root: HTMLElement): void {
  const run = (): void => {
    for (const fill of root.querySelectorAll<HTMLElement>(".lx-meter-fill[data-target]")) fill.style.width = fill.dataset.target ?? fill.style.width;
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(run));
  else run();
}

export function createCompletionView(model: CompletionModel): HTMLElement {
  const percent = model.total === 0 ? 100 : Math.round((model.correct / model.total) * 100);
  const stats = el("div", {
    className: "lx-done-stats",
    children: [
      stat(`${percent}%`, "Accuracy", model.total ? `${model.correct} of ${model.total} first tries` : "Nothing to score"),
      stat(String(model.newCodes.length || model.practicedCodes.length), model.newCodes.length ? "New countries" : "Countries practised", model.newCodes.length ? "met for the first time" : "kept fresh"),
      stat(String(model.bestStreak), "Best streak", model.bestStreak >= 5 ? "on fire" : "answers in a row"),
    ],
  });

  const sections: HTMLElement[] = [];
  if (model.group && model.groupBefore && model.groupAfter) {
    const before = model.groupBefore.percent;
    const after = model.groupAfter.percent;
    sections.push(
      el("section", {
        className: "lx-done-panel",
        children: [
          el("div", {
            className: "lx-done-panel-head",
            children: [
              el("h3", { text: model.group.title }),
              el("span", { className: "lx-done-delta", text: after > before ? `${before}% → ${after}%` : `${after}%` }),
            ],
          }),
          meter("is-group", before / 100, after / 100, `${model.group.title}: ${before}% to ${after}% complete`),
          el("p", {
            className: "lx-done-note",
            text: model.groupAfter.completed
              ? "Group complete — every country is at least familiar."
              : `${model.groupAfter.familiar + model.groupAfter.mastered} of ${model.groupAfter.total} countries familiar so far.`,
          }),
        ],
      }),
    );
  }

  const levelUp = model.levelAfter.level.index > model.levelBefore.level.index;
  const next = model.levelAfter.next;
  const rankBefore = levelUp ? 0 : model.levelBefore.progressToNext;
  sections.push(
    el("section", {
      className: `lx-done-panel lx-done-rank${levelUp ? " is-level-up" : ""}`,
      children: [
        el("div", {
          className: "lx-done-panel-head",
          children: [
            el("h3", { children: [el("span", { className: "lx-rank-kicker", text: levelUp ? "New rank!" : "Rank" }), document.createTextNode(model.levelAfter.level.title)] }),
            el("span", {
              className: "lx-done-delta",
              text: next ? `${Math.max(0, next.minMastered - model.levelAfter.mastered)} to ${next.title}` : "Top rank",
            }),
          ],
        }),
        meter("is-rank", rankBefore, model.levelAfter.progressToNext, `Rank progress towards ${next?.title ?? "the top"}`),
        el("p", { className: "lx-done-note", text: `${model.levelAfter.mastered} ${model.levelAfter.mastered === 1 ? "country" : "countries"} mastered. Mastery comes from reviews over the next days.` }),
      ],
    }),
  );

  const panels = el("div", { className: `lx-done-panels${sections.length > 1 ? " is-pair" : ""}`, children: sections.splice(0) });
  sections.push(panels);

  const chips = [...new Set([...model.newCodes, ...model.practicedCodes])].slice(0, 12).map((code) => {
    const country = countryOf(model.countryIndex, code);
    return el("button", {
      className: `lx-chip${model.newCodes.includes(code) ? " is-new" : ""}`,
      attrs: { type: "button", "aria-label": `About ${country?.name ?? code}` },
      children: [flagImage(country, "lx-flag lx-flag-chip", true), el("span", { text: country?.name ?? code })],
      on: { click: () => model.onOpenCountry?.(code) },
    });
  });
  if (chips.length) sections.push(el("section", { className: "lx-done-chips", attrs: { "aria-label": "Countries in this lesson" }, children: chips }));

  const buttons: HTMLElement[] = [];
  if (model.primary) buttons.push(actionButton(model.primary, "lx-btn lx-btn-primary lx-done-next", true));
  if (model.review) buttons.push(actionButton(model.review, "lx-btn lx-btn-secondary lx-done-review"));
  buttons.push(actionButton(model.back, "lx-btn lx-btn-ghost lx-done-back"));

  const heading = el("h2", { className: "lx-done-title", text: model.title, attrs: { tabindex: "-1" } });
  const view = el("section", {
    className: "lx-done",
    attrs: { "data-phase": "complete" },
    children: [
      confetti(30, model.random),
      el("div", {
        className: "lx-done-card",
        children: [
          el("div", { className: "lx-done-seal", attrs: { "aria-hidden": "true" }, children: [icon("check")] }),
          heading,
          el("p", { className: "lx-done-sub", text: `${model.subtitle} ${accuracyLine(percent)}`.trim() }),
          stats,
          ...sections,
          el("div", { className: "lx-done-actions", children: buttons }),
        ],
      }),
    ],
  });
  animateMeters(view);
  return view;
}

function stat(value: string, label: string, note: string): HTMLElement {
  return el("div", {
    className: "lx-stat",
    children: [el("strong", { text: value }), el("span", { className: "lx-stat-label", text: label }), el("span", { className: "lx-stat-note", text: note })],
  });
}

function actionButton(action: CompletionAction, className: string, withArrow = false): HTMLButtonElement {
  return el("button", {
    className,
    attrs: { type: "button" },
    children: [document.createTextNode(action.label), ...(withArrow ? [icon("arrow")] : [])],
    on: { click: action.run },
  });
}

// ---------------------------------------------------------------------------------------------

export function createMessageView(options: {
  readonly tone: "calm" | "lost" | "done";
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly actions: readonly (CompletionAction & { readonly primary?: boolean })[];
}): HTMLElement {
  return el("section", {
    className: `lx-message is-${options.tone}`,
    children: [
      el("div", { className: "lx-message-art", attrs: { "aria-hidden": "true" }, children: [icon(options.tone === "lost" ? "compass" : options.tone === "done" ? "check" : "book")] }),
      el("p", { className: "lx-kicker", children: [el("span", { className: "lx-kicker-skill", text: options.kicker })] }),
      el("h2", { className: "lx-message-title", text: options.title, attrs: { tabindex: "-1" } }),
      el("p", { className: "lx-message-body", text: options.body }),
      el("div", {
        className: "lx-message-actions",
        children: options.actions.map((action) =>
          el("button", { className: `lx-btn ${action.primary ? "lx-btn-primary" : "lx-btn-ghost"}`, text: action.label, attrs: { type: "button" }, on: { click: action.run } }),
        ),
      }),
    ],
  });
}
