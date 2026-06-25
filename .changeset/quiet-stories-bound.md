---
"@storybook/addon-mcp": patch
---

`get-changed-stories`: bound the response so it never overflows the host tool-output token limit (storybookjs/mcp#311).

When a shared primitive (Badge, Tag, Icon, …) changes, every story that transitively renders it shows up as a "related" status. On large repos this reached 1,000+ entries (~126KB / ~56k est. tokens on Chakra), exceeding Claude/MCP's ~25k tool-output cap. The result was silently spilled to a file and the agent self-curated from a head/tail of it — in the worst case (Carbon) dropping the brand-new component from the review entirely.

Now the tool:

- always lists **new** and **modified** stories in full — the directly-changed ones are never dropped;
- reduces the **related** bucket to a component-diverse sample (round-robin across components so one high-fan-out component can't crowd out the rest) plus a complete per-component count, with an explicit truncation note pointing at `get-stories-by-component` for full enumeration;
- enforces a token budget as a hard backstop (trimming the related sample first, then, only in pathological refactors, the direct buckets — always with a note rather than a silent drop);
- returns a structured `structuredContent` payload (`counts`, `relatedSample`, `relatedBreakdown`, `relatedTruncated`, …) so agents get the full related total and per-component breakdown without parsing markdown.

On the Carbon worst case this takes the response from ~60k est. tokens (over the cap) down to ~2.9k, with the new and modified stories intact.
