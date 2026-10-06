"use client";

import * as React from "react";
import { addMonths, format, isSameDay, parse, startOfMonth, subMonths } from "date-fns";
import { RiArrowLeftSLine, RiArrowRightSLine, RiCalendar2Line } from "@remixicon/react";
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
  const [month, setMonth] = React.useState(() => {
    const latest = dates.length ? dates.map((d) => parse(d, "dd-MM-yyyy", new Date())).sort((a, b) => b.getTime() - a.getTime())[0] : new Date();
    return startOfMonth(latest);
  });

  const publishedDays = React.useMemo(
    () => dates.map((date) => parse(date, "dd-MM-yyyy", new Date())),
    [dates],
  );

  const firstDay = startOfMonth(month);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  const cells = Array.from({ length: offset + daysInMonth }, (_, index) => {
    if (index < offset) return null;
    return new Date(month.getFullYear(), month.getMonth(), index - offset + 1);
  });

  const toValue = (day: Date) => format(day, "dd-MM-yyyy");
  const hasPost = (day: Date) => publishedDays.some((date) => isSameDay(date, day));

  return (
    <section className="mt-10 border border-border p-5 md:p-6" aria-label="Journal calendar">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <RiCalendar2Line className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{format(month, "MMMM yyyy")}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => setMonth(subMonths(month, 1))} aria-label="Previous month">
            <RiArrowLeftSLine className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
            <RiArrowRightSLine className="size-4" />
          </Button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => <span key={day} className="py-1">{day}</span>)}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, index) => day ? (
          <button
            key={index}
            type="button"
            disabled={!hasPost(day)}
            onClick={() => onSelect(selectedDate === toValue(day) ? null : toValue(day))}
            className={cn(
              "min-h-9 rounded text-sm transition-colors",
              hasPost(day)
                ? "cursor-pointer text-foreground hover:bg-muted"
                : "cursor-default text-muted-foreground/30",
              selectedDate === toValue(day) && "bg-secondary-foreground text-secondary hover:bg-secondary-foreground",
            )}
          >
            {day.getDate()}
          </button>
        ) : <span key={index} />)}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>{dates.length} {dates.length === 1 ? "publication" : "publications"}</span>
        {selectedDate && (
          <button type="button" className="hover:text-foreground" onClick={() => onSelect(null)}>
            Clear date
          </button>
        )}
      </div>
    </section>
  );
}
