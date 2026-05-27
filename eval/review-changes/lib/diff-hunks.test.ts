import { describe, expect, it } from 'vitest';
import { splitUnifiedDiff } from './diff-hunks.ts';

const TWO_FILE = `diff --git a/src/A.tsx b/src/A.tsx
index 1111111..2222222 100644
--- a/src/A.tsx
+++ b/src/A.tsx
@@ -1 +1 @@
-old
+new
diff --git a/src/B.tsx b/src/B.tsx
index 3333333..4444444 100644
--- a/src/B.tsx
+++ b/src/B.tsx
@@ -1 +1 @@
-x
+y`;

describe('splitUnifiedDiff', () => {
	it('returns one hunk per file', () => {
		expect(splitUnifiedDiff(TWO_FILE).map((h) => h.path)).toEqual(['src/A.tsx', 'src/B.tsx']);
	});

	it('each hunk keeps its own diff --git header and only its own content', () => {
		const [a, b] = splitUnifiedDiff(TWO_FILE);
		expect(a!.hunk.startsWith('diff --git a/src/A.tsx')).toBe(true);
		expect(a!.hunk).toContain('+new');
		expect(a!.hunk).not.toContain('src/B.tsx');
		expect(b!.hunk).toContain('+y');
	});

	it('uses the b/ (destination) path for a rename', () => {
		const hunks = splitUnifiedDiff(
			'diff --git a/old.ts b/new.ts\nrename from old.ts\nrename to new.ts',
		);
		expect(hunks[0]!.path).toBe('new.ts');
	});

	it('returns [] for an empty or whitespace-only diff', () => {
		expect(splitUnifiedDiff('')).toEqual([]);
		expect(splitUnifiedDiff('  \n  ')).toEqual([]);
	});
});
