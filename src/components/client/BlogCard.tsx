import type { blogConfig } from "@/lib/types";

import { RiArrowRightUpLine } from "@remixicon/react";
import { format, parse } from "date-fns";
import { sitePath } from "@/lib/site-url";

export function BlogCard({ item }: { item: blogConfig }) {
  const parsedDate = parse(item.data.date, "dd-MM-yyyy", new Date());
  const formattedDate = format(parsedDate, "MMM d, yyyy");
  const isJournal = item.data.category === "journal";

  return (
    <a
      href={sitePath(`/blog/${item.id}`)}
      className={`group flex border border-border/50 hover:border-border hover:bg-muted active:border-border animation hover:scale-102 active:scale-100 select-none ${isJournal ? "flex-row gap-0 overflow-hidden p-0" : "flex-col gap-2 p-3"}`}
    >
      {isJournal && item.previewImage && (
        <div className="relative aspect-[4/3] w-[36%] shrink-0 overflow-hidden">
          <img
            src={sitePath(item.previewImage)}
            alt={item.data.title}
            loading="lazy"
            className="h-full w-full object-cover grayscale-100 group-hover:grayscale-0 animation"
          />
        </div>
      )}

      <div className={`flex min-w-0 flex-1 flex-col gap-2 ${isJournal ? "p-3" : ""}`}>
        <div className="flex items-center justify-between gap-3">
          {isJournal ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="shrink-0 text-sm text-muted-foreground/80 animation">
                {formattedDate}
              </span>
              {item.data.facets?.map((facet) => (
                <span
                  key={facet}
                  className="text-xs px-3 py-1 bg-muted text-muted-foreground border border-border rounded group-hover:bg-background animation"
                >
                  {facet}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground group-hover:bg-background group-hover:px-2 animation px-1">
              {item.data.category}
            </span>
          )}
          <div className="flex items-center gap-2 shrink-0 pt-1">
            {!isJournal && (
              <span className="text-sm text-muted-foreground/80 group-hover:translate-x-0 translate-x-6 animation">
                {formattedDate}
              </span>
            )}
            <RiArrowRightUpLine className="size-5 scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-100 group-hover:text-muted-foreground/80 group-active:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />
          </div>
        </div>
        <div className="flex flex-col items-start justify-start px-1">
          <h3 className={`text-lg font-medium leading-snug text-foreground/90 group-hover:text-foreground/90 animation ${isJournal ? "line-clamp-2" : "line-clamp-1"}`}>
            {item.data.title}
          </h3>
          {!isJournal && (
            <p className="mt-0.5 text-base text-muted-foreground line-clamp-1">
              {item.data.description}
            </p>
          )}
        </div>
      </div>
    </a>
  );
}
