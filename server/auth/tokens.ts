// Portable base64url encoder — works in Bun, Node, and browsers (no Buffer dependency).
function toBase64Url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...Array.from(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// User ids are opaque identifiers; session/state tokens are security-sensitive bearer values,
// so they use CSPRNG output (base64url) rather than UUIDs.
export function createUserId(): string {
  return crypto.randomUUID();
}

export function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function createOAuthState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}
