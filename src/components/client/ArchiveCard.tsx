import type { CollectionEntry } from "astro:content";

type ArchiveItem = CollectionEntry<"archive">;

export function ArchiveCard({ item }: { item: ArchiveItem }) {
  return (
    <article className="border border-border bg-background overflow-hidden">
      <img
        src={item.data.image}
        alt={item.data.title}
        className="w-full"
      />

      <div className="p-6">
        <div className="whitespace-pre-line text-base leading-relaxed">
          {item.body}
        </div>

        {item.data.hashtags.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2">
            {item.data.hashtags.map((tag) => (
              <span
                key={tag}
                className="text-sm text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
