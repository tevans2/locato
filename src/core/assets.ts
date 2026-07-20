/**
 * Public assets must be rooted at the site origin. Relative paths break when a
 * game is opened directly through a shareable route such as `/play/flags`.
 */
export function rootAssetPath(path: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(path)) return path;
  return `/${path.replace(/^\.\//, "")}`;
}
