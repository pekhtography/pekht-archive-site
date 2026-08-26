import fs from "node:fs/promises";
import path from "node:path";

const POST_URL = process.argv[2];

if (!POST_URL) {
  console.error(
    'Usage: pnpm archive:add "https://x.com/pekhtography/status/1234567890"',
  );
  process.exit(1);
}

const match = POST_URL.match(
  /(?:x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)/i,
);

if (!match) {
  console.error("Invalid X post URL.");
  process.exit(1);
}

const username = match[1];
const postId = match[2];

console.log("");
console.log(`Importing X post: @${username}/${postId}`);
console.log("Fetching public X page...");

const response = await fetch(
  `https://x.com/${username}/status/${postId}`,
  {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
  },
);

if (!response.ok) {
  console.error(`X page returned HTTP ${response.status}`);
  process.exit(1);
}

const html = await response.text();

await fs.writeFile("/tmp/x.html", html, "utf8");

/*
 * X exposes the post text through og:description.
 */
const descriptionMatch = html.match(
  /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"]*)["']/i,
);

let tweetText = descriptionMatch?.[1] ?? "";

tweetText = tweetText
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

console.log(`Text found: ${tweetText ? "YES" : "NO"}`);

if (!tweetText) {
  console.error("");
  console.error("Could not extract the post text from X.");
  process.exit(1);
}

/*
 * Find X media IDs from pbs.twimg.com URLs.
 *
 * X may expose several sizes/formats of the same image.
 * We extract the media ID and construct our own stable download URL.
 */
const mediaIds = [
  ...html.matchAll(
    /https:\/\/pbs\.twimg\.com\/media\/([A-Za-z0-9_-]+)/g,
  ),
].map((m) => m[1]);

const uniqueMediaIds = [...new Set(mediaIds)];

console.log(`Photos found: ${uniqueMediaIds.length}`);

if (uniqueMediaIds.length === 0) {
  console.error("");
  console.error("No X photos found.");
  process.exit(1);
}

const projectRoot = process.cwd();

const imageDir = path.join(
  projectRoot,
  "public",
  "images",
  "archive",
);

const contentDir = path.join(
  projectRoot,
  "src",
  "content",
  "archive",
);

await fs.mkdir(imageDir, { recursive: true });
await fs.mkdir(contentDir, { recursive: true });

/*
 * Remove URLs from X metadata.
 */
let cleanText = tweetText
  .replace(/https?:\/\/t\.co\/\S+/g, "")
  .trim();

/*
 * Extract hashtags before removing them.
 */
const hashtags = [
  ...cleanText.matchAll(/(^|\s)#([A-Za-z0-9_]+)/g),
].map((m) => m[2]);

cleanText = cleanText
  .replace(/(^|\s)#[A-Za-z0-9_]+/g, "")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

/*
 * Generate slug from the actual post text.
 */
const slug = cleanText
  .replace(/[^\p{L}\p{N}\s-]/gu, "")
  .toLowerCase()
  .trim()
  .replace(/\s+/g, "-")
  .replace(/-+/g, "-")
  .slice(0, 60);

const safeSlug = slug || `x-${postId}`;

const markdownPath = path.join(
  contentDir,
  `${safeSlug}.md`,
);

try {
  await fs.access(markdownPath);

  console.error("");
  console.error(
    `Archive entry already exists: ${safeSlug}.md`,
  );
  process.exit(1);
} catch {
  // Does not exist — continue.
}

console.log("Downloading image...");

/*
 * Try each discovered media ID until one downloads successfully.
 */
let imageBuffer: Buffer | null = null;
let downloadedImageUrl = "";

for (const mediaId of uniqueMediaIds) {
  const candidates = [
    `https://pbs.twimg.com/media/${mediaId}?format=jpg&name=large`,
    `https://pbs.twimg.com/media/${mediaId}?format=jpg&name=orig`,
  ];

  for (const imageUrl of candidates) {
    console.log(`Trying: ${imageUrl}`);

    const imageResponse = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: `https://x.com/${username}/status/${postId}`,
      },
    });

    if (imageResponse.ok) {
      imageBuffer = Buffer.from(
        await imageResponse.arrayBuffer(),
      );

      downloadedImageUrl = imageUrl;
      break;
    }

    console.log(
      `Image request returned HTTP ${imageResponse.status}`,
    );
  }

  if (imageBuffer) {
    break;
  }
}

if (!imageBuffer) {
  console.error("");
  console.error("Unable to download any X image.");
  process.exit(1);
}

const imagePath = path.join(
  imageDir,
  `${safeSlug}.jpg`,
);

await fs.writeFile(imagePath, imageBuffer);

console.log(`Image saved: ${imagePath}`);

/*
 * YAML-safe string.
 */
const yamlString = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const hashtagYaml = hashtags.length
  ? hashtags
      .map((tag) => `  - ${yamlString(tag)}`)
      .join("\n")
  : "  []";

const markdown = `---
title: ${yamlString(safeSlug)}
image: "/images/archive/${safeSlug}.jpg"
hashtags:
${hashtagYaml}
---

${cleanText}
`;

await fs.writeFile(
  markdownPath,
  markdown,
  "utf8",
);

console.log("");
console.log("Archive import successful.");
console.log("");
console.log(`Post:    ${POST_URL}`);
console.log(`Image:   ${imagePath}`);
console.log(`Content: ${markdownPath}`);
console.log(
  `Tags:    ${hashtags.length ? hashtags.join(", ") : "none"}`,
);
console.log(`Source:  ${downloadedImageUrl}`);
console.log("");
