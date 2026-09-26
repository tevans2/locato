import type { Screen } from "../../app/router";
import type { AcademyProgressStore } from "../../app/academyProgress";
import type { CountryIndex } from "../../core/countries";
import type { WorldCountryFeature } from "../../core/map";
import { el } from "../dom/createElement";

export interface AcademyScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly progressStore: AcademyProgressStore;
  /** Group whose detail panel is open (mirrored in the URL). */
  readonly initialGroupId?: string;
  readonly onHome: () => void;
  readonly onBack: () => void;
  /** Group id, "review", or "lookalikes:<CODE>". */
  readonly onStartLesson: (lessonId: string) => void;
  readonly onStartPlacement: () => void;
  readonly onOpenCountry: (code: string) => void;
  /** Called when the open group changes so the URL can follow (replaces, not pushes). */
  readonly onGroupChange: (groupId: string | null) => void;
}

// Placeholder — replaced by the Academy hub build.
export function createAcademyScreen(_options: AcademyScreenOptions): Screen {
  return { element: el("section", { className: "academy-screen", children: [el("h1", { text: "Academy" })] }), destroy: () => undefined };
}
