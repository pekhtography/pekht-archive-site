import { chooseJournalSides, type JournalImageClass } from "@/lib/journal-layout";

const ROOT_SELECTOR = "[data-journal-composition]";

type SourceRecord = {
    section: HTMLElement;
    image: HTMLImageElement;
};

type Candidate = {
    sides: number[];
    leftWeight: number;
    rightWeight: number;
    repeatedSides: number;
};

function waitForImage(image: HTMLImageElement): Promise<void> {
    if (image.complete) return Promise.resolve();

    return new Promise((resolve) => {
        const finish = () => resolve();
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
        // The side-selection algorithm needs real image proportions before
        // choosing sides, so load only the images belonging to this Journal.
        image.loading = "eager";

        if (typeof image.decode === "function") {
            image.decode().then(finish).catch(() => {
                if (image.complete) finish();
            });
        }
    });
}

function imageWeight(image: HTMLImageElement): number {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        return image.naturalHeight / image.naturalWidth;
    }
    return 1;
}

function compareCandidates(a: Candidate, b: Candidate): number {
    const balanceA = Math.abs(a.leftWeight - a.rightWeight);
    const balanceB = Math.abs(b.leftWeight - b.rightWeight);
    if (Math.abs(balanceA - balanceB) > 0.001) return balanceA - balanceB;
    if (a.repeatedSides !== b.repeatedSides) return a.repeatedSides - b.repeatedSides;
    return a.sides.join("").localeCompare(b.sides.join(""));
}

function chooseLegacySides(records: SourceRecord[]): number[] {
    if (records.length === 0) return [];

    // Preserve the existing maximum-run rule: for the usual 3–6 source
    // blocks, no side receives more than two consecutive images. Larger
    // runs adapt the limit to one third of their source count, rounded up.
    const maxConsecutiveImages = Math.max(2, Math.ceil(records.length / 3));
    let candidates: Candidate[] = [{
        sides: [],
        leftWeight: 0,
        rightWeight: 0,
        repeatedSides: 0,
    }];

    records.forEach((record, index) => {
        const weight = imageWeight(record.image);
        const next: Candidate[] = [];

        for (const candidate of candidates) {
            for (const side of [0, 1]) {
                let consecutive = 1;
                for (let i = candidate.sides.length - 1;
                    i >= 0 && candidate.sides[i] === side;
                    i--) consecutive++;
                if (consecutive > maxConsecutiveImages) continue;

                const previous = candidate.sides[candidate.sides.length - 1];
                next.push({
                    sides: [...candidate.sides, side],
                    leftWeight: candidate.leftWeight + (side === 0 ? weight : 0),
                    rightWeight: candidate.rightWeight + (side === 1 ? weight : 0),
                    repeatedSides: candidate.repeatedSides + (index > 0 && previous === side ? 1 : 0),
                });
            }
        }

        next.sort(compareCandidates);
        candidates = next.slice(0, records.length <= 16 ? next.length : 4096);
    });

    candidates.sort(compareCandidates);
    return candidates[0]?.sides ?? records.map((_, index) => index % 2);
}

function getImageClass(image: HTMLImageElement): JournalImageClass {
    if (image.naturalWidth > 0 && image.naturalHeight > image.naturalWidth) {
        return "V";
    }
    if (image.naturalWidth > 0 && image.naturalHeight === image.naturalWidth) {
        return "S";
    }
    return "H";
}

async function initialize(root: HTMLElement) {
    const nodes = Array.from(root.children);
    const runs: SourceRecord[][] = [];
    let run: SourceRecord[] = [];

    const finishRun = () => {
        if (run.length > 0) runs.push(run);
        run = [];
    };

    for (const node of nodes) {
        if (!(node instanceof HTMLElement) || !node.hasAttribute("data-journal-source")) {
            finishRun();
            continue;
        }

        const image = node.querySelector<HTMLImageElement>(".journal-image img");
        if (!image) {
            finishRun();
            continue;
        }
        run.push({ section: node, image });
    }
    finishRun();

    // Bridges split the composition into independent runs, as before.
    await Promise.all(runs.flat().map(({ image }) => waitForImage(image)));

    const useNewLayout = root.dataset.journalNewLayout === "true";

    for (const records of runs) {
        const sides = useNewLayout
            ? chooseJournalSides(
                records.map(({ image }) => getImageClass(image)),
                { forceFirstLeft: true },
            ).sides
            : chooseLegacySides(records);
        records.forEach((record, index) => {
            record.section.classList.toggle("journal-image-left", sides[index] === 0);
            record.section.classList.toggle("journal-image-right", sides[index] === 1);
        });
    }
}

function initializeAllJournalCompositions() {
    document.querySelectorAll<HTMLElement>(ROOT_SELECTOR).forEach((root) => {
        void initialize(root);
    });
}

// This module is imported from the site-wide Head, so its listener is already
// installed when ClientRouter navigates from a page without JournalComposition.
document.addEventListener("astro:page-load", initializeAllJournalCompositions);

// Also handle a composition that is already present when the module is evaluated.
if (document.querySelector(ROOT_SELECTOR)) {
    void initializeAllJournalCompositions();
}
