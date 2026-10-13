export type JournalImageClass = "V" | "H" | "S";
export type JournalSide = 0 | 1; // 0 = left, 1 = right

export type JournalLayoutResult = {
  sides: JournalSide[];
  leftWeight: number;
  rightWeight: number;
  balance: number;
  repeats: number;
};

function isHorizontalClass(imageClass: JournalImageClass): boolean {
  return imageClass !== "V";
}

function isValidSequence(
  classes: JournalImageClass[],
  sides: JournalSide[],
): boolean {
  for (let i = 1; i < sides.length; i++) {
    if (sides[i] !== sides[i - 1]) continue;

    // Same-side adjacency is allowed only for H/S + H/S.
    if (
      !isHorizontalClass(classes[i - 1]) ||
      !isHorizontalClass(classes[i])
    ) {
      return false;
    }

    // After a same-side H/S pair, the next image must switch sides.
    if (i >= 2 && sides[i - 2] === sides[i]) {
      return false;
    }
  }

  return true;
}

function describe(
  classes: JournalImageClass[],
  sides: JournalSide[],
): JournalLayoutResult {
  let leftWeight = 0;
  let rightWeight = 0;
  let repeats = 0;

  for (let i = 0; i < sides.length; i++) {
    const weight = classes[i] === "V" ? 2 : 1;
    if (sides[i] === 0) leftWeight += weight;
    else rightWeight += weight;

    if (i > 0 && sides[i] === sides[i - 1]) repeats++;
  }

  return {
    sides,
    leftWeight,
    rightWeight,
    balance: Math.abs(leftWeight - rightWeight),
    repeats,
  };
}

/**
 * Chooses a valid side sequence with minimum weighted imbalance.
 * For the first Journal article, forceFirstLeft is true and no historical
 * entropy is applied because there are no previously published Journal articles.
 * Equal candidates are resolved deterministically by L-before-R lexical order.
 */
export function chooseJournalSides(
  classes: JournalImageClass[],
  options: { forceFirstLeft?: boolean } = {},
): JournalLayoutResult {
  if (classes.length === 0) {
    return { sides: [], leftWeight: 0, rightWeight: 0, balance: 0, repeats: 0 };
  }

  const candidates: JournalLayoutResult[] = [];
  const sides: JournalSide[] = [];

  function enumerate(index: number): void {
    if (index === classes.length) {
      if (!isValidSequence(classes, sides)) return;
      candidates.push(describe(classes, [...sides]));
      return;
    }

    const choices: JournalSide[] =
      index === 0 && options.forceFirstLeft ? [0] : [0, 1];

    for (const side of choices) {
      sides.push(side);
      // Validate each prefix early; later images cannot make an invalid
      // adjacent pair valid again.
      if (isValidSequence(classes.slice(0, sides.length), sides)) {
        enumerate(index + 1);
      }
      sides.pop();
    }
  }

  enumerate(0);

  candidates.sort((a, b) => {
    if (a.balance !== b.balance) return a.balance - b.balance;
    const aKey = a.sides.join("");
    const bKey = b.sides.join("");
    return aKey.localeCompare(bKey);
  });

  // Every single-image sequence is valid; this fallback is defensive only.
  return candidates[0] ?? describe(classes, classes.map((_, i) => (i % 2) as JournalSide));
}
