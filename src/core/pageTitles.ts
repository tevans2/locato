// Page titles shared by the server (link previews and search, server/pageMeta.ts) and the app
// (the tab title once it runs). Search engines index the title after scripts run, so the two
// must agree or the app's shorter title would replace the one written for search.

export const DAILY_TITLE = "Locato Daily — today's geography challenge";
export const OVERLAND_DAILY_TITLE = "Locato Overland — today's route";
export const MYSTERY_DAILY_TITLE = "Locato Mystery country — today's mystery";
export const ATLAS_TITLE = "Atlas of every country: flags, capitals and maps · Locato";
export const ACADEMY_TITLE = "Learn every flag and country · Locato Academy";
export const MULTIPLAYER_TITLE = "Multiplayer geography games · Locato";
export const LEADERBOARDS_TITLE = "Geography game leaderboards · Locato";

export function gamePageTitle(label: string): string {
  return `${label}: free geography quiz · Locato`;
}

export function countryPageTitle(name: string): string {
  return `${name}: flag, capital, map and facts · Locato`;
}
