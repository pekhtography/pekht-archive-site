import assert from "node:assert/strict";
import test from "node:test";
import { generatePortfolioJson, PortfolioProviderError, PortfolioModelsExhaustedError } from "./provider.ts";

const envKeys = [
  "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_FALLBACK_1",
  "GEMINI_FALLBACK_2", "GEMINI_FALLBACK_3", "GEMINI_FALLBACK_4",
] as const;

const output = {
  gallery: null,
  test: { decision: "REJECT", findings: ["No coherent gallery"], revision_cycles: 0 },
};

function okResponse(value: unknown = output): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function withHarness(
  run: (context: { waits: number[] }) => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const waits: number[] = [];
  process.env.GEMINI_API_KEY = "mock-only-key";
  process.env.GEMINI_MODEL = "mock-primary";
  process.env.GEMINI_FALLBACK_1 = "mock-fallback";
  for (const key of envKeys.slice(3)) delete process.env[key];

  try {
    await run({ waits });
  } finally {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("success: parses Gemini JSON from a successful mock response", async () => {
  await withHarness(async ({ waits }) => {
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "DISCOVER", callId: "call-success",
      fetchFn: async () => okResponse(),
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.deepEqual(result.data, output);
    assert.deepEqual(waits, []);
    assert.equal(result.model_used[0].outcome, "SUCCESS");
  });
});

test("fallback: advances after retryable primary failure and records both models", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "COMPOSE", candidateId: "candidate-1", callId: "call-fallback",
      fetchFn: async () => {
        request += 1;
        if (request <= 3) return new Response("temporary", { status: 503 });
        return okResponse();
      },
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.deepEqual(result.data, output);
    assert.equal(request, 4);
    assert.deepEqual(waits, [1_000, 2_000]);
    assert.equal(result.model_used.length, 2);
    assert.equal(result.model_used[0].model, "mock-primary");
    assert.equal(result.model_used[0].outcome, "FALLBACK");
    assert.equal(result.model_used[0].attempts, 3);
    assert.equal(result.model_used[1].model, "mock-fallback");
    assert.equal(result.model_used[1].outcome, "SUCCESS");
    assert.equal(result.model_used[1].fallback_index, 1);
  });
});

test("timeout: retries a timed-out request and succeeds without network access", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "TEST", callId: "call-timeout",
      fetchFn: async () => {
        request += 1;
        if (request === 1) throw new DOMException("mock timeout", "TimeoutError");
        return okResponse();
      },
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.deepEqual(result.data, output);
    assert.equal(request, 2);
    assert.deepEqual(waits, [1_000]);
    assert.equal(result.model_used[0].attempts, 2);
  });
});

test("429: skips a model on confirmed daily quota and falls back immediately", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "DISCOVER", callId: "call-429",
      fetchFn: async () => {
        request += 1;
        if (request === 1) return new Response(JSON.stringify({
          error: { code: 429, message: "Generate content requests per day quota exceeded" },
        }), { status: 429 });
        return okResponse();
      },
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.equal(request, 2);
    assert.deepEqual(waits, []);
    assert.equal(result.model_used[0].outcome, "FALLBACK");
    assert.equal(result.model_used[0].attempts, 1);
    assert.equal(result.model_used[1].outcome, "SUCCESS");
  });
});

test("5xx: retries transient server errors with exponential backoff", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "REVISION", callId: "call-5xx",
      fetchFn: async () => {
        request += 1;
        if (request < 3) return new Response("server error", { status: 503 });
        return okResponse();
      },
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.equal(request, 3);
    assert.deepEqual(waits, [1_000, 2_000]);
    assert.equal(result.model_used[0].outcome, "SUCCESS");
    assert.equal(result.model_used[0].attempts, 3);
  });
});

test("model_used: records stage, candidate, model, fallback index, attempts and outcome", async () => {
  await withHarness(async () => {
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "TEST", candidateId: "candidate-42", callId: "stable-call-id",
      fetchFn: async () => okResponse(),
    });
    assert.deepEqual(result.model_used, [{
      call_id: "stable-call-id",
      stage: "TEST",
      candidate_id: "candidate-42",
      model: "mock-primary",
      fallback_index: 0,
      attempts: 1,
      outcome: "SUCCESS",
    }]);
  });
});


test("non-retryable failure: retains earlier fallback and failed model diagnostics with cause", async () => {
  await withHarness(async () => {
    let request = 0;
    let caught: unknown;
    try {
      await generatePortfolioJson("prompt", {}, {
        stage: "TEST", candidateId: "candidate-1", callId: "call-non-retryable",
        fetchFn: async () => {
          request += 1;
          if (request <= 3) return new Response("temporary", { status: 503 });
          return new Response("bad request", { status: 400 });
        },
        sleepFn: async () => {},
      });
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof PortfolioProviderError);
    assert.equal(caught.model_used.length, 2);
    assert.deepEqual(caught.model_used.map((record) => ({
      model: record.model,
      outcome: record.outcome,
      attempts: record.attempts,
    })), [
      { model: "mock-primary", outcome: "FALLBACK", attempts: 3 },
      { model: "mock-fallback", outcome: "FAILED", attempts: 1 },
    ]);
    assert.ok(caught.cause instanceof PortfolioProviderError);
    assert.equal(request, 4);
  });
});

test("missing API key: exposes an empty model_used array without fabricating an attempt", async () => {
  await withHarness(async () => {
    delete process.env.GEMINI_API_KEY;
    let fetchCalled = false;
    let caught: unknown;
    try {
      await generatePortfolioJson("prompt", {}, {
        stage: "DISCOVER",
        fetchFn: async () => {
          fetchCalled = true;
          return okResponse();
        },
      });
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof PortfolioProviderError);
    assert.deepEqual(caught.model_used, []);
    assert.equal(caught.attempts, 0);
    assert.equal(fetchCalled, false);
  });
});

test("model-chain exhaustion: exposes accumulated diagnostics through the common Provider error", async () => {
  await withHarness(async () => {
    let caught: unknown;
    try {
      await generatePortfolioJson("prompt", {}, {
        stage: "COMPOSE", callId: "call-exhausted",
        maxAttemptsPerModel: 1,
        fetchFn: async () => new Response("unavailable", { status: 503 }),
        sleepFn: async () => {},
      });
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof PortfolioModelsExhaustedError);
    assert.ok(caught instanceof PortfolioProviderError);
    assert.equal(caught.model_used.length, 2);
    assert.deepEqual(caught.model_used.map((record) => record.outcome), ["FALLBACK", "FAILED"]);
    assert.ok(caught.cause instanceof PortfolioProviderError);
  });
});


test("network and backoff failures: retries network errors and preserves attempts when sleepFn fails", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "TEST", callId: "call-network-retry",
      fetchFn: async () => {
        request += 1;
        if (request === 1) throw new TypeError("fetch failed");
        return okResponse();
      },
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.equal(request, 2);
    assert.deepEqual(waits, [1_000]);
    assert.equal(result.model_used[0].attempts, 2);
  });

  await withHarness(async () => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "TEST", callId: "call-sleep-failure",
      fetchFn: async () => {
        request += 1;
        if (request === 1) throw new TypeError("fetch failed");
        return okResponse();
      },
      sleepFn: async () => { throw new Error("mock backoff failure"); },
    });
    assert.equal(request, 2);
    assert.equal(result.model_used.length, 2);
    assert.equal(result.model_used[0].model, "mock-primary");
    assert.equal(result.model_used[0].outcome, "FALLBACK");
    assert.equal(result.model_used[0].attempts, 1);
    assert.equal(result.model_used[1].outcome, "SUCCESS");
  });
});

test("429 TPM/RPM: classifies token and request rate limits", async () => {
  await withHarness(async () => {
    for (const [quotaMessage, expectedQuota] of [
      ["Quota exceeded for metric: generate_content_input_token_count", "tpm"],
      ["Quota exceeded for metric: generate_content_requests", "rpm"],
    ] as const) {
      process.env.GEMINI_FALLBACK_1 = "";
      let caught: unknown;
      try {
        await generatePortfolioJson("prompt", {}, {
          stage: "DISCOVER", callId: `call-${expectedQuota}`,
          maxAttemptsPerModel: 1,
          fetchFn: async () => new Response(JSON.stringify({
            error: { code: 429, message: quotaMessage },
          }), { status: 429 }),
          sleepFn: async () => {},
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof PortfolioModelsExhaustedError);
      assert.ok(caught.cause instanceof PortfolioProviderError);
      assert.equal(caught.cause.quotaType, expectedQuota);
      assert.equal(caught.model_used.length, 1);
      assert.equal(caught.model_used[0].attempts, 1);
    }
  });
});

test("429 Retry-After over 120 seconds: skips current model without sleeping and falls back", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "COMPOSE", callId: "call-long-retry-after",
      fetchFn: async () => {
        request += 1;
        if (request === 1) {
          return new Response(JSON.stringify({
            error: { code: 429, message: "Too many requests" },
          }), { status: 429, headers: { "Retry-After": "121" } });
        }
        return okResponse();
      },
      sleepFn: async (ms) => { waits.push(ms); },
    });
    assert.equal(request, 2);
    assert.deepEqual(waits, []);
    assert.equal(result.model_used.length, 2);
    assert.equal(result.model_used[0].outcome, "FALLBACK");
    assert.equal(result.model_used[0].attempts, 1);
    assert.equal(result.model_used[1].outcome, "SUCCESS");
  });
});

test("model policy: built-in chain is explicit and Lite is the final fallback only", async () => {
  await withHarness(async () => {
    for (const key of envKeys.slice(2)) delete process.env[key];
    const requestedModels: string[] = [];
    let caught: unknown;
    try {
      await generatePortfolioJson("prompt", {}, {
        stage: "DISCOVER",
        maxAttemptsPerModel: 1,
        fetchFn: async (input) => {
          const url = new URL(String(input));
          requestedModels.push(decodeURIComponent(url.pathname.split("/models/")[1].split(":")[0]));
          return new Response("temporary", { status: 503 });
        },
        sleepFn: async () => {},
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof PortfolioModelsExhaustedError);
    assert.deepEqual(requestedModels, [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
    ]);
    assert.equal(caught.model_used.at(-1)?.outcome, "FAILED");
  });
});

test("model policy: an explicit custom chain replaces built-ins without auto-appending Lite", async () => {
  await withHarness(async () => {
    process.env.GEMINI_MODEL = "custom-primary";
    process.env.GEMINI_FALLBACK_1 = "custom-secondary";
    for (const key of envKeys.slice(3)) delete process.env[key];
    const requestedModels: string[] = [];
    let caught: unknown;
    try {
      await generatePortfolioJson("prompt", {}, {
        stage: "DISCOVER",
        maxAttemptsPerModel: 1,
        fetchFn: async (input) => {
          const url = new URL(String(input));
          requestedModels.push(decodeURIComponent(url.pathname.split("/models/")[1].split(":")[0]));
          return new Response("temporary", { status: 503 });
        },
        sleepFn: async () => {},
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof PortfolioModelsExhaustedError);
    assert.deepEqual(requestedModels, ["custom-primary", "custom-secondary"]);
    assert.ok(!requestedModels.includes("gemini-3.5-flash-lite"));
  });
});
