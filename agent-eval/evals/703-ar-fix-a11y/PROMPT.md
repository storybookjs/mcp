<!-- TODO(SB-1689): placeholder — replace with authored workflow prompt. Benchmark app fixture pending SB-1680/SB-1681. -->

Fix the accessibility issues in this app: the `Tag` component in `src/components/Tag.tsx` renders as a plain `<span>` with no semantic role, so screen reader users can't tell "beta" is a status label rather than body text. Give it an appropriate ARIA role and accessible name so assistive technology announces it correctly, without changing its visual appearance.
