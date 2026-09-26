import type { Screen } from "../../app/router";
import type { AcademyProgressStore } from "../../app/academyProgress";
import type { CountryIndex } from "../../core/countries";
import type { WorldCountryFeature } from "../../core/map";
import { el } from "../dom/createElement";

export interface LessonScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly progressStore: AcademyProgressStore;
  /** Group id, "review", or "lookalikes:<CODE>". */
  readonly lessonId: string;
  /** Back to the Academy hub, optionally opening a group's panel. */
  readonly onExit: (groupId?: string) => void;
  readonly onStartLesson: (lessonId: string) => void;
  readonly onOpenCountry: (code: string) => void;
}

// Placeholder — replaced by the lesson player build.
export function createLessonScreen(_options: LessonScreenOptions): Screen {
  return { element: el("section", { className: "lesson-screen", children: [el("h1", { text: "Lesson" })] }), destroy: () => undefined };
}
