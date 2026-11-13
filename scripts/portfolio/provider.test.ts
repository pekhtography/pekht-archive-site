import assert from "node:assert/strict";
import test from "node:test";
import { generatePortfolioJson, generatePortfolioGallery, PortfolioProviderError, PortfolioModelsExhaustedError } from "./provider.ts";

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

test("429 unknown quota without Retry-After: skips current model and falls back immediately", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "COMPOSE", callId: "call-unknown-quota-no-header",
      fetchFn: async () => {
        request += 1;
        if (request === 1) {
          return new Response(JSON.stringify({
            error: { code: 429, message: "Too many requests" },
          }), { status: 429 });
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

test("429 unknown quota with short Retry-After: skips current model without sleeping", async () => {
  await withHarness(async ({ waits }) => {
    let request = 0;
    const result = await generatePortfolioJson("prompt", {}, {
      stage: "COMPOSE", callId: "call-unknown-quota-short-header",
      fetchFn: async () => {
        request += 1;
        if (request === 1) {
          return new Response(JSON.stringify({
            error: { code: 429, message: "Too many requests" },
          }), { status: 429, headers: { "Retry-After": "30" } });
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
    for (const key of envKeys.slice(1)) delete process.env[key];
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


const independentCandidateId = "cand_" + "b".repeat(64);
const independentContext = {
  sourceTexts: {
    "source-1": "The river carries yesterday beneath today's bridge.",
    "source-2": "A window holds the last blue minute of evening.",
    "source-3": "The station clock pauses while footsteps continue.",
    "source-4": "A shadow stretches beyond the hour marked on the wall.",
    "source-5": "The first light measures the room in silence.",
    "source-6": "At dawn, the street returns every borrowed color.",
  },
  composition: {
    title: "Borrowed Hours",
    statement: "Time moves through light, water, and the traces of human passage.",
    facets: ["Time", "Light"],
    roles: [],
  },
};
const independentApprove = {
  candidate_id: independentCandidateId,
  decision: "APPROVE",
  scores: { semantic_coherence: 5, curatorial_originality: 4, narrative_integrity: 4, visual_composition: 4, evidence_integrity: 5 },
  findings: [{
    criterion: "semantic_coherence",
    issue: "The selected texts sustain a coherent temporal motif.",
    blocking: false,
    evidence: { kind: "SOURCE", source_id: "source-1", quote: "The river carries yesterday" },
  }],
  blocking_issues: [],
};
const independentReject = {
  candidate_id: independentCandidateId,
  decision: "REJECT",
  scores: { semantic_coherence: 3, curatorial_originality: 2, narrative_integrity: 3, visual_composition: 4, evidence_integrity: 2 },
  findings: [{
    criterion: "evidence_integrity",
    issue: "The proposed interpretation is not supported by the selected source.",
    blocking: true,
    evidence: { kind: "SOURCE", source_id: "source-1", quote: "The river carries yesterday" },
  }],
  blocking_issues: ["The proposed interpretation is not supported."],
};

test("independent TEST: returns the v1.3.2 response type and records candidate and TEST stage", async () => {
  const { evaluateIndependentTest } = await import("./provider.ts");
  await withHarness(async () => {
    const result = await evaluateIndependentTest("independent TEST prompt", {}, {
      candidateId: independentCandidateId,
      validationContext: independentContext,
      fetchFn: async () => okResponse(independentApprove),
    });
    assert.deepEqual(result.data, independentApprove);
    assert.equal("gallery" in result.data, false);
    assert.equal(result.model_used.length, 1);
    assert.equal(result.model_used[0].stage, "TEST");
    assert.equal(result.model_used[0].candidate_id, independentCandidateId);
    assert.equal(result.model_used[0].outcome, "SUCCESS");
    assert.match(result.model_used[0].call_id, /^[0-9a-f-]{36}$/i);
  });
});

test("independent TEST: APPROVE and REJECT are both valid model decisions", async () => {
  const { evaluateIndependentTest } = await import("./provider.ts");
  await withHarness(async () => {
    for (const response of [independentApprove, independentReject]) {
      const result = await evaluateIndependentTest("prompt", {}, {
        candidateId: independentCandidateId,
        validationContext: independentContext,
        fetchFn: async () => okResponse(response),
      });
      assert.equal(result.data.decision, response.decision);
    }
  });
});

test("independent TEST: fallback attempts share one call_id and preserve fallback diagnostics", async () => {
  const { evaluateIndependentTest } = await import("./provider.ts");
  await withHarness(async () => {
    let request = 0;
    const result = await evaluateIndependentTest("prompt", {}, {
      candidateId: independentCandidateId,
      validationContext: independentContext,
      fetchFn: async () => {
        request += 1;
        if (request <= 3) return new Response("temporary", { status: 503 });
        return okResponse(independentApprove);
      },
      sleepFn: async () => {},
    });
    assert.equal(request, 4);
    assert.equal(result.model_used.length, 2);
    assert.equal(result.model_used[0].outcome, "FALLBACK");
    assert.equal(result.model_used[1].outcome, "SUCCESS");
    assert.equal(result.model_used[0].call_id, result.model_used[1].call_id);
    assert.equal(result.model_used[0].candidate_id, independentCandidateId);
    assert.deepEqual(result.model_used.map((record) => record.attempts), [3, 1]);
  });
});

test("independent TEST: each new logical invocation receives a distinct call_id", async () => {
  const { evaluateIndependentTest } = await import("./provider.ts");
  await withHarness(async () => {
    const invoke = () => evaluateIndependentTest("prompt", {}, {
      candidateId: independentCandidateId,
      validationContext: independentContext,
      fetchFn: async () => okResponse(independentApprove),
    });
    const first = await invoke();
    const second = await invoke();
    assert.notEqual(first.model_used[0].call_id, second.model_used[0].call_id);
  });
});

test("independent TEST: mismatched candidate ID is rejected and diagnostics are retained", async () => {
  const { evaluateIndependentTest } = await import("./provider.ts");
  await withHarness(async () => {
    let caught: unknown;
    try {
      await evaluateIndependentTest("prompt", {}, {
        candidateId: independentCandidateId,
        validationContext: independentContext,
        fetchFn: async () => okResponse({ ...independentApprove, candidate_id: "cand_" + "c".repeat(64) }),
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof PortfolioProviderError);
    assert.equal(caught.retryable, false);
    assert.equal(caught.model_used.length, 1);
    assert.equal(caught.model_used[0].outcome, "FAILED");
    assert.equal(caught.model_used[0].stage, "TEST");
  });
});

test("independent TEST: malformed evidence and invalid JSON are rejected", async () => {
  const { evaluateIndependentTest } = await import("./provider.ts");
  await withHarness(async () => {
    let invalidEvidence: unknown;
    try {
      await evaluateIndependentTest("prompt", {}, {
        candidateId: independentCandidateId,
        validationContext: independentContext,
        fetchFn: async () => okResponse({
          ...independentApprove,
          findings: [{ ...independentApprove.findings[0], evidence: { kind: "SOURCE", source_id: "outside", quote: "not present" } }],
        }),
      });
    } catch (error) {
      invalidEvidence = error;
    }
    assert.ok(invalidEvidence instanceof PortfolioProviderError);
    assert.equal(invalidEvidence.model_used[0].outcome, "FAILED");

    let invalidJson: unknown;
    try {
      await evaluateIndependentTest("prompt", {}, {
        candidateId: independentCandidateId,
        validationContext: independentContext,
        fetchFn: async () => new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{invalid json" }] } }],
        }), { status: 200 }),
      });
    } catch (error) {
      invalidJson = error;
    }
    assert.ok(invalidJson instanceof PortfolioProviderError);
    assert.equal(invalidJson.model_used.length, 1);
    assert.equal(invalidJson.model_used[0].outcome, "FAILED");
  });
});

test("independent TEST: exhausted fallback returns all model diagnostics", async () => {
  const { evaluateIndependentTest } = await import("./provider.ts");
  await withHarness(async () => {
    let caught: unknown;
    try {
      await evaluateIndependentTest("prompt", {}, {
        candidateId: independentCandidateId,
        validationContext: independentContext,
        maxAttemptsPerModel: 1,
        fetchFn: async () => new Response("unavailable", { status: 503 }),
        sleepFn: async () => {},
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof PortfolioModelsExhaustedError);
    assert.equal(caught.model_used.length, 2);
    assert.deepEqual(caught.model_used.map((record) => record.outcome), ["FALLBACK", "FAILED"]);
    assert.ok(caught.model_used.every((record) => record.stage === "TEST"));
    assert.ok(caught.model_used.every((record) => record.candidate_id === independentCandidateId));
    assert.equal(caught.model_used[0].call_id, caught.model_used[1].call_id);
  });
});

test("independent TEST: missing API key makes no request and does not fabricate model diagnostics", async () => {
  const { evaluateIndependentTest } = await import("./provider.ts");
  await withHarness(async () => {
    delete process.env.GEMINI_API_KEY;
    let called = false;
    let caught: unknown;
    try {
      await evaluateIndependentTest("prompt", {}, {
        candidateId: independentCandidateId,
        validationContext: independentContext,
        fetchFn: async () => { called = true; return okResponse(independentApprove); },
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof PortfolioProviderError);
    assert.equal(caught.attempts, 0);
    assert.deepEqual(caught.model_used, []);
    assert.equal(called, false);
  });
});

const standaloneGalleryFixture = {"source_ids":["s1","s2","s3","s4","s5","s6"],"title":"Test gallery","statement":"A coherent statement","facets":["Light","Shadow"],"roles":[{"source_id":"s1","role":"Role 0","operation":"Contrast","evidence":[{"quote":"Exact source quote","interpretation":"Supports the role"}],"necessity":"Necessary"},{"source_id":"s2","role":"Role 1","operation":"Contrast","evidence":[{"quote":"Exact source quote","interpretation":"Supports the role"}],"necessity":"Necessary"},{"source_id":"s3","role":"Role 2","operation":"Contrast","evidence":[{"quote":"Exact source quote","interpretation":"Supports the role"}],"necessity":"Necessary"},{"source_id":"s4","role":"Role 3","operation":"Contrast","evidence":[{"quote":"Exact source quote","interpretation":"Supports the role"}],"necessity":"Necessary"},{"source_id":"s5","role":"Role 4","operation":"Contrast","evidence":[{"quote":"Exact source quote","interpretation":"Supports the role"}],"necessity":"Necessary"},{"source_id":"s6","role":"Role 5","operation":"Contrast","evidence":[{"quote":"Exact source quote","interpretation":"Supports the role"}],"necessity":"Necessary"}],"composition_rationale":"The sequence develops a coherent visual argument.","alternatives_considered":[],"doubts":[]};
test("standalone gallery Provider: COMPOSE returns gallery and stage diagnostics", async () => {
 await withHarness(async () => {
  const result=await generatePortfolioGallery("compose",{}, {stage:"COMPOSE",candidateId:"candidate-gallery",fetchFn:async()=>okResponse(standaloneGalleryFixture)});
  assert.deepEqual(result.data,standaloneGalleryFixture);
  assert.equal(result.model_used[0].stage,"COMPOSE");
  assert.equal(result.model_used[0].candidate_id,"candidate-gallery");
  assert.equal(result.model_used[0].outcome,"SUCCESS");
 });
});
test("standalone gallery Provider: REVISION fallback attempts share one call_id", async () => {
 await withHarness(async () => {
  let requests=0;
  const result=await generatePortfolioGallery("revision",{}, {stage:"REVISION",candidateId:"candidate-gallery",fetchFn:async()=>{requests++;return requests<=3?new Response("temporary",{status:503}):okResponse(standaloneGalleryFixture);},sleepFn:async()=>{}});
  assert.equal(requests,4);
  assert.deepEqual(result.model_used.map(x=>x.outcome),["FALLBACK","SUCCESS"]);
  assert.equal(result.model_used[0].call_id,result.model_used[1].call_id);
  assert.ok(result.model_used.every(x=>x.stage==="REVISION"));
 });
});
test("standalone gallery Provider: rejects embedded TEST and malformed gallery fields", async () => {
 await withHarness(async () => {
  let caught:unknown;
  try { await generatePortfolioGallery("compose",{}, {stage:"COMPOSE",fetchFn:async()=>okResponse({...standaloneGalleryFixture,test:{decision:"APPROVE"}})}); } catch(e) {caught=e;}
  assert.ok(caught instanceof PortfolioProviderError);
  assert.equal(caught.retryable,false);
  assert.equal(caught.model_used[0].outcome,"FAILED");
 });
});
