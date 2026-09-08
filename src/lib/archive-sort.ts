export function getArchiveSortKey(body: string): string {
    const match = body.match(/[\p{L}\p{N}]/u);
    return match ? body.slice(match.index).toLocaleLowerCase() : body.toLocaleLowerCase();
}

export function sortArchiveItems<T extends { body: string; id: string }>(
    items: T[],
): T[] {
    return items.sort((a, b) =>
        getArchiveSortKey(a.body).localeCompare(getArchiveSortKey(b.body)) ||
        a.id.localeCompare(b.id)
    );
}
