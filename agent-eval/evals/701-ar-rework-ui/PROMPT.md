<!-- TODO(SB-1689): placeholder — replace with authored workflow prompt. Benchmark app fixture pending SB-1680/SB-1681. -->

Rework the `Button` component in `src/components/Button.tsx` to support a `loading` state: while loading, it should show a spinner in place of its label and be disabled. Wire the "New note" button in `src/App.tsx` to use this state for a simulated 1-second delay before completing.
