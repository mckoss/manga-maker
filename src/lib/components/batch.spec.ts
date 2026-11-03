import { describe, expect, it } from 'vitest';
import { batchLabel, everythingLabel } from './batch';

describe('batch labels', () => {
	it('says Generate until something made goes out of date', () => {
		expect(batchLabel({ missing: 4, stale: 0 }, 'design')).toBe('Generate 4 designs');
		expect(batchLabel({ missing: 0, stale: 4 }, 'design')).toBe('Regenerate 4 out-of-date designs');
		expect(
			everythingLabel([
				{ missing: 4, stale: 0 },
				{ missing: 8, stale: 0 }
			])
		).toBe('Generate everything');
		expect(everythingLabel([{ missing: 0, stale: 2 }])).toBe('Regenerate everything out of date');
		expect(
			everythingLabel([
				{ missing: 0, stale: 2 },
				{ missing: 4, stale: 0 }
			])
		).toBe('Generate and regenerate everything');
	});
});
