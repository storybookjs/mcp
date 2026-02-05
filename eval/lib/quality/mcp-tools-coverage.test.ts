import { it, expect } from "vitest";
import type { TrialArgs, ExecutionSummary } from "../../types.ts";
import { fromMcpToolsCoverage } from "./mcp-tools-coverage.ts";
import { extractMcpToolsSummary } from "../graders/mcp-tools.ts";
import type { TranscriptMessage } from "../../templates/result-docs/transcript.types.ts";

it("missing expected tool should penalize score", () => {
  // Only get-documentation was called
  const messages: TranscriptMessage[] = [
    {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "1", name: "mcp__sb__get-documentation", input: {}, isMCP: true }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      ms: 0,
    },
    {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "1", content: "" }] },
      ms: 0,
    },
  ];

  // Both get-documentation and list-all-documentation are expected
  const mcpTools = extractMcpToolsSummary(messages, {
    "get-documentation": {},
    "list-all-documentation": {},
  });

  const result = fromMcpToolsCoverage({
    trialArgs: {} as TrialArgs,
    execution: {} as ExecutionSummary,
    grading: {
      buildSuccess: true,
      typeCheckErrors: 0,
      lintErrors: 0,
      test: { passed: 0, failed: 0 },
      a11y: { violations: 0 },
      mcpTools,
    },
  });

  // FAILS: toolPresenceScore is hardcoded to 1.0 — it only looks at toolsWithValidation
  // (tools that were called), so it never notices list-all-documentation is missing
  expect(result!.score).toBeLessThan(1.0);
});
