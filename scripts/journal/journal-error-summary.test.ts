import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const orchestratorPath = fileURLToPath(
  new URL("../journal-orchestrator.ts", import.meta.url),
);
const repoRoot = resolve(dirname(orchestratorPath), "..", "..");
const tsxLoaderUrl = import.meta.resolve("tsx");

async function runScenario(scenario: string) {
  const root = await mkdtemp(join(tmpdir(), "journal-t9-"));
  const archiveDir = join(root, "src/content/archive");
  const blogDir = join(root, "src/content/blog");
  const promptsDir = join(root, "scripts/journal/prompts");
  const preloadPath = join(root, "t9-preload.mjs");

  try {
    await Promise.all([
      mkdir(archiveDir, { recursive: true }),
      mkdir(blogDir, { recursive: true }),
      mkdir(promptsDir, { recursive: true }),
    ]);

    await writeFile(
      join(archiveDir, "fixture-1.md"),
      [
        "---",
        'x_id: "fixture-x-id"',
        'title: "T9 fixture"',
        'hashtags: ["fixture"]',
        'image: "/images/fixture.jpg"',
        'x_created_at: "2026-01-01T00:00:00Z"',
        "---",
        "",
        "A non-empty fixture text for the Journal discovery snapshot.",
        "",
      ].join("\n"),
    );
    await writeFile(join(promptsDir, "task-1.md"), "Return a test candidate.");
    await writeFile(
      preloadPath,
      `const scenario = process.env.T9_TEST_SCENARIO;
let calls = 0;
const originalLog = console.log.bind(console);

console.log = (...args) => {
  if (scenario === "summary-print-fails" && args[0] === "REJECTION SUMMARY:") {
    throw new Error("T9_SUMMARY_PRINT_FAILURE");
  }
  return originalLog(...args);
};

globalThis.fetch = async () => {
  calls += 1;
  if (scenario === "error-before-rejection" || calls > 1) {
    return new Response("T9_CONTROLLED_PROVIDER_FAILURE", { status: 400 });
  }

  const payload = {
    status: "OK",
    candidate: {
      id: "candidate-invalid-sources",
      source_ids: [],
      entry_id: "",
      exit_id: ""
    }
  };
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};
`,
    );

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        tsxLoaderUrl,
        "--import",
        pathToFileURL(preloadPath).href,
        orchestratorPath,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, T9_TEST_SCENARIO: scenario },
      },
    );

    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("prints accumulated rejection summary and preserves the original error on failure", async () => {
  const result = await runScenario("reject-then-error");
  const output = result.stdout + result.stderr;

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(output, /REJECTION SUMMARY:/);
  assert.match(
    output,
    /candidate-invalid-sources \[DISCOVER\]: DISCOVER candidate failed source validation/,
  );
  assert.match(output, /T9_CONTROLLED_PROVIDER_FAILURE/);
});

test("does not print an empty rejection summary when failure occurs before any rejection", async () => {
  const result = await runScenario("error-before-rejection");
  const output = result.stdout + result.stderr;

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(output, /REJECTION SUMMARY:/);
  assert.match(output, /T9_CONTROLLED_PROVIDER_FAILURE/);
});

test("a failure while printing the summary does not mask the original error", async () => {
  const result = await runScenario("summary-print-fails");
  const output = result.stdout + result.stderr;

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(output, /T9_SUMMARY_PRINT_FAILURE/);
  assert.match(output, /T9_CONTROLLED_PROVIDER_FAILURE/);
});
