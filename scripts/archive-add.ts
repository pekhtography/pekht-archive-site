import fs from "node:fs/promises";
import path from "node:path";

const POST_URL = process.argv[2];

if (!POST_URL) {
  console.error(
    'Usage: pnpm archive:add "https://x.com/PEKHTography/status/1234567890"',
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
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
  },
);

if (!response.ok) {
  console.error(`X returned HTTP ${response.status}.`);
  process.exit(1);
}

const html = await response.text();

const decodeHtml = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(Number(code)),
    );

const cleanText = (value: string) =>
  decodeHtml(value)
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\u0026/g, "&")
    .replace(/\\u003C/gi, "<")
    .replace(/\\u003E/gi, ">")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const extractXField = (field: string) => {
  const regex = new RegExp(
    `${field}:"((?:\\\\.|[^"\\\\])*)"`,
    "i",
  );

  const match = html.match(regex);

  return match ? cleanText(match[1]) : "";
};

const extractMeta = (property: string) => {
  const regex = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    "i",
  );

  const match = html.match(regex);

  return match ? cleanText(match[1]) : "";
};

const extractNameMeta = (name: string) => {
  const regex = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    "i",
  );

  const match = html.match(regex);

  return match ? cleanText(match[1]) : "";
};

const description =
  extractMeta("og:description") ||
  extractNameMeta("description");

let tweetText =
  extractXField("bodyText") ||
  extractXField("full_text") ||
  description;

const authorPrefix = `${username} on X: `;

if (tweetText.toLowerCase().startsWith(authorPrefix.toLowerCase())) {
  tweetText = tweetText.slice(authorPrefix.length).trim();
}

const articleTags = extractMeta("article:tag");

if (!tweetText) {
  console.error("Text found: NO");
  process.exit(1);
}

console.log("Text found: YES");

const imageMatches = [
  ...html.matchAll(
    /https:\/\/pbs\.twimg\.com\/media\/[^"'&<\s?]+(?:\?[^"'&<\s]*)?/gi,
  ),
];

const imageUrls = [
  ...new Set(
    imageMatches.map((match) =>
      decodeHtml(match[0]),
    ),
  ),
];

console.log(`Photos found: ${imageUrls.length}`);

if (imageUrls.length === 0) {
  console.error("No photo found in this post.");
  process.exit(1);
}

const imageUrl = imageUrls[0]
  .replace(/&amp;/g, "&")
  .replace(/name=[^&]+/i, "name=large");

const textWithoutHashtags = tweetText
  .replace(/(^|\s)#[A-Za-z0-9_]+/g, "$1")
  .replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/g, "")
  .split(/\r?\n/)
  .map((line) => line.replace(/[ \t]+/g, " ").trim())
  .filter(Boolean)
  .join("\n")
  .trim();

const hashtags = [
  ...new Set(
    (
      tweetText.match(/(^|\s)#([A-Za-z0-9_]+)/g) ?? []
    ).map((tag) =>
      tag.trim().replace(/^#/, ""),
    ),
  ),
];

if (articleTags) {
  for (const tag of articleTags.split(/\s+/)) {
    const cleanTag = tag.replace(/^#/, "").trim();

    if (
      cleanTag &&
      !hashtags.some(
        (existing) =>
          existing.toLowerCase() === cleanTag.toLowerCase(),
      )
    ) {
      hashtags.push(cleanTag);
    }
  }
}

const firstSentence =
  textWithoutHashtags.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ??
  textWithoutHashtags;

const title = firstSentence
  .replace(/[.!?]+$/, "")
  .trim();

const slug = textWithoutHashtags
  .replace(/[^\p{L}\p{N}\s-]/gu, "")
  .toLowerCase()
  .trim()
  .replace(/\s+/g, "-")
  .replace(/-+/g, "-")
  .slice(0, 60);

const safeSlug = slug || `x-${postId}`;

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

const imagePath = path.join(
  imageDir,
  `${safeSlug}.jpg`,
);

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
  console.error("");

  process.exit(1);
} catch {
  // File does not exist — continue.
}

console.log("Downloading image...");
console.log(`Trying: ${imageUrl}`);

const imageResponse = await fetch(imageUrl, {
  headers: {
    "User-Agent": "Mozilla/5.0",
  },
});

if (!imageResponse.ok) {
  console.error(
    `Unable to download image: HTTP ${imageResponse.status}`,
  );
  process.exit(1);
}

const imageBuffer = Buffer.from(
  await imageResponse.arrayBuffer(),
);

await fs.writeFile(imagePath, imageBuffer);

console.log(`Image saved: ${imagePath}`);

const yamlString = (value: string) =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;

const hashtagYaml = hashtags.length
  ? hashtags
      .map((tag) => `  - ${yamlString(tag)}`)
      .join("\n")
  : "  []";

const markdown = `---
title: ${yamlString(title)}
image: "/images/archive/${safeSlug}.jpg"
hashtags:
${hashtagYaml}
---

${textWithoutHashtags}
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
console.log(`Title:   ${title}`);
console.log(`Image:   ${imagePath}`);
console.log(`Content: ${markdownPath}`);
console.log(
  `Tags:    ${hashtags.length ? hashtags.join(", ") : "none"}`,
);
console.log(`Source:  ${imageUrl}`);
console.log("");
