import type { PasswordHasher } from "./types";

// Bun's built-in password hashing (argon2id by default). This module touches the Bun global, so
// it is imported only by the Bun server entrypoint — never by the Node/vitest test graph.
export const bunPasswordHasher: PasswordHasher = {
  hash: (password) => Bun.password.hash(password),
  verify: (password, hash) => Bun.password.verify(password, hash),
};
