"use client";

import * as React from "react";
import { parse } from "date-fns";
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiFilterFill,
  RiFilterLine,
  RiLoopLeftLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { blogCategoryType, portfolioCategoryType } from "@/lib/types";

type FilterType = "blog" | "portfolio";

interface FilterItem<T extends FilterType> {
  id: string;
  data: {
    date: string;
    title: string;
    category: T extends "blog" ? blogCategoryType : portfolioCategoryType;
    description: string;
    tags: string[];
    facets?: string[];
  };
}

type CategoryFilterType = blogCategoryType | portfolioCategoryType;

interface FilterResult<T extends FilterType> {
  type: T;
  items: FilterItem<T>[];
  filteredAndSortedItems: FilterItem<T>[];
  category: CategoryFilterType | null;
  selectedTags: string[];
  selectedFacets: string[];
  sortOrder: "asc" | "desc";
  setCategory: React.Dispatch<React.SetStateAction<CategoryFilterType | null>>;
  setSelectedTags: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedFacets: React.Dispatch<React.SetStateAction<string[]>>;
  setSortOrder: React.Dispatch<React.SetStateAction<"asc" | "desc">>;
  handleReset: () => void;
  isFilterActive: boolean;
  allCategories: CategoryFilterType[];
  allFacets: string[];
  allTags: string[];
  handleCategoryChange: (cat: CategoryFilterType) => void;
  handleFacetToggle: (facet: string) => void;
  handleTagToggle: (tag: string) => void;
  filterOpen: boolean;
  setFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const PORTFOLIO_CATEGORIES: portfolioCategoryType[] = [
  "robotics",
  "analytics",
  "gameplay",
  "software",
  "ai",
];

function getItemTags<T extends FilterType>(item: FilterItem<T>): string[] {
  return item.data.tags || [];
}

function getItemFacets<T extends FilterType>(item: FilterItem<T>): string[] {
  return item.data.facets || [];
}

function getItemCategory<T extends FilterType>(item: FilterItem<T>): string {
  return item.data.category || "";
}

export function useFilter<T extends FilterType>(
  items: FilterItem<T>[],
  type: T = "blog" as T,
): FilterResult<T> {
  const [category, setCategory] =
    React.useState<CategoryFilterType | null>(null);
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [selectedFacets, setSelectedFacets] = React.useState<string[]>([]);
  const [sortOrder, setSortOrder] =
    React.useState<"asc" | "desc">("desc");
  const [filterOpen, setFilterOpen] = React.useState(false);

  const allCategories = React.useMemo(
    () =>
      type === "portfolio"
        ? (Array.from(
            new Set(items.map(getItemCategory).filter(Boolean)),
          ) as CategoryFilterType[])
        : [],
    [items, type],
  );

  const allTags = React.useMemo(() => {
    if (type === "blog") return [];
    return Array.from(
      new Set(items.flatMap(getItemTags).filter(Boolean)),
    ).sort();
  }, [items, type]);

  const allFacets = React.useMemo(
    () =>
      type === "blog"
        ? Array.from(
            new Set(items.flatMap(getItemFacets).filter(Boolean)),
          ).sort()
        : [],
    [items, type],
  );

  const isFilterActive =
    (type === "blog"
      ? selectedFacets.length > 0
      : category !== null || selectedTags.length > 0);

  const filteredAndSortedItems = React.useMemo(() => {
    let result = [...items];

    if (type === "portfolio" && category !== null) {
      result = result.filter((item) => getItemCategory(item) === category);
    }

    if (type === "blog" && selectedFacets.length > 0) {
      result = result.filter((item) => {
        const facets = getItemFacets(item);
        return selectedFacets.some((facet) => facets.includes(facet));
      });
    }

    if (type === "portfolio" && selectedTags.length > 0) {
      result = result.filter((item) => {
        const tags = getItemTags(item);
        return selectedTags.some((tag) => tags.includes(tag));
      });
    }

    result.sort((a, b) => {
      const dateA = parse(a.data.date, "dd-MM-yyyy", new Date());
      const dateB = parse(b.data.date, "dd-MM-yyyy", new Date());
      return sortOrder === "desc"
        ? dateB.getTime() - dateA.getTime()
        : dateA.getTime() - dateB.getTime();
    });

    return result;
  }, [items, type, category, selectedTags, selectedFacets, sortOrder]);

  const handleReset = () => {
    setCategory(null);
    setSelectedTags([]);
    setSelectedFacets([]);
    setSortOrder("desc");
  };

  const handleCategoryChange = (cat: CategoryFilterType) => {
    setCategory((prev) => (prev === cat ? null : cat));
  };

  const handleFacetToggle = (facet: string) => {
    setSelectedFacets((prev) =>
      prev.includes(facet)
        ? prev.filter((item) => item !== facet)
        : [...prev, facet],
    );
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag)
        ? prev.filter((item) => item !== tag)
        : [...prev, tag],
    );
  };

  return {
    type,
    items,
    filteredAndSortedItems,
    category,
    selectedTags,
    selectedFacets,
    sortOrder,
    setCategory,
    setSelectedTags,
    setSelectedFacets,
    setSortOrder,
    handleReset,
    isFilterActive,
    allCategories,
    allFacets,
    allTags,
    handleCategoryChange,
    handleFacetToggle,
    handleTagToggle,
    filterOpen,
    setFilterOpen,
  };
}

interface FilterControlsProps<T extends FilterType> {
  filter: FilterResult<T>;
}

export function FilterControls<T extends FilterType>({
  filter,
}: FilterControlsProps<T>) {
  const {
    type,
    isFilterActive,
    sortOrder,
    handleReset,
    filterOpen,
    setFilterOpen,
    allCategories,
    allFacets,
    allTags,
    selectedFacets,
    selectedTags,
    handleCategoryChange,
    handleFacetToggle,
    handleTagToggle,
    setSortOrder,
    category,
  } = filter;

  const values = type === "blog" ? allFacets : allTags;
  const selectedValues = type === "blog" ? selectedFacets : selectedTags;

  return (
    <div className="flex items-center gap-2 justify-end px-3">
      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        <PopoverTrigger
          render={
            <Button
              variant={isFilterActive ? "secondary" : "outline"}
              size="icon-sm"
              className={cn("cursor-pointer", isFilterActive && "bg-muted")}
              aria-label={type === "blog" ? "Filter Journal" : "Filter"}
            >
              {isFilterActive ? (
                <RiFilterFill className="fill-muted-foreground" />
              ) : (
                <RiFilterLine className="fill-muted-foreground" />
              )}
            </Button>
          }
        />
        <PopoverContent
          align="end"
          className="flex w-50 flex-col gap-3 p-3 -translate-y-9"
          sideOffset={4}
        >
          {type === "portfolio" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                Category
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => handleCategoryChange(cat)}
                    className={cn(
                      "cursor-pointer text-xs px-2 py-0.5 rounded border border-border",
                      category === cat
                        ? "bg-secondary-foreground text-secondary"
                        : "bg-transparent text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {type === "blog" ? "Filter" : "Tags"}
            </p>
            {values.length > 0 ? (
              <div className="max-h-48 overflow-y-auto overflow-x-hidden no-scrollbar pr-1">
                {values.map((value) => (
                  <label
                    key={value}
                    className="px-2 hover:bg-muted rounded-md flex cursor-pointer items-center justify-between gap-2 py-1"
                  >
                    <span className="text-sm text-muted-foreground">
                      {value}
                    </span>
                    <Checkbox
                      checked={selectedValues.includes(value)}
                      onCheckedChange={() =>
                        type === "blog"
                          ? handleFacetToggle(value)
                          : handleTagToggle(value)
                      }
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="px-2 py-1 text-sm text-muted-foreground">
                No filters yet.
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex gap-1">
        <Button
          variant={sortOrder === "asc" ? "secondary" : "outline"}
          size="icon-sm"
          onClick={() => setSortOrder("asc")}
          className="cursor-pointer"
          aria-label="Oldest first"
        >
          <RiArrowUpSLine className="size-5 fill-muted-foreground" />
        </Button>
        <Button
          variant={sortOrder === "desc" ? "secondary" : "outline"}
          size="icon-sm"
          onClick={() => setSortOrder("desc")}
          className="cursor-pointer"
          aria-label="Newest first"
        >
          <RiArrowDownSLine className="size-5 fill-muted-foreground" />
        </Button>
      </div>

      <Button
        variant={isFilterActive ? "outline" : "secondary"}
        size="icon-sm"
        onClick={handleReset}
        disabled={!isFilterActive}
        className={cn(
          "cursor-pointer",
          !isFilterActive && "cursor-not-allowed",
        )}
        aria-label="Reset Journal filters"
      >
        <RiLoopLeftLine className="size-4 fill-muted-foreground" />
      </Button>
    </div>
  );
}
