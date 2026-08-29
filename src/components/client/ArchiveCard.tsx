import type { CollectionEntry } from "astro:content";

type ArchiveItem = CollectionEntry<"archive">;

export function ArchiveCard({ item }: { item: ArchiveItem }) {
  return (
    <a
      href={`/archive/${item.id}`}
      className="group block overflow-hidden border border-border bg-background"
    >
      <div className="relative aspect-square overflow-hidden">
        <img
          src={item.data.image}
          alt={item.data.title}
          loading="lazy"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />

        <div className="absolute inset-0 flex items-end bg-black/0 p-5 transition duration-300 group-hover:bg-black/45">
          <div className="translate-y-4 text-white opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <p className="line-clamp-4 whitespace-pre-line text-base leading-relaxed">
              {item.body}
            </p>
          </div>
        </div>
      </div>
    </a>
  );
}
