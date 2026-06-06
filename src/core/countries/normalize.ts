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

export function normalizeAnswerVariants(value: string): readonly string[] {
  const normalized = normalizeAnswer(value);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  const words = normalized.split(" ");
  if (words.length > 1 && words.every((word) => word.length === 1)) {
    variants.add(words.join(""));
  }

  return [...variants];
}

export function compactAnswer(value: string): string {
  return normalizeAnswer(value).replace(/\s+/g, "");
}

export function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    const leftChar = left.charCodeAt(leftIndex - 1);

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = leftChar === right.charCodeAt(rightIndex - 1) ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + cost,
      );
    }

    [previous, current] = [current, previous];
  }

  return previous[right.length]!;
}

export function isToleratedMisspelling(guess: string, answer: string): boolean {
  const compactGuess = compactAnswer(guess);
  const compactCandidate = compactAnswer(answer);
  const length = compactCandidate.length;

  if (compactGuess.length < 5 || length < 5) return false;
  if (Math.abs(compactGuess.length - length) > 3) return false;

  const distance = levenshteinDistance(compactGuess, compactCandidate);
  const limit = length <= 8 ? 1 : length <= 14 ? 2 : 3;
  return distance <= limit;
}

export function addNormalizedAnswer(target: Set<string>, value: string): void {
  for (const normalized of normalizeAnswerVariants(value)) target.add(normalized);
}
