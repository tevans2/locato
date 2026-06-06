const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NON_ALNUM = /[^a-z0-9]+/g;
const SPACES = /\s+/g;

export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(st|ste)\./g, " saint ")
    .replace(NON_ALNUM, " ")
    .replace(SPACES, " ")
    .trim();
}

export function addNormalizedAnswer(target: Set<string>, value: string): void {
  const normalized = normalizeAnswer(value);
  if (normalized.length > 0) target.add(normalized);
}
