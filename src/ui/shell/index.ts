/**
 * Navigation shell (docs/navigation.md). Import from here:
 *   SiteHeader / TabBar / createSitePage — layout 1, site pages
 *   createGameBar + openGamePicker      — layout 2, game screens
 *   createFocusBar                      — layout 3, lessons, placement, daily stages
 *   createResultsCard, confirmDialog    — shared building blocks
 * React islands: `./react` (SiteHeaderMount, ShellElementMount).
 */
export * from "./types";
export { shellIcon, type ShellIconName } from "./icons";
export { confirmDialog } from "./confirmDialog";
export { createShellControls, createPreferenceMenuItems, type ShellControls } from "./controls";
export { createSiteHeader, createTabBar, createSitePage, createBrandButton, createBackLink, sectionHref, SECTION_ROUTES, type ShellBackLink, type SiteHeaderOptions, type SiteHeaderHandle, type SitePage, type SitePageOptions, type TabBarHandle } from "./SiteHeader";
export { createGameBar, type GameBarHandle, type GameBarMenuItem, type GameBarOptions } from "./GameBar";
export { openGamePicker, createGamePickerContent, type GamePickerHandle, type GamePickerOptions } from "./GamePicker";
export { createFocusBar, type FocusBarClassNames, type FocusBarHandle, type FocusBarOptions } from "./FocusBar";
export { createResultsCard, shareResult, type ResultsAction, type ResultsCardHandle, type ResultsCardOptions, type ResultsMissedCountry, type ResultsShare, type ResultsStat } from "./ResultsCard";
export { shellLayer, trapOverlay } from "./layer";
