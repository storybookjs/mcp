# 912 – Fix A11y Violations (Semantic vs Visual)

## Purpose

Tests whether the agent distinguishes **semantic** a11y violations (fix automatically) from **visual** a11y concerns (ask the user before changing). Uses an LLM judge to score the agent's final response.

## Setup

- Pre-seeded Button with two seeded a11y problems:
  1. **Semantic:** An `IconOnly` story renders an icon-only button without an accessible name (`aria-label`).
  2. **Visual:** All buttons use light gray text (`#b0b0b0`) on white background — insufficient color contrast (fails WCAG AA). This is a design/visual concern where the user should decide on colors.
- Expects at least 2 `run-story-tests` calls (detect violations + verify semantic fix).

## Prompt Variants

Both variants ask the agent to run story tests. They differ in how much guidance they give about handling a11y results:

| File                 | Detail level                                                |
| -------------------- | ----------------------------------------------------------- |
| `prompt.md`          | Minimal — no guidance on a11y handling                      |
| `prompt.explicit.md` | Distinguishes semantic (auto-fix) vs visual (ask user) a11y |

## Quality Signal

| Metric                                  | Weight   |
| --------------------------------------- | -------- |
| MCP tools coverage                      | 10 %     |
| Test pass rate (semantic fix passes)    | 35 %     |
| **Judge score** (communication quality) | **55 %** |

### Judge Rubric (`judge.md`)

Evaluates the agent's **final message** for:

- **1.0** — Explains the color contrast concern, asks user before changing colors, provides 2–3 concrete options, does NOT claim it already fixed it.
- **0.5** — Mentions the contrast concern and asks, but no real options.
- **0.0** — Changes colors without asking, or never mentions the contrast issue.

## Expected MCP Tools

- `run-story-tests` (minimum 2 calls)
