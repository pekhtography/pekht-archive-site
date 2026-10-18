import test from "node:test";
import assert from "node:assert/strict";
import { findMissingJournalSources } from "../../src/lib/journal-source-validation.ts";

function article(
    id: string,
    overrides: Partial<{
        draft: boolean;
        category: string;
        composition: Array<{ type: string; source_id?: string }>;
    }> = {},
) {
    return {
        id,
        data: {
            draft: false,
            category: "journal",
            composition: [{ type: "source", source_id: "archive-a" }],
            ...overrides,
        },
    };
}

test("accepts published Journal source IDs present in the archive", () => {
    assert.deepEqual(
        findMissingJournalSources([article("journal-a")], ["archive-a"]),
        [],
    );
});

test("reports missing source IDs with the article ID", () => {
    assert.deepEqual(
        findMissingJournalSources([article("journal-a")], []),
        [{ articleId: "journal-a", sourceId: "archive-a" }],
    );
});

test("checks only published Journal source blocks and deduplicates missing IDs per article", () => {
    const articles = [
        article("journal-a", {
            composition: [
                { type: "source", source_id: "missing" },
                { type: "bridge" },
                { type: "source", source_id: "missing" },
            ],
        }),
        article("draft-journal", { draft: true }),
        article("non-journal", { category: "engineering" }),
    ];

    assert.deepEqual(
        findMissingJournalSources(articles, []),
        [{ articleId: "journal-a", sourceId: "missing" }],
    );
});
