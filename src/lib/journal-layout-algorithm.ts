export type ImageOrientation = "V" | "H" | "S";
export type ImageSide = "left" | "right";

export interface JournalLayoutArticle {
  sides: ImageSide[];
}

export interface JournalLayoutResult {
  sides: ImageSide[];
  balance: number;
  leftWeight: number;
  rightWeight: number;
  kA: number;
  kB: number;
  kTotal: number;
  validCandidates: number;
}

const sideCode = (side: ImageSide): 0 | 1 => side === "left" ? 0 : 1;
const weightOf = (orientation: ImageOrientation): number => orientation === "V" ? 2 : 1;

function repeatCount(sides: ImageSide[]): number {
  let repeats = 0;
  for (let i = 1; i < sides.length; i += 1) {
    if (sides[i] === sides[i - 1]) repeats += 1;
  }
  return repeats;
}

function entropy<T>(values: T[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let result = 0;
  for (const count of counts.values()) {
    const p = count / values.length;
    result -= p * Math.log(p);
  }
  return result;
}

function statistics(historyAndCandidate: JournalLayoutArticle[]): {
  kA: number;
  kB: number;
  kTotal: number;
} {
  const starts = historyAndCandidate.map((article) => article.sides[0]);
  const kA = entropy(starts) / Math.log(2);
  const repeats = historyAndCandidate.map((article) => repeatCount(article.sides));
  const kB = historyAndCandidate.length <= 1
    ? 0
    : entropy(repeats) / Math.log(historyAndCandidate.length);

  return { kA, kB, kTotal: Math.sqrt(kA * kB) };
}

function obeysHardConstraints(
  orientations: ImageOrientation[],
  sides: ImageSide[],
): boolean {
  for (let i = 0; i < orientations.length - 1; i += 1) {
    const current = orientations[i] === "S" ? "H" : orientations[i];
    const next = orientations[i + 1] === "S" ? "H" : orientations[i + 1];

    if ((current === "V" || next === "V") && sides[i] === sides[i + 1]) {
      return false;
    }

    // An H-H pair on the same side requires the following image to switch sides.
    // The final pair is exempt because there is no following image.
    if (
      current === "H" &&
      next === "H" &&
      sides[i] === sides[i + 1] &&
      i + 2 < orientations.length &&
      sides[i + 2] === sides[i + 1]
    ) {
      return false;
    }
  }

  return true;
}

function compareLexicographically(a: ImageSide[], b: ImageSide[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const difference = sideCode(a[i]) - sideCode(b[i]);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function scoreBalance(
  orientations: ImageOrientation[],
  sides: ImageSide[],
): { leftWeight: number; rightWeight: number; balance: number } {
  let leftWeight = 0;
  let rightWeight = 0;

  orientations.forEach((orientation, index) => {
    if (sides[index] === "left") leftWeight += weightOf(orientation);
    else rightWeight += weightOf(orientation);
  });

  return { leftWeight, rightWeight, balance: Math.abs(leftWeight - rightWeight) };
}

/**
 * Deterministically chooses a side for each image.
 * The caller must supply verified orientations in source order; this module
 * deliberately does not guess dimensions or silently recover from missing data.
 */
export function calculateJournalLayout(
  orientations: ImageOrientation[],
  history: JournalLayoutArticle[] = [],
): JournalLayoutResult {
  if (orientations.length === 0) {
    throw new Error("Cannot calculate a Journal layout with no source images.");
  }
  if (orientations.some((orientation) => !["V", "H", "S"].includes(orientation))) {
    throw new Error("Every image must have a verified V, H, or S orientation.");
  }

  const priorArticles = history.slice(-9);
  let best: JournalLayoutResult | undefined;
  let validCandidates = 0;
  const candidate: ImageSide[] = [];

  const visit = (index: number): void => {
    if (index === orientations.length) {
      if (!obeysHardConstraints(orientations, candidate)) return;
      validCandidates += 1;

      const sides = [...candidate];
      const balanceScore = scoreBalance(orientations, sides);
      const stats = priorArticles.length === 0
        ? { kA: 0, kB: 0, kTotal: 0 }
        : statistics([...priorArticles, { sides }]);
      const result: JournalLayoutResult = {
        sides,
        ...balanceScore,
        ...stats,
        validCandidates: 0,
      };

      if (
        !best ||
        result.balance < best.balance ||
        (
          result.balance === best.balance &&
          (
            result.kTotal > best.kTotal ||
            (result.kTotal === best.kTotal && compareLexicographically(result.sides, best.sides) < 0)
          )
        )
      ) {
        best = result;
      }
      return;
    }

    const options: ImageSide[] = index === 0 && priorArticles.length === 0
      ? ["left"]
      : ["left", "right"];

    for (const side of options) {
      candidate.push(side);
      visit(index + 1);
      candidate.pop();
    }
  };

  visit(0);

  if (!best) {
    throw new Error("No side assignment satisfies the Journal hard constraints.");
  }

  return { ...best, validCandidates };
}
