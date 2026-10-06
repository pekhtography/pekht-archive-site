"use client";

import * as React from "react";
import { format, parse } from "date-fns";
import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function JournalCalendar({
  dates,
  selectedDate,
  onSelect,
}: {
  dates: string[];
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}) {
  const publicationDates = React.useMemo(
    () =>
      Array.from(new Set(dates))
        .map((date) => parse(date, "dd-MM-yyyy", new Date()))
        .sort((a, b) => a.getTime() - b.getTime()),
    [dates],
  );

  const [position, setPosition] = React.useState(
    Math.max(publicationDates.length - 1, 0),
  );

  React.useEffect(() => {
    if (!publicationDates.length) {
      setPosition(0);
      return;
    }

    const selectedIndex = selectedDate
      ? publicationDates.findIndex((date) => format(date, "dd-MM-yyyy") === selectedDate)
      : publicationDates.length - 1;

    setPosition(selectedIndex >= 0 ? selectedIndex : publicationDates.length - 1);
  }, [selectedDate, publicationDates]);

  if (!publicationDates.length) return null;

  const selectPosition = (nextPosition: number) => {
    const clamped = Math.max(0, Math.min(publicationDates.length - 1, nextPosition));
    setPosition(clamped);

    const value = format(publicationDates[clamped], "dd-MM-yyyy");
    onSelect(selectedDate === value ? null : value);
  };

  const currentDate = publicationDates[position];

  return (
    <section className="mt-10 border border-border p-4 md:p-5" aria-label="Journal publication timeline">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Publications
        </span>
        <span className="text-sm text-foreground">
          {format(currentDate, "d MMM yyyy")}
        </span>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => selectPosition(position - 1)}
          disabled={position === 0}
          aria-label="Previous publication date"
        >
          <RiArrowLeftSLine className="size-4" />
        </Button>

        <div className="relative h-8 flex-1">
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-foreground/35" />

          {publicationDates.map((date, index) => {
            const left =
              publicationDates.length === 1
                ? 50
                : (index / (publicationDates.length - 1)) * 100;
            const active = index === position;

            return (
              <button
                key={format(date, "dd-MM-yyyy")}
                type="button"
                aria-label={format(date, "d MMMM yyyy")}
                onClick={() => selectPosition(index)}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${left}%` }}
              >
                <span
                  className={cn(
                    "block size-2 border border-border bg-background transition-all duration-200",
                    active && "size-8 rounded-[min(var(--radius-md),10px)] bg-secondary",
                  )}
                >
                  <span className={cn("sr-only", active && "not-sr-only")}>
                    {format(date, "d MMM yyyy")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => selectPosition(position + 1)}
          disabled={position === publicationDates.length - 1}
          aria-label="Next publication date"
        >
          <RiArrowRightSLine className="size-4" />
        </Button>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{format(publicationDates[0], "d MMM yyyy")}</span>
        <span>{publicationDates.length} {publicationDates.length === 1 ? "date" : "dates"}</span>
        <span>{format(publicationDates[publicationDates.length - 1], "d MMM yyyy")}</span>
      </div>

      {selectedDate && (
        <button
          type="button"
          className="mt-3 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onSelect(null)}
        >
          Clear date
        </button>
      )}
    </section>
  );
}
