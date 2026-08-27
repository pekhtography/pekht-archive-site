import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const url = process.argv[2];

if (!url) {
  console.error('Usage: pnpm archive "https://x.com/PEKHTography/status/1234567890"');
  process.exit(1);
}

try {
  console.log("");
  console.log("=== 1/3 Importing X post ===");
  console.log("");

  await execFileAsync(
    "pnpm",
    ["exec", "tsx", "scripts/archive-add.ts", url],
    { stdio: "inherit" },
  );

  console.log("");
  console.log("=== 2/3 Committing archive post ===");
  console.log("");

  await execFileAsync("git", ["add", "."]);

  await execFileAsync("git", [
    "commit",
    "-m",
    "feat: add archive post",
  ]);

  console.log("");
  console.log("=== 3/3 Pushing to GitHub ===");
  console.log("");

  await execFileAsync("git", ["push"]);

  console.log("");
  console.log("=== Archive published successfully ===");
  console.log("");
} catch (error) {
  console.error("");
  console.error("Archive process failed.");

  if (error instanceof Error) {
    console.error(error.message);
  }

  process.exit(1);
}
