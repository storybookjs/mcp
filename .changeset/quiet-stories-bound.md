---
"@storybook/addon-mcp": patch
---

`get-changed-stories`: bound the response so it never overflows the host tool-output token limit (storybookjs/mcp#311).

When a shared primitive (Badge, Tag, Icon, …) changes, every story that transitively renders it shows up as a "related" status. On large repos this reached 1,000+ entries (~126KB / ~56k est. tokens on Chakra), exceeding Claude/MCP's ~25k tool-output cap. The result was silently spilled to a file and the agent self-curated from a head/tail of it — in the worst case (Carbon) dropping the brand-new component from the review entirely.

Now the tool:

- always lists **new** and **modified** stories in full — the directly-changed ones are never dropped;
- reduces the **related** bucket to a bounded sample plus a complete per-component count, with an explicit truncation note pointing at `get-stories-by-component` for full enumeration. The sample is **ranked by import distance** when the Storybook build reports it (`status.data.distance`): it takes the closest story from each affected component first, so it maximizes both component breadth and relevance (the stories that actually render the change). Each related line is annotated `— distance N` and the breakdown shows each component's `nearest dN`. When distance is unavailable (older Storybook) it degrades to component-diverse round-robin — still bounded and broad;
- enforces a token budget as a hard backstop (trimming the related sample first, then, only in pathological refactors, the direct buckets — always with a note rather than a silent drop);
- returns a structured `structuredContent` payload (`counts`, `relatedSample`, `relatedBreakdown`, `relatedTruncated`, …) so agents get the full related total and per-component breakdown without parsing markdown.

On the Carbon worst case this takes the response from ~60k est. tokens (over the cap) down to ~2.9k, with the new and modified stories intact and the related sample's mean import distance dropping from ~3.0 (distance-blind) to ~1.1.

See `packages/addon-mcp/docs/get-changed-stories-overflow.md` for the full design and the strategies benchmarked.
