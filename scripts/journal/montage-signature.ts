export type MontageSignatureBlock = Record<string, unknown>;

/**
 * Identifies the editorial montage, not its visual layout.
 * Side assignment is intentionally excluded so a left/right inversion
 * cannot make the same source order and text look like a new montage.
 */
export function createMontageSignature(
  sourceIds: readonly string[],
  markdown: string,
  composition: readonly MontageSignatureBlock[],
): string {
  const editorialComposition = composition.map((block) =>
    Object.fromEntries(
      Object.entries(block).filter(([key]) => key !== "image_side"),
    ),
  );

  return JSON.stringify({
    source_ids: [...sourceIds],
    markdown: String(markdown ?? "").trim(),
    composition: editorialComposition,
  });
}
