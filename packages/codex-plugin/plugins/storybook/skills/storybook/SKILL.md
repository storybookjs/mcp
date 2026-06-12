---
name: storybook
description: >-
  Invoke BEFORE you touch a frontend component, on EVERY change, with no
  exception — call this FIRST, before writing, editing, or deleting, so the
  workflow governs how the change is made. Triggers on creating, editing, OR
  deleting any frontend component (React/Vue/Svelte and similar
  *.tsx/.jsx/.ts/.js/.vue/.svelte files) or anything it renders with. Invoke
  this even if the change seems cosmetic-only, internal, a refactor, a rename,
  a deletion, or has "no behavior change" — that judgment is NOT yours to make;
  the skill always runs first. Also use when the user asks to write, update,
  generate, or review Storybook stories or any *.stories.* file, to add
  Storybook to a project, to upgrade or repair Storybook, to configure the
  Storybook preview or example stories, or before starting or previewing
  Storybook to verify UI — including when repair instructions mention the
  storybook-init or storybook-upgrade skills.
---

# Storybook

This skill is a single entry point that dispatches to command-specific
reference files. The references — not this page — contain the actual
workflows and their gates.

## Setup (non-optional)

1. Determine which command applies using the Routing rules below.
2. Read the matching `references/<command>.md` file (relative to this skill's
   directory) and follow it exactly. **This is non-optional.** The reference
   defines the command's workflow and gates; acting from this page alone will
   skip steps the workflow requires. Do NOT run any Storybook command or touch
   any file until the reference is loaded.

## Commands

| Command   | Use when                                                                                    | Reference                                      |
| --------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `stories` | (DEFAULT) A frontend component is being created/edited/deleted, or any story work is needed | [references/stories.md](references/stories.md) |
| `init`    | The project has no Storybook yet and it should be added                                      | [references/init.md](references/init.md)       |
| `setup`   | Storybook exists; configure the preview and write example stories                            | [references/setup.md](references/setup.md)     |
| `upgrade` | Storybook is too old, or repair instructions require an upgrade/automigration                | [references/upgrade.md](references/upgrade.md) |

## Routing rules

1. **Component change or story work (the default):** if this skill ran because
   you are about to create, edit, or delete a frontend component, or because
   stories must be written, updated, reviewed, or previewed — read
   `references/stories.md`. When in doubt, this is the route.
2. **Explicit command:** if the user's argument starts with a command name
   (`stories`, `init`, `setup`, `upgrade`), read that command's reference.
   Everything after the command name is the target.
3. **Intent mapping:** "add Storybook" → `init`; "upgrade/repair Storybook" or
   repair instructions mentioning `storybook-upgrade` → `upgrade`; repair
   instructions mentioning `storybook-init` → `init`; "set up the preview" or
   `storybook ai setup` → `setup`. If two commands could fit, ask the user
   once which one they mean.
4. **Hand-offs:** references hand off to each other (e.g. `stories` requires
   `upgrade` for old Storybooks). When a reference tells you to read another
   reference, do so, complete it, then return and resume where you left off.

## Absolute rules (apply to every command)

- Storybook CLI `ai` subcommands must be run with `STORYBOOK_FEATURE_AI_CLI=1`.
- You MUST NOT write or edit a story from memory or existing patterns; only
  the instructions returned by the Storybook CLI `ai` subcommands are an
  acceptable source for imports, structure, and conventions.
- A component change is NOT complete until the `stories` workflow has finished
  for every component you touched.
