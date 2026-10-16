import { writeFile } from "node:fs/promises";
import type { JournalRunOptions } from "../journal-orchestrator.ts";
import { assertCompleteJournalLayout, type JournalCompositionSideBlock } from "../../src/lib/journal-layout-algorithm.ts";

type WriteFileFunction = NonNullable<JournalRunOptions["writeFileFn"]>;

/** Validate the final, post-inversion composition before the atomic Markdown write. */
export async function writeJournalArticleSafely(
  articleId: string,
  composition: readonly JournalCompositionSideBlock[],
  outputPath: string,
  markdown: string,
  writeFileFn: WriteFileFunction = writeFile,
): Promise<void> {
  assertCompleteJournalLayout(articleId, composition);
  try {
    await writeFileFn(outputPath, markdown, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new Error(`JOURNAL_OUTPUT_CONFLICT: refusing to overwrite existing publication ${articleId}.md.`);
    }
    throw error;
  }
}
