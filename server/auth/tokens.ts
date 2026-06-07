// User ids are opaque identifiers; session tokens are security-sensitive bearer values, so they
// use 256 bits of CSPRNG output (base64url) rather than a UUID.
export function createUserId(): string {
  return crypto.randomUUID();
}

export function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
