import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runJournal, type JournalRunOptions } from "./journal-orchestrator.ts";
import { generateJson, JournalBudgetExceededError } from "./journal/provider.ts";

type Stage = "DISCOVER" | "MONTAGE" | "TEST" | "TITLE";
type QueueItem = { stage: Stage; response: unknown };

const SOURCE_IDS = ["source-a", "source-b", "source-c", "source-d", "source-e", "source-f", "source-g"];
const LONG_MARKDOWN =
  "One quiet signal moves through the archive and gathers several small details into a single continuous thought that changes its meaning before the final image arrives.";

function stageFor(schema: unknown): Stage {
  const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
  if ("candidate" in properties) return "DISCOVER";
  if ("candidate_id" in properties) return "MONTAGE";
  if ("verdict" in properties) return "TEST";
  if ("cut_index" in properties) return "TITLE";
  throw new Error("Harness received an unknown JSON schema.");
}

function candidate(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    vector: "a small change carried across different states",
    hero: "the changing signal",
    entry_id: SOURCE_IDS[0],
    exit_id: SOURCE_IDS[3],
    source_ids: SOURCE_IDS.slice(0, 4),
    emergent_whole: "the repeated signal changes meaning through its context",
    evidence: SOURCE_IDS.slice(0, 4),
    scores: {
      emergent_whole: 8,
      arc: 8,
      necessity: 8,
      minimality: 8,
      preservation: 8,
      ending: 8,
    },
    ...overrides,
  };
}

function discoverResponse(value: ReturnType<typeof candidate>) {
  return { status: "OK", candidate: value };
}

function noJournalResponse() {
  return { status: "NO_JOURNAL", candidate: candidate("no-journal-placeholder") };
}

function montageResponse(candidateId = "candidate-a") {
  const ids = SOURCE_IDS.slice(0, 4);
  return {
    status: "OK",
    candidate_id: candidateId,
    title: "The Quiet Signal",
    description: "A signal changes as it moves between states.",
    source_ids: ids,
    markdown: LONG_MARKDOWN,
    composition: ids.map((source_id) => ({
      type: "source",
      source_id,
      text: `A fragment from ${source_id}.`,
    })),
    reason: "",
    facets: ["signals", "change"],
  };
}

function strongResponse() {
  return {
    verdict: "STRONG",
    reason: "The whole is coherent.",
    evidence: SOURCE_IDS.slice(0, 4),
    revision: "",
  };
}

function titleResponse() {
  return { cut_index: 10 };
}

function expectedFilename() {
  const now = new Date();
  const date =
    String(now.getUTCDate()).padStart(2, "0") +
    "-" +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    "-" +
    now.getUTCFullYear();
  return `${date}-the-quiet-signal.md`;
}

async function createEnvironment() {
  const root = await mkdtemp(join(tmpdir(), "journal-testability-"));
  const archiveDir = join(root, "archive");
  const blogDir = join(root, "blog");
  await mkdir(archiveDir, { recursive: true });

  await mkdir(blogDir, { recursive: true });

  // The first published Journal article has a fixed layout and is excluded from
  // the 2x2 cycle. Seed it in every harness environment so tests exercise the
  // same article-number invariant as production.
  await writeFile(join(blogDir, "01-01-2026-fixed-first-article.md"), [
    "---",
    'title: "Fixed first article fixture"',
    'date: "01-01-2026"',
    'category: "journal"',
    'image_side: "left"',
    "source_ids: []",
    "---",
    "",
    "Harness fixture for the fixed first Journal article.",
    "",
  ].join("\\n"), "utf8");

  for (let i = 0; i < SOURCE_IDS.length; i += 1) {
    const id = SOURCE_IDS[i];
    const raw = [
      "---",
      `x_id: "x-${i + 1}"`,
      `title: "Fixture source ${i + 1}"`,
      'hashtags: ["fixture", "journal"]',
      `image: "/images/fixture-${i + 1}.jpg"`,
      `x_created_at: "2026-01-${String(i + 1).padStart(2, "0")}"`,
      "---",
      "",
      `Fixture text for ${id}, with a concrete state and a small change.`,
      "",
    ].join("\n");
    await writeFile(join(archiveDir, `${id}.md`), raw, "utf8");
  }

  return { root, archiveDir, blogDir };
}

async function execute(
  queue: QueueItem[],
  options: Partial<JournalRunOptions> = {},
  setup?: (environment: Awaited<ReturnType<typeof createEnvironment>>) => Promise<void>,
) {
  const environment = await createEnvironment();
  try {
    if (setup) await setup(environment);

    const calls: Stage[] = [];
    const logs: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));

    let thrown: unknown;
    const generateJsonFn: NonNullable<JournalRunOptions["generateJsonFn"]> =
      async (_prompt, schema, providerOptions) => {
        if (providerOptions?.checkBudget && !providerOptions.checkBudget()) {
          throw new JournalBudgetExceededError();
        }
        const stage = stageFor(schema);
        calls.push(stage);
        const next = queue.shift();
        assert.ok(next, `Unexpected ${stage} model call: mock queue is empty.`);
        assert.equal(next.stage, stage, `Expected ${next.stage}, received ${stage}.`);
        if (next.response instanceof Error) throw next.response;
        return next.response;
      };

    try {
      await runJournal({
        archiveDir: environment.archiveDir,
        blogDir: environment.blogDir,
        promptsDir: resolve(process.cwd(), "scripts/journal/prompts"),
        generateJsonFn,
        // Orchestration tests focus on pipeline behavior, not Sharp/file decoding.
        // Layout algorithm behavior is covered by its dedicated tests.
        getImageOrientationFn: async () => "H",
        ...options,
      });
    } catch (error) {
      thrown = error;
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }

    return { ...environment, calls, logs, thrown, remaining: queue };
  } catch (error) {
    await rm(environment.root, { recursive: true, force: true });
    throw error;
  }
}

async function cleanup(root: string) {
  await rm(root, { recursive: true, force: true });
}


function providerSuccessResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
  } as Response;
}

async function withProviderEnvironment(fetchImpl: typeof fetch, test: () => Promise<void>) {
  const keys = ["GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_FALLBACK_1", "GEMINI_FALLBACK_2", "GEMINI_FALLBACK_3", "GEMINI_FALLBACK_4"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "harness-test-key";
  process.env.GEMINI_MODEL = "test-primary";
  process.env.GEMINI_FALLBACK_1 = "test-fallback";
  delete process.env.GEMINI_FALLBACK_2;
  delete process.env.GEMINI_FALLBACK_3;
  delete process.env.GEMINI_FALLBACK_4;
  globalThis.fetch = fetchImpl;
  try {
    await test();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function timeoutFetch(): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    // AbortSignal.timeout() uses an unreferenced timer in Node; this guard keeps
    // the mocked request alive long enough for the timeout signal to fire.
    const guard = setTimeout(() => reject(new Error("Timeout signal did not fire.")), 100);
    signal?.addEventListener("abort", () => {
      clearTimeout(guard);
      reject(signal?.reason);
    }, { once: true });
  })) as typeof fetch;
}

async function check(name: string, test: () => Promise<void>) {
  await test();
  console.log(`PASS ${name}`);
}

async function main() {
  let passed = 0;
  const run = async (name: string, test: () => Promise<void>) => {
    await check(name, test);
    passed += 1;
  };


  // T8/T16 provider and controlled-budget acceptance scenarios.
  await run("T8.1 — request timeout retries the same model", async () => {
    let calls = 0;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return await timeoutFetch()("https://example.test", init);
      return providerSuccessResponse();
    }) as typeof fetch;
    await withProviderEnvironment(fetchImpl, async () => {
      const result = await generateJson("prompt", {}, { timeoutMs: 5 });
      assert.deepEqual(result, { ok: true });
      assert.equal(calls, 2);
    });
  });

  await run("T8.2 — three timeouts fall back to the next model", async () => {
    const requestedModels: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const match = String(input).match(/models\/([^:]+)/);
      requestedModels.push(decodeURIComponent(match?.[1] ?? ""));
      if (requestedModels.at(-1) === "test-primary") {
        return await timeoutFetch()(input, init);
      }
      return providerSuccessResponse();
    }) as typeof fetch;
    await withProviderEnvironment(fetchImpl, async () => {
      const result = await generateJson("prompt", {}, { timeoutMs: 5 });
      assert.deepEqual(result, { ok: true });
      assert.deepEqual(requestedModels, ["test-primary", "test-primary", "test-primary", "test-fallback"]);
    });
  });

  await run("T16.1 — exhausted budget prevents the first request", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return providerSuccessResponse(); }) as typeof fetch;
    await withProviderEnvironment(fetchImpl, async () => {
      await assert.rejects(
        generateJson("prompt", {}, { checkBudget: () => false, timeoutMs: 5 }),
        JournalBudgetExceededError,
      );
      assert.equal(calls, 0);
    });
  });

  await run("T16.1b — less than 60 seconds remaining prevents the first request", async () => {
    const originalNow = Date.now;
    const budgetMs = 105 * 60 * 1000;
    const times = [0, 1, budgetMs - 59_999];
    let index = 0;
    Date.now = () => times[Math.min(index++, times.length - 1)];
    let result: Awaited<ReturnType<typeof execute>>;
    try {
      result = await execute([]);
    } finally {
      Date.now = originalNow;
    }
    try {
      assert.equal(result.thrown, undefined);
      assert.equal(result.calls.length, 0, "No model request may start with less than 60 seconds remaining.");
      assert.ok(result.logs.some((line) => line.includes("JOURNAL_BUDGET_EXCEEDED during DISCOVER")));
      assert.equal((await readdir(result.blogDir)).length, 1, "No new Journal article may be published.");
    } finally {
      await cleanup(result.root);
    }
  });

  await run("T16.2 — exhausted budget prevents fallback after retries", async () => {
    let checks = 0;
    let calls = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      return await timeoutFetch()(input, init);
    }) as typeof fetch;
    await withProviderEnvironment(fetchImpl, async () => {
      await assert.rejects(
        generateJson("prompt", {}, { checkBudget: () => ++checks < 5, timeoutMs: 5 }),
        JournalBudgetExceededError,
      );
      assert.equal(calls, 3, "Fallback request must not start after the budget check fails.");
      assert.equal(checks, 5);
    });
  });

  await run("T8.3 — external AbortError does not retry or fall back", async () => {
    let calls = 0;
    const abort = Object.assign(new Error("caller cancelled"), { name: "AbortError" });
    const fetchImpl = (async () => { calls += 1; throw abort; }) as typeof fetch;
    await withProviderEnvironment(fetchImpl, async () => {
      await assert.rejects(generateJson("prompt", {}, { timeoutMs: 5 }), (error: unknown) =>
        error instanceof Error && error.name === "AbortError");
      assert.equal(calls, 1);
    });
  });

  await run("T8.4 — transient network error retries", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("simulated network failure");
      return providerSuccessResponse();
    }) as typeof fetch;
    await withProviderEnvironment(fetchImpl, async () => {
      const result = await generateJson("prompt", {}, { timeoutMs: 5 });
      assert.deepEqual(result, { ok: true });
      assert.equal(calls, 2);
    });
  });

  await run("T16.3 — budget exhaustion logs NO_JOURNAL and does not publish", async () => {
    const originalNow = Date.now;
    const times = [0, 1, 2, 3, 105 * 60 * 1000];
    let index = 0;
    Date.now = () => times[Math.min(index++, times.length - 1)];
    let result: Awaited<ReturnType<typeof execute>>;
    try {
      const invalid = candidate("candidate-invalid", { source_ids: SOURCE_IDS.slice(0, 3) });
      result = await execute([
        { stage: "DISCOVER", response: discoverResponse(invalid) },
        { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      ]);
    } finally {
      Date.now = originalNow;
    }
    try {
      assert.equal(result.thrown, undefined);
      assert.ok(result.logs.some((line) => line.includes("JOURNAL_BUDGET_EXCEEDED during DISCOVER")));
      assert.ok(result.logs.some((line) => line.includes("REJECTION SUMMARY")));
      assert.ok(result.logs.some((line) => line.includes("NO_JOURNAL: budget exhausted")));
      assert.equal((await readdir(result.blogDir)).length, 0);
    } finally {
      await cleanup(result.root);
    }
  });

  // Importing the orchestrator must not execute the CLI or attempt model generation.
  await run("0 — importing orchestrator has no side effects", async () => {
    const env = { ...process.env };
    delete env.GEMINI_API_KEY;
    delete env.GEMINI_MODEL;
    delete env.GEMINI_FALLBACK_1;
    delete env.GEMINI_FALLBACK_2;
    delete env.GEMINI_FALLBACK_3;
    delete env.GEMINI_FALLBACK_4;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", "await import('./scripts/journal-orchestrator.ts')"],
      { cwd: process.cwd(), env, encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout || "Import subprocess failed.");
    assert.equal(result.stdout, "", "Import unexpectedly wrote to stdout.");
    assert.equal(result.stderr, "", "Import unexpectedly wrote to stderr.");
  });

  // 1. A valid 4-source candidate passes T2 and can reach publication.
  await run("1 — valid candidate accepted", async () => {
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montageResponse() },
      { stage: "TEST", response: strongResponse() },
      { stage: "TITLE", response: titleResponse() },
    ]);
    try {
      assert.equal(result.thrown, undefined);
      assert.deepEqual(result.calls, ["DISCOVER", "MONTAGE", "TEST", "TITLE"]);
      assert.equal((await readdir(result.blogDir)).length, 2, "One new Journal article should be published beside the fixed first-article fixture.");
    } finally {
      await cleanup(result.root);
    }
  });

  // 1b. The upper allowed source-count boundary is also accepted.
  await run("1b — six-source candidate accepted", async () => {
    const maxCandidate = candidate("candidate-a", {
      source_ids: SOURCE_IDS.slice(0, 6),
      exit_id: SOURCE_IDS[5],
    });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(maxCandidate) },
      { stage: "MONTAGE", response: montageResponse() },
      { stage: "TEST", response: strongResponse() },
      { stage: "TITLE", response: titleResponse() },
    ]);
    try {
      assert.equal(result.thrown, undefined);
      assert.equal(result.calls.includes("TITLE"), true);
    } finally {
      await cleanup(result.root);
    }
  });

  // 2. Too few sources.
  await run("2 — source count below four rejected", async () => {
    const bad = candidate("candidate-b", {
      source_ids: SOURCE_IDS.slice(0, 3),
      exit_id: SOURCE_IDS[2],
    });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.ok(result.logs.some((line) => line.includes("failed source validation")));
      assert.deepEqual(result.calls, ["DISCOVER", "DISCOVER"]);
      assert.equal((await readdir(result.blogDir)).length, 0);
    } finally {
      await cleanup(result.root);
    }
  });

  // 2b. Too many source IDs are rejected even when all IDs exist in the snapshot.
  await run("2b — source count above six rejected", async () => {
    const bad = candidate("candidate-b", {
      source_ids: SOURCE_IDS.slice(0, 7),
      exit_id: SOURCE_IDS[6],
    });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.ok(result.logs.some((line) => line.includes("failed source validation")));
      assert.equal(result.calls.includes("MONTAGE"), false);
    } finally {
      await cleanup(result.root);
    }
  });

  // 3. Duplicate IDs.
  await run("3 — duplicate source IDs rejected", async () => {
    const bad = candidate("candidate-b", {
      source_ids: [SOURCE_IDS[0], SOURCE_IDS[1], SOURCE_IDS[1], SOURCE_IDS[3]],
    });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.ok(result.logs.some((line) => line.includes("failed source validation")));
      assert.equal(result.calls.includes("MONTAGE"), false);
    } finally {
      await cleanup(result.root);
    }
  });

  // 4a. Unknown source ID.
  await run("4a — source ID outside snapshot rejected", async () => {
    const bad = candidate("candidate-b", {
      source_ids: [SOURCE_IDS[0], SOURCE_IDS[1], SOURCE_IDS[2], "not-in-snapshot"],
      exit_id: "not-in-snapshot",
    });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.ok(result.logs.some((line) => line.includes("failed source validation")));
    } finally {
      await cleanup(result.root);
    }
  });

  // 4b. Non-string source ID.
  await run("4b — non-string source ID rejected", async () => {
    const bad = candidate("candidate-b", {
      source_ids: [SOURCE_IDS[0], SOURCE_IDS[1], 17, SOURCE_IDS[3]],
    });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.ok(result.logs.some((line) => line.includes("failed source validation")));
    } finally {
      await cleanup(result.root);
    }
  });

  // 5. Entry and exit must be included in the source set.
  await run("5 — entry/exit outside source list rejected", async () => {
    const bad = candidate("candidate-b", {
      entry_id: SOURCE_IDS[4],
      exit_id: SOURCE_IDS[5],
    });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.ok(result.logs.some((line) => line.includes("failed source validation")));
    } finally {
      await cleanup(result.root);
    }
  });

  // 6. Structural rejection does not prevent a later distinct valid candidate.
  await run("6 — valid candidate after structural rejection", async () => {
    const bad = candidate("candidate-b", { source_ids: SOURCE_IDS.slice(0, 3) });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montageResponse() },
      { stage: "TEST", response: strongResponse() },
      { stage: "TITLE", response: titleResponse() },
    ]);
    try {
      assert.equal(result.thrown, undefined);
      assert.ok(result.logs.some((line) => line.includes("failed source validation")));
      assert.equal(result.calls.includes("TITLE"), true);
    } finally {
      await cleanup(result.root);
    }
  });

  // 7. One repeated rejected ID is tolerated; a different candidate is processed.
  await run("7 — one repeated rejected ID then a new candidate", async () => {
    const bad = candidate("candidate-b", { source_ids: SOURCE_IDS.slice(0, 3) });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montageResponse() },
      { stage: "TEST", response: strongResponse() },
      { stage: "TITLE", response: titleResponse() },
    ]);
    try {
      assert.equal(result.thrown, undefined);
      assert.ok(result.logs.some((line) => line.includes("repeat 1/2")));
      assert.equal(result.calls.includes("TITLE"), true);
    } finally {
      await cleanup(result.root);
    }
  });

  // 8. The second repeated return ends discovery in a controlled way.
  await run("8 — repeated rejected ID stops discovery", async () => {
    const bad = candidate("candidate-b", { source_ids: SOURCE_IDS.slice(0, 3) });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: discoverResponse(bad) },
      { stage: "DISCOVER", response: discoverResponse(bad) },
    ]);
    try {
      assert.equal(result.thrown, undefined);
      assert.ok(result.logs.some((line) => line.includes("stopping to prevent an unbounded loop")));
      assert.equal(result.calls.filter((stage) => stage === "DISCOVER").length, 3);
      assert.equal(result.calls.includes("MONTAGE"), false);
    } finally {
      await cleanup(result.root);
    }
  });

  // 9. Existing publication is preserved and the conflict is reported.
  await run("9 — existing publication is not overwritten", async () => {
    const filename = expectedFilename();
    const sentinel = "EXISTING PUBLICATION MUST REMAIN UNCHANGED";
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montageResponse() },
      { stage: "TEST", response: strongResponse() },
      { stage: "TITLE", response: titleResponse() },
    ], {}, async ({ blogDir }) => {
      await writeFile(join(blogDir, filename), sentinel, "utf8");
    });
    try {
      assert.ok(result.thrown instanceof Error);
      assert.ok(result.thrown.message.includes("JOURNAL_OUTPUT_CONFLICT"));
      assert.equal(await readFile(join(result.blogDir, filename), "utf8"), sentinel);
    } finally {
      await cleanup(result.root);
    }
  });

  // 10. New publication is written when the target does not exist.
  await run("10 — new publication written", async () => {
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montageResponse() },
      { stage: "TEST", response: strongResponse() },
      { stage: "TITLE", response: titleResponse() },
    ]);
    try {
      const files = await readdir(result.blogDir);
      assert.deepEqual(files, ["01-01-2026-fixed-first-article.md", expectedFilename()]);
      assert.ok((await readFile(join(result.blogDir, expectedFilename()), "utf8")).includes('category: "journal"'));
    } finally {
      await cleanup(result.root);
    }
  });

  // 11. Simulate a competing writer creating the target after existsSync but before writeFile.
  await run("11 — race at publication write does not overwrite", async () => {
    const raceSentinel = "CREATED BY COMPETING WRITER";
    const writeFileFn: NonNullable<JournalRunOptions["writeFileFn"]> =
      async (path, data, options) => {
        await writeFile(path, raceSentinel, { encoding: "utf8", flag: "wx" });
        return writeFile(path, data, options);
      };
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montageResponse() },
      { stage: "TEST", response: strongResponse() },
      { stage: "TITLE", response: titleResponse() },
    ], { writeFileFn });
    try {
      assert.ok(result.thrown instanceof Error);
      assert.ok(result.thrown.message.includes("JOURNAL_OUTPUT_CONFLICT"));
      assert.equal(await readFile(join(result.blogDir, expectedFilename()), "utf8"), raceSentinel);
    } finally {
      await cleanup(result.root);
    }
  });

  // 12. An unrelated filesystem error is not mislabeled as an output conflict.
  await run("12 — unrelated write error propagates", async () => {
    const unrelatedWriteError = Object.assign(new Error("simulated disk failure"), { code: "EIO" });
    const writeFileFn: NonNullable<JournalRunOptions["writeFileFn"]> = async () => {
      throw unrelatedWriteError;
    };
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montageResponse() },
      { stage: "TEST", response: strongResponse() },
      { stage: "TITLE", response: titleResponse() },
    ], { writeFileFn });
    try {
      assert.equal(result.thrown, unrelatedWriteError);
      assert.equal((result.thrown as (Error & { code?: string }) | undefined)?.code, "EIO");
      assert.equal((result.thrown as Error).message.includes("JOURNAL_OUTPUT_CONFLICT"), false);
    } finally {
      await cleanup(result.root);
    }
  });

  // 13. A matching TASK 2 candidate_id reaches TASK 3.
  await run("13 — matching candidate_id reaches TASK 3", async () => {
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montageResponse("candidate-a") },
      { stage: "TEST", response: strongResponse() },
      { stage: "TITLE", response: titleResponse() },
    ]);
    try {
      assert.ok(result.calls.includes("TEST"));
      assert.equal(result.thrown, undefined);
    } finally {
      await cleanup(result.root);
    }
  });

  // 14. A mismatching candidate_id is rejected before TASK 3.
  await run("14 — mismatching candidate_id rejected before TASK 3", async () => {
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montageResponse("candidate-other") },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.ok(result.logs.some((line) => line.includes("candidate_id mismatch")));
      assert.equal(result.calls.includes("TEST"), false);
    } finally {
      await cleanup(result.root);
    }
  });

  // 15a. Missing candidate_id is rejected before TASK 3.
  await run("15a — missing candidate_id rejected before TASK 3", async () => {
    const missingId = { ...montageResponse() } as Record<string, unknown>;
    delete missingId.candidate_id;
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: missingId },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.ok(result.logs.some((line) => line.includes("candidate_id mismatch")));
      assert.equal(result.calls.includes("TEST"), false);
    } finally {
      await cleanup(result.root);
    }
  });

  // 15b. A non-string candidate_id is rejected before TASK 3.
  await run("15b — non-string candidate_id rejected before TASK 3", async () => {
    const wrongType = { ...montageResponse(), candidate_id: 42 };
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: wrongType },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.ok(result.logs.some((line) => line.includes("candidate_id mismatch")));
      assert.equal(result.calls.includes("TEST"), false);
    } finally {
      await cleanup(result.root);
    }
  });

  // Joint T1 + T2 acceptance scenario.
  await run("T1 + T2 — rejection and repeat tracking still allow a new candidate", async () => {
    const invalid = candidate("candidate-b", { source_ids: SOURCE_IDS.slice(0, 3) });
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(invalid) },
      { stage: "DISCOVER", response: discoverResponse(invalid) },
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montageResponse() },
      { stage: "TEST", response: strongResponse() },
      { stage: "TITLE", response: titleResponse() },
    ]);
    try {
      assert.equal(result.thrown, undefined);
      assert.ok(result.logs.some((line) => line.includes("failed source validation")));
      assert.ok(result.logs.some((line) => line.includes("repeat 1/2")));
      assert.equal(result.calls.includes("TITLE"), true);
    } finally {
      await cleanup(result.root);
    }
  });


  // T5 boundary probes. These assert the required behavior; on the pre-T5
  // orchestrator they should report the specific missing guards (Red).
  const t5Failures: string[] = [];
  const t5Probe = async (name: string, test: () => Promise<void>) => {
    try {
      await test();
      console.log(`PASS T5 — ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      t5Failures.push(`${name}: ${message}`);
      console.log(`FAIL T5 — ${name}: ${message}`);
    }
  };

  await t5Probe("C3a — task2.source_ids must belong to snapshot", async () => {
    const montage = montageResponse();
    montage.source_ids = [SOURCE_IDS[0], SOURCE_IDS[1], SOURCE_IDS[2], "not-in-snapshot"];
    montage.composition = montage.source_ids.map((source_id) => ({
      type: "source", source_id, text: `Fragment ${source_id}.`,
    }));
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montage },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.equal(result.calls.includes("TEST"), false,
        "MONTAGE with an out-of-snapshot source_id reached TASK 3");
      assert.ok(result.logs.some((line) => line.includes("not-in-snapshot")),
        "Rejection diagnostic did not identify the invalid source ID");
    } finally { await cleanup(result.root); }
  });

  await t5Probe("C3b — composition source blocks must belong to snapshot", async () => {
    const montage = montageResponse();
    montage.composition[3] = {
      type: "source", source_id: "not-in-snapshot", text: "Invalid source block.",
    };
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montage },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.equal(result.calls.includes("TEST"), false,
        "Composition with an out-of-snapshot source block reached TASK 3");
      assert.ok(result.logs.some((line) => line.includes("not-in-snapshot")),
        "Rejection diagnostic did not identify the invalid composition source ID");
    } finally { await cleanup(result.root); }
  });

  await t5Probe("C3c — source_ids and composition source sets must match", async () => {
    const montage = montageResponse();
    montage.composition[3] = {
      type: "source", source_id: SOURCE_IDS[4], text: "Different but valid source.",
    };
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montage },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.equal(result.calls.includes("TEST"), false,
        "Mismatched valid source sets reached TASK 3");
      assert.ok(result.logs.some((line) => line.includes("MONTAGE") &&
        (line.includes("mismatch") || line.includes("composition") || line.includes("source"))),
        "Rejection diagnostic did not describe the source-set mismatch");
    } finally { await cleanup(result.root); }
  });

  await t5Probe("F4 — duplicate source_ids are rejected before TEST and publication", async () => {
    const montage = montageResponse();
    montage.source_ids = [SOURCE_IDS[0], SOURCE_IDS[1], SOURCE_IDS[1], SOURCE_IDS[2], SOURCE_IDS[3]];
    const result = await execute([
      { stage: "DISCOVER", response: discoverResponse(candidate("candidate-a")) },
      { stage: "MONTAGE", response: montage },
      { stage: "DISCOVER", response: noJournalResponse() },
    ]);
    try {
      assert.equal(result.thrown, undefined);
      assert.equal(result.calls.includes("TEST"), false,
        "A montage with duplicate source_ids reached TEST");
      assert.ok(result.logs.some((line) => line.includes("duplicate")),
        "The duplicate source_ids rejection was not reported");
      assert.equal((await readdir(result.blogDir)).length, 0,
        "A rejected montage must not be published");
    } finally { await cleanup(result.root); }
  });

  if (t5Failures.length) {
    console.log(`\nT5 Red confirmed: ${t5Failures.length}/4 required-behavior probes failed against current implementation.`);
    for (const failure of t5Failures) console.log(`- ${failure}`);
    process.exitCode = 1;
  } else {
    passed += 4;
    console.log("T5 Green: all four required-behavior probes passed.");
  }

  console.log(`\nAll ${passed} testability scenarios passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
