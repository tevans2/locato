import type { Screen } from "../../app/router";
import type { AcademyProgressStore } from "../../app/academyProgress";
import type { CountryIndex } from "../../core/countries";
import type { WorldCountryFeature } from "../../core/map";
import { el } from "../dom/createElement";

export interface CountryProfileScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly progressStore: AcademyProgressStore;
  /** ISO alpha-2, upper case. May be unknown — render a friendly not-found state. */
  readonly code: string;
  readonly onBack: () => void;
  readonly onHome: () => void;
  /** Open another country's profile (neighbours, lookalikes). */
  readonly onOpenCountry: (code: string) => void;
  readonly onStartLesson: (lessonId: string) => void;
  readonly onOpenAcademy: (groupId?: string) => void;
}

// Placeholder — replaced by the country profile build.
export function createCountryProfileScreen(_options: CountryProfileScreenOptions): Screen {
  return { element: el("section", { className: "country-profile-screen", children: [el("h1", { text: "Country" })] }), destroy: () => undefined };
}
