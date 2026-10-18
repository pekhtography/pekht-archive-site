export type JournalSourceReference = {
    type: string;
    source_id?: string;
};

export type JournalArticleReference = {
    id: string;
    data: {
        draft: boolean;
        category: string;
        composition: JournalSourceReference[];
    };
};

export function findMissingJournalSources(
    articles: JournalArticleReference[],
    archiveIds: Iterable<string>,
): Array<{ articleId: string; sourceId: string }> {
    const knownArchiveIds = new Set(archiveIds);
    const missing: Array<{ articleId: string; sourceId: string }> = [];

    for (const article of articles) {
        if (article.data.draft || article.data.category !== "journal") continue;

        const seen = new Set<string>();
        for (const block of article.data.composition) {
            if (block.type !== "source" || !block.source_id) continue;
            if (knownArchiveIds.has(block.source_id) || seen.has(block.source_id)) continue;

            seen.add(block.source_id);
            missing.push({ articleId: article.id, sourceId: block.source_id });
        }
    }

    return missing;
}
