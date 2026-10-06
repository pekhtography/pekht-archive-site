"use client";

import * as React from "react";
import { BlogCard } from "@/components/client/BlogCard";
import type { blogConfig } from "@/lib/types";
import { FilterControls, useFilter } from "@/hooks/useFilter";
import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 12;

export default function FilterBlog({ items }: { items: blogConfig[] }) {
  const filter = useFilter(items, "blog");
  const { filteredAndSortedItems } = filter;
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    setPage(1);
  }, [filter.category, filter.selectedTags, filter.sortOrder]);

  const lastPage = Math.max(1, Math.ceil(filteredAndSortedItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, lastPage);
  const pageItems = filteredAndSortedItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const goToPage = (nextPage: number) => {
    setPage(Math.max(1, Math.min(lastPage, nextPage)));
  };

  return (
    <div className="flex flex-col gap-3 animation">
      <FilterControls filter={filter} />

      {filteredAndSortedItems.length === 0 ? (
        <div className="flex items-center justify-center border border-border p-6">
          <p className="paragraph">No Journal entries found.</p>
        </div>
      ) : (
        <div className="space-y-0 border border-border p-6">
          {pageItems.map((item) => (
            <BlogCard key={item.id} item={item as blogConfig} />
          ))}
        </div>
      )}

      {filteredAndSortedItems.length > 0 && (
        <nav
          className="relative mt-7 flex min-h-16 items-center justify-between border border-border p-4"
          aria-label="Journal pages"
        >
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            aria-label="Previous Journal page"
            className="z-20"
          >
            <RiArrowLeftSLine className="size-5 fill-muted-foreground" />
          </Button>

          <div className="relative mx-5 h-8 flex-1">
            <div className="absolute left-8 right-8 top-1/2 h-px -translate-y-1/2 bg-foreground/35" />

            <button
              type="button"
              aria-label="Go to Journal page"
              className="absolute left-8 right-8 top-1/2 z-10 h-8 -translate-y-1/2 cursor-pointer"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const progress = Math.max(
                  0,
                  Math.min(1, (event.clientX - rect.left) / rect.width),
                );
                goToPage(
                  lastPage === 1
                    ? 1
                    : Math.round(1 + progress * (lastPage - 1)),
                );
              }}
            />

            <span className="absolute left-0 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-[min(var(--radius-md),10px)] border border-border bg-background text-sm text-muted-foreground">
              1
            </span>

            <span className="absolute right-0 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-[min(var(--radius-md),10px)] border border-border bg-background text-sm text-muted-foreground">
              {lastPage}
            </span>

            <span
              className="pointer-events-none absolute top-1/2 z-20 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[min(var(--radius-md),10px)] border border-border bg-secondary text-sm text-secondary-foreground transition-all duration-200"
              style={{
                left: `${lastPage === 1 ? 0 : ((currentPage - 1) / (lastPage - 1)) * 100}%`,
              }}
            >
              {currentPage}
            </span>
          </div>

          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === lastPage}
            aria-label="Next Journal page"
            className="z-20"
          >
            <RiArrowRightSLine className="size-5 fill-muted-foreground" />
          </Button>
        </nav>
      )}
    </div>
  );
}
