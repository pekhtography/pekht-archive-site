import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const articlePaths = [
  "src/content/blog/07-10-2026-the-winter-tulip-s-breakthrough.md",
  "src/content/blog/08-10-2026-every-line-costs-light.md",
  "src/content/blog/09-10-2026-the-original-draft.md",
  "src/content/blog/09-10-2026-the-unkillable-king-a-hellebore-s-winter-gambit.md",
  "src/content/blog/10-10-2026-the-percussion-engineer.md",
  "src/content/blog/11-10-2026-the-petunia-and-the-monolith.md",
  "src/content/blog/14-10-2026-the-water-under-the-cathedral-of-ice.md",
];

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rows = [];
const seen = new Set();

for (const articlePath of articlePaths) {
  // The workflow checks the current main branch into ./data. Read source
  // metadata from there so this diagnoses the published article set.
  const article = await readFile(join("data", articlePath), "utf8");
  const sourceIdsLine = article.match(/^source_ids:\s*\[(.*?)\]\s*$/m);
  if (!sourceIdsLine) {
    throw new Error(`Could not parse source_ids in ${articlePath}`);
  }

  const sourceIds = [...sourceIdsLine[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (sourceIds.length === 0) {
    throw new Error(`No source_ids found in ${articlePath}`);
  }

  for (const sourceId of sourceIds) {
    if (seen.has(sourceId)) {
      throw new Error(`Duplicate source_id across target articles: ${sourceId}`);
    }
    seen.add(sourceId);

    const imageFile = `${sourceId}.jpg`;
    const imagePath = join("data", "public", "images", "archive", imageFile);
    const metadata = await sharp(imagePath).metadata();

    if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
      throw new Error(`Missing dimensions for ${imageFile}`);
    }

    const orientation =
      metadata.height > metadata.width ? "V" :
      metadata.width > metadata.height ? "H" : "S";

    rows.push({
      article_path: articlePath,
      source_id: sourceId,
      image_file: imageFile,
      width: metadata.width,
      height: metadata.height,
      orientation,
    });
  }
}

if (articlePaths.length !== 7) {
  throw new Error(`Expected 7 target articles, found ${articlePaths.length}`);
}
if (rows.length !== 32) {
  throw new Error(`Expected 32 image records, found ${rows.length}`);
}

const columns = ["article_path", "source_id", "image_file", "width", "height", "orientation"];
const csv = [
  columns.join(","),
  ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  "",
].join("\n");

await mkdir("layout-diagnostic-output", { recursive: true });
await writeFile("layout-diagnostic-output/layout-dimensions.csv", csv, "utf8");

const counts = rows.reduce((acc, row) => {
  acc[row.orientation] = (acc[row.orientation] ?? 0) + 1;
  return acc;
}, {});

console.log(`Validated ${articlePaths.length} articles and ${rows.length} unique images from main.`);
console.log(`Orientations: V=${counts.V ?? 0}, H=${counts.H ?? 0}, S=${counts.S ?? 0}`);
console.log("CSV artifact: layout-diagnostic-output/layout-dimensions.csv");
console.log(csv);
