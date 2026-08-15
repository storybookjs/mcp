---
'@storybook/mcp': patch
---

Expand aliased string-literal unions in `react-docgen-typescript` output.

When a prop's type is a named alias of a string-literal union (e.g. `variant?: ButtonVariant`), `shouldExtractLiteralValuesFromEnum` makes RDT record the alias name in `type.raw` and the resolved members in `type.value`. The previous serializer only read `type.raw`, so consumers received the alias name and lost the member list. The serializer now walks `type.value` for `enum`-named types and falls back to `type.raw` / `type.name` only when no members are present, so inline and aliased unions render the same way.
