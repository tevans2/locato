import type { Screen } from "../../app/router";
import type { AcademyProgressStore } from "../../app/academyProgress";
import type { CountryIndex } from "../../core/countries";
import type { WorldCountryFeature } from "../../core/map";
import { el } from "../dom/createElement";

export interface PlacementScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly progressStore: AcademyProgressStore;
  /** Placement finished or skipped: go to the hub, opening the suggested group if any. */
  readonly onDone: (suggestedGroupId?: string) => void;
  readonly onStartLesson: (lessonId: string) => void;
}

// Placeholder — replaced by the placement quiz build.
export function createPlacementScreen(_options: PlacementScreenOptions): Screen {
  return { element: el("section", { className: "placement-screen", children: [el("h1", { text: "Placement" })] }), destroy: () => undefined };
}
