import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const response = await fetch("https://x.com/PEKHTography", {
  headers: {
    "User-Agent": "Mozilla/5.0",
  },
});

if (!response.ok) {
  throw new Error(`X returned HTTP ${response.status}`);
}

const html = await response.text();

const urls = [
  ...new Set(
    (html.match(/\\/PEKHTography\\/status\\/\\d+/gi) ?? [])
      .map((url) => `https://x.com${url}`),
  ),
];

console.log("");
console.log(`Found ${urls.length} X posts.`);
console.log("");

for (const url of urls) {
  console.log(`Checking: ${url}`);

  try {
    await execFileAsync(
      "pnpm",
      ["exec", "tsx", "scripts/archive-add.ts", url],
      { stdio: "inherit" },
    );

    console.log("Imported.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    if (message.includes("Archive entry already exists")) {
      console.log("Already exists — skipped.");
    } else {
      console.error("IMPORT ERROR:");
      console.error(message);
      process.exitCode = 1;
    }
  }

  console.log("");
}

console.log("Sync finished.");
