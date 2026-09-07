import fs from "node:fs/promises";
import path from "node:path";

type SourcePost = {
  id: string;
  created_at: string;
  text: string;
  media: Array<{
    type: string;
    url: string;
  }>;
};

const root = process.cwd();
const sourcePath = path.join(root, "pekht_archive_source.json");
const archiveDir = path.join(root, "src/content/archive");
const imageDir = path.join(root, "public/images/archive");

const posts = JSON.parse(
  await fs.readFile(sourcePath, "utf8"),
) as SourcePost[];

const hashtagRegex = /(^|\s)#([\p{L}\p{N}_]+)/gu;

function extractHashtags(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(hashtagRegex)].map((match) => match[2]),
    ),
  ];
}

function makeTitle(text: string): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? text;

  return firstLine
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim()
    .slice(0, 120);
}

function makeBaseSlug(text: string): string {
  const slug = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/-+$/, "");

  return slug;
}

function yamlString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}

function getImageExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? `.${match[1].toLowerCase()}` : ".jpg";
  } catch {
    return ".jpg";
  }
}

await fs.mkdir(archiveDir, { recursive: true });
await fs.mkdir(imageDir, { recursive: true });

const usedSlugs = new Set<string>();

console.log("");
console.log("=== PEKHTOGRAPHY ARCHIVE IMPORT ===");
console.log("");
console.log(`Source: ${sourcePath}`);
console.log(`Posts:  ${posts.length}`);
console.log("");

for (const [index, post] of posts.entries()) {
  if (!post.id || !post.created_at || !post.text) {
    throw new Error(`Invalid post at index ${index}: missing id/date/text`);
  }

  if (!post.media?.length || post.media[0]?.type !== "photo") {
    throw new Error(`Invalid media for X ID ${post.id}`);
  }

  const imageUrl = post.media[0].url;

  if (!imageUrl) {
    throw new Error(`Missing image URL for X ID ${post.id}`);
  }

  const baseSlug = makeBaseSlug(post.text);

  if (!baseSlug) {
    throw new Error(`Empty slug for X ID ${post.id}`);
  }

  let slug = baseSlug;

  if (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${post.id}`;
  }

  if (usedSlugs.has(slug)) {
    throw new Error(`Slug collision: ${slug}`);
  }

  usedSlugs.add(slug);

  const title = makeTitle(post.text);

  if (!title) {
    throw new Error(`Empty title for X ID ${post.id}`);
  }

  const hashtags = extractHashtags(post.text);
  const extension = getImageExtension(imageUrl);
  const imageFilename = `${slug}${extension}`;
  const imagePath = path.join(imageDir, imageFilename);
  const markdownPath = path.join(archiveDir, `${slug}.md`);

  console.log(`[${index + 1}/${posts.length}] ${slug}`);

  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(
      `Image download failed for ${post.id}: ${response.status} ${response.statusText}`,
    );
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(imagePath, imageBuffer);

  const hashtagYaml =
    hashtags.length > 0
      ? hashtags.map((tag) => `  - ${yamlString(tag)}`).join("\n")
      : "  []";

  const frontmatter = [
    "---",
    `title: ${yamlString(title)}`,
    `x_id: ${yamlString(post.id)}`,
    `x_created_at: ${yamlString(post.created_at)}`,
    `image: ${yamlString(`/images/archive/${imageFilename}`)}`,
    "hashtags:",
    hashtagYaml,
    "---",
    "",
  ].join("\n");

  await fs.writeFile(
    markdownPath,
    frontmatter + post.text,
    "utf8",
  );
}

console.log("");
console.log("=== IMPORT COMPLETE ===");
console.log(`Markdown files: ${posts.length}`);
console.log(`Images:         ${posts.length}`);
console.log("");
