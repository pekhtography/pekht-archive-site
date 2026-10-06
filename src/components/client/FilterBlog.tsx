"use client";

import * as React from "react";
import { BlogCard } from "@/components/client/BlogCard";
import type { blogConfig } from "@/lib/types";
import { FilterControls, useFilter } from "@/hooks/useFilter";
import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";

const PAGE_SIZE = 9;

export default function FilterBlog({ items }: { items: blogConfig[] }) {
  const filter = useFilter(items, "blog");
  const { filteredAndSortedItems } = filter;
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    setPage(1);
  }, [filter.selectedFacets, filter.sortOrder]);

  const lastPage = Math.max(1, Math.ceil(filteredAndSortedItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, lastPage);
  const pageItems = filteredAndSortedItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const goToPage = (nextPage: number) => {
    setPage(Math.max(1, Math.min(lastPage, nextPage)));
  };

  const navRef = React.useRef<HTMLElement>(null);
  const hitAreaRef = React.useRef<HTMLDivElement>(null);
  const firstEndpointRef = React.useRef<HTMLAnchorElement>(null);
  const lastEndpointRef = React.useRef<HTMLAnchorElement>(null);
  const currentMarkerRef = React.useRef<HTMLDivElement>(null);
  const currentNumberRef = React.useRef<HTMLSpanElement>(null);
  const currentDotRef = React.useRef<HTMLSpanElement>(null);
  const currentTriangleTopRef = React.useRef<HTMLSpanElement>(null);
  const currentTriangleBottomRef = React.useRef<HTMLSpanElement>(null);
  const previewRef = React.useRef<HTMLAnchorElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const nav = navRef.current;
    const hitArea = hitAreaRef.current;
    const firstEndpoint = firstEndpointRef.current;
    const lastEndpoint = lastEndpointRef.current;
    const currentMarker = currentMarkerRef.current;
    const currentNumber = currentNumberRef.current;
    const currentDot = currentDotRef.current;
    const currentTriangleTop = currentTriangleTopRef.current;
    const currentTriangleBottom = currentTriangleBottomRef.current;
    const preview = previewRef.current;
    const list = listRef.current;

    if (
      !nav ||
      !hitArea ||
      !firstEndpoint ||
      !lastEndpoint ||
      !currentMarker ||
      !currentNumber ||
      !currentDot ||
      !currentTriangleTop ||
      !currentTriangleBottom ||
      !preview ||
      !list
    ) return;

    const setBounds = () => {
      const cards = Array.from(list.children) as HTMLElement[];
      const listRect = list.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();

      let left = listRect.left - navRect.left;
      let right = listRect.right - navRect.left;

      if (cards.length >= 3 && window.matchMedia("(min-width: 768px)").matches) {
        const second = cards[1].getBoundingClientRect();
        const third = cards[2].getBoundingClientRect();
        const cardLeft = second.left - navRect.left;
        const cardRight = third.right - navRect.left;

        if (cardRight > cardLeft) {
          left = cardLeft;
          right = cardRight;
        }
      }

      nav.style.setProperty("--nav-left", `${(left / navRect.width) * 100}%`);
      nav.style.setProperty("--nav-right", `${(right / navRect.width) * 100}%`);
      nav.style.setProperty("--line-left", `${((left + 44) / navRect.width) * 100}%`);
      nav.style.setProperty("--line-right", `${((right - 44) / navRect.width) * 100}%`);
    };

    const setPassive = () => {
      preview.classList.add("opacity-0");
      currentNumber.classList.remove("opacity-0");
      currentDot.classList.add("opacity-0");
      currentTriangleTop.classList.add("opacity-0");
      currentTriangleBottom.classList.add("opacity-0");
      firstEndpoint.className = "archive-page-endpoint pointer-events-none absolute left-[var(--nav-left)] top-1/2 z-10 size-2 -translate-x-1/2 -translate-y-1/2 border border-foreground/45 bg-foreground/25 transition-all duration-200";
      lastEndpoint.className = "archive-page-endpoint pointer-events-none absolute right-[calc(100%-var(--nav-right))] top-1/2 z-10 size-2 translate-x-1/2 -translate-y-1/2 border border-foreground/45 bg-foreground/25 transition-all duration-200";
      firstEndpoint.textContent = "";
      lastEndpoint.textContent = "";
    };

    const setActive = () => {
      preview.classList.remove("opacity-0");
      currentNumber.classList.add("opacity-0");
      currentDot.classList.remove("opacity-0");
      currentTriangleTop.classList.remove("opacity-0");
      currentTriangleBottom.classList.remove("opacity-0");
      firstEndpoint.className = "archive-page-endpoint pointer-events-none absolute left-[var(--nav-left)] top-1/2 z-10 inline-flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[min(var(--radius-md),10px)] border border-border bg-background text-sm text-muted-foreground shadow-xs transition-all duration-200";
      lastEndpoint.className = "archive-page-endpoint pointer-events-none absolute right-[calc(100%-var(--nav-right))] top-1/2 z-10 inline-flex size-8 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[min(var(--radius-md),10px)] border border-border bg-background text-sm text-muted-foreground shadow-xs transition-all duration-200";
      firstEndpoint.textContent = "1";
      lastEndpoint.textContent = String(lastPage);
    };

    const pageFromClientX = (clientX: number) => {
      const rect = hitArea.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return lastPage <= 1 ? 1 : Math.round(1 + progress * (lastPage - 1));
    };

    const updatePreview = (clientX: number) => {
      const rect = hitArea.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const pageNumber = pageFromClientX(clientX);

      preview.style.left = `${rect.left - navRect.left + progress * rect.width}px`;
      preview.textContent = String(pageNumber);
      preview.href = `#page-${pageNumber}`;
      preview.setAttribute("aria-label", `Go to Journal page ${pageNumber}`);
      setActive();
    };

    let touchActive = false;

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") updatePreview(event.clientX);
      else if (event.pointerType === "touch" && touchActive) updatePreview(event.clientX);
    };
    const onPointerEnter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") updatePreview(event.clientX);
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "mouse") setPassive();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      touchActive = true;
      hitArea.setPointerCapture(event.pointerId);
      updatePreview(event.clientX);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !touchActive) return;
      const pageNumber = pageFromClientX(event.clientX);
      touchActive = false;
      hitArea.releasePointerCapture(event.pointerId);
      goToPage(pageNumber);
      setPassive();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        touchActive = false;
        if (hitArea.hasPointerCapture(event.pointerId)) hitArea.releasePointerCapture(event.pointerId);
        setPassive();
      }
    };
    const onPointerClick = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      goToPage(pageFromClientX(event.clientX));
    };

    setBounds();
    setPassive();

    window.addEventListener("resize", setBounds);
    hitArea.addEventListener("pointerenter", onPointerEnter);
    hitArea.addEventListener("pointermove", onPointerMove);
    hitArea.addEventListener("pointerleave", onPointerLeave);
    hitArea.addEventListener("pointerdown", onPointerDown);
    hitArea.addEventListener("pointerup", onPointerUp);
    hitArea.addEventListener("pointercancel", onPointerCancel);
    hitArea.addEventListener("click", onPointerClick);

    return () => {
      window.removeEventListener("resize", setBounds);
      hitArea.removeEventListener("pointerenter", onPointerEnter);
      hitArea.removeEventListener("pointermove", onPointerMove);
      hitArea.removeEventListener("pointerleave", onPointerLeave);
      hitArea.removeEventListener("pointerdown", onPointerDown);
      hitArea.removeEventListener("pointerup", onPointerUp);
      hitArea.removeEventListener("pointercancel", onPointerCancel);
      hitArea.removeEventListener("click", onPointerClick);
    };
  }, [currentPage, lastPage]);

  return (
    <div className="flex flex-col gap-3 animation">
      <FilterControls filter={filter} />

      {filteredAndSortedItems.length === 0 ? (
        <div className="flex items-center justify-center border border-border p-6">
          <p className="paragraph">No Journal entries found.</p>
        </div>
      ) : (
        <div ref={listRef} className="space-y-0 border border-border p-6">
          {pageItems.map((item) => (
            <BlogCard key={item.id} item={item as blogConfig} />
          ))}
        </div>
      )}

      {filteredAndSortedItems.length > 0 && (
        <nav
          ref={navRef}
          className="relative mt-10 flex min-h-16 items-center justify-between border border-border p-4"
          aria-label="Journal pages"
          style={{
            "--nav-left": "24%",
            "--nav-right": "76%",
            "--line-left": "calc(24% + 44px)",
            "--line-right": "calc(76% - 44px)",
          } as React.CSSProperties}
        >
          {currentPage > 1 ? (
            <button type="button" onClick={() => goToPage(currentPage - 1)} aria-label="Previous Journal page" className="group z-20 inline-flex items-center gap-2">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[min(var(--radius-md),10px)] border border-border bg-background shadow-xs group-hover:bg-muted group-hover:text-foreground transition-all active:scale-95">
                <RiArrowLeftSLine className="size-5 fill-muted-foreground" />
              </span>
              <span className="pointer-events-none text-sm text-muted-foreground opacity-0 -translate-x-2 group-hover:translate-x-0 group-hover:opacity-100 transition-all">previous</span>
            </button>
          ) : <span className="size-8" />}

          <div className="absolute inset-y-0 left-0 right-0">
            <div className="pointer-events-none absolute left-[var(--line-left)] right-[calc(100%-var(--line-right))] top-1/2 h-px -translate-y-1/2 bg-foreground/35" />
            <a ref={firstEndpointRef} href="#page-1" aria-label="Journal page 1" className="archive-page-endpoint pointer-events-none absolute left-[var(--nav-left)] top-1/2 z-10 size-2 -translate-x-1/2 -translate-y-1/2 border border-border bg-background transition-none">1</a>
            <a ref={lastEndpointRef} href={`#page-${lastPage}`} aria-label={`Journal page ${lastPage}`} className="archive-page-endpoint pointer-events-none absolute right-[calc(100%-var(--nav-right))] top-1/2 z-10 size-2 translate-x-1/2 -translate-y-1/2 border border-border bg-background transition-none">{lastPage}</a>
            <div ref={currentMarkerRef} className="pointer-events-none absolute left-0 top-1/2 z-10 size-0 -translate-y-1/2" style={{ left: `calc(var(--line-left) + (var(--line-right) - var(--line-left)) * ${lastPage === 1 ? 0 : (currentPage - 1) / (lastPage - 1)})` }}>
              <span ref={currentNumberRef} className="absolute left-1/2 top-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[min(var(--radius-md),10px)] border border-border bg-secondary text-sm text-secondary-foreground transition-all duration-200">{currentPage}</span>
              <span ref={currentDotRef} className="absolute left-1/2 top-1/2 z-10 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground opacity-0 transition-opacity duration-200" />
              <span ref={currentTriangleTopRef} className="absolute left-1/2 top-[calc(50%-10px)] size-0 -translate-x-1/2 border-x-[6px] border-x-transparent border-t-[6px] border-t-foreground/60 opacity-0" />
              <span ref={currentTriangleBottomRef} className="absolute left-1/2 top-[calc(50%+4px)] size-0 -translate-x-1/2 border-x-[6px] border-x-transparent border-b-[6px] border-b-foreground/60 opacity-0" />
            </div>
            <a ref={previewRef} href="#page-1" aria-label="Preview Journal page 1" className="pointer-events-none absolute top-1/2 z-20 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[min(var(--radius-md),10px)] border border-border bg-secondary text-sm text-secondary-foreground opacity-0 shadow-xs transition-opacity duration-200">1</a>
            <div ref={hitAreaRef} className="absolute inset-y-0 cursor-pointer touch-none" style={{ left: "var(--line-left)", right: "calc(100% - var(--line-right))" }} aria-hidden="true" />
          </div>

          {currentPage < lastPage ? (
            <button type="button" onClick={() => goToPage(currentPage + 1)} aria-label="Next Journal page" className="group z-20 inline-flex items-center gap-2">
              <span className="pointer-events-none text-sm text-muted-foreground opacity-0 translate-x-2 group-hover:translate-x-0 group-hover:opacity-100 transition-all">next</span>
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[min(var(--radius-md),10px)] border border-border bg-background shadow-xs group-hover:bg-muted group-hover:text-foreground transition-all active:scale-95">
                <RiArrowRightSLine className="size-5 fill-muted-foreground" />
              </span>
            </button>
          ) : <span className="size-8" />}
        </nav>
      )}
    </div>
  );
}
