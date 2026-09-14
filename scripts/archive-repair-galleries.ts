import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "pekht_archive_recovered.json");
const archiveDir = path.join(root, "src/content/archive");
const imageDir = path.join(root, "public/images/archive");

const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));

const carouselPosts = source.filter(
  (post: any) =>
    post.author?.username === "PEKHTography" &&
    post.id === post.conversation_id &&
    Array.isArray(post.media) &&
    post.media.length > 1 &&
    post.media.every((media: any) => media.type === "photo"),
);

console.log(`Carousel posts found: ${carouselPosts.length}`);
console.log(
  `Additional images expected: ${carouselPosts.reduce(
    (sum: number, post: any) => sum + post.media.length - 1,
    0,
  )}`,
);

const markdownFiles = await fs.readdir(archiveDir);

for (const post of carouselPosts) {
  const markdownFile = markdownFiles.find(async () => false);

  const candidates = [];
  for (const file of markdownFiles) {
    if (!file.endsWith(".md")) continue;

    const content = await fs.readFile(path.join(archiveDir, file), "utf8");
    if (content.includes(`x_id: "${post.id}"`)) {
      candidates.push({ file, content });
    }
  }

  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one Markdown file for x_id ${post.id}, found ${candidates.length}`,
    );
  }

  const { file, content } = candidates[0];

  if (/^gallery:\s*\n(?:\s+-\s+.+\n)+/m.test(content)) {
    throw new Error(`Gallery already populated: ${file}`);
  }

  const imageLine = content.match(/^image:\s*"([^"]+)"/m);

  if (!imageLine) {
    throw new Error(`No image field found: ${file}`);
  }

  const firstImage = imageLine[1];
  const firstFilename = path.basename(firstImage);

  const expectedFirstUrl = post.media[0].url;
  const slug = firstFilename.replace(/\.[^.]+$/, "");

  console.log(`\n${post.id} -> ${file}`);
  console.log(`  First image: ${firstFilename}`);
  console.log(`  Photos: ${post.media.length}`);

  const galleryPaths: string[] = [];

  for (let index = 1; index < post.media.length; index++) {
    const media = post.media[index];
    const extension = path.extname(new URL(media.url).pathname) || ".jpg";
    const filename = `${slug}-${index + 1}${extension}`;
    const outputPath = path.join(imageDir, filename);

    if (await fileExists(outputPath)) {
      console.log(`  Exists: ${filename}`);
    } else {
      console.log(`  Downloading: ${filename}`);

      const response = await fetch(media.url);

      if (!response.ok) {
        throw new Error(
          `Failed to download ${media.url}: HTTP ${response.status}`,
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(outputPath, buffer);
    }

    galleryPaths.push(`/images/archive/${filename}`);
  }

  const galleryYaml = [
    "gallery:",
    ...galleryPaths.map((image) => `  - "${image}"`),
  ].join("\n");

  const updatedContent = content.replace(
    /^image:\s*"[^"]+"\n/m,
    `${imageLine[0]}\n${galleryYaml}\n`,
  );

  await fs.writeFile(path.join(archiveDir, file), updatedContent, "utf8");

  console.log(`  Gallery added: ${galleryPaths.length} images`);
}

console.log("\nGallery repair completed.");

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
