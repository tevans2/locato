const PUBLIC_ORIGIN = "https://locato.quest";

/**
 * A link for shared results: opens the same game and tags the visit `ref=share`, so the admin
 * Growth view can count who arrived through a friend's result. Uses this site's origin
 * (staging links stay on staging), or the public one outside a browser.
 */
export function shareLink(params: Readonly<Record<string, string>>): string {
  const origin = typeof window !== "undefined" && /^https?:/.test(window.location?.origin ?? "") ? window.location.origin : PUBLIC_ORIGIN;
  return `${origin}/?${new URLSearchParams({ ...params, ref: "share" }).toString()}`;
}
