import { describe, expect, it } from 'vitest';
import { buildWorkflow } from './comfyui';

describe('buildWorkflow', () => {
	it('fills prompt, size and seed into the Qwen-Image template', () => {
		const wf = buildWorkflow({
			model: 'qwen-image',
			prompt: 'ink',
			negativePrompt: 'color',
			seed: 7,
			width: 512,
			height: 768
		});
		expect(wf.positive.inputs.text).toBe('ink');
		expect(wf.negative.inputs.text).toBe('color');
		expect(wf.latent.inputs).toMatchObject({ width: 512, height: 768 });
		expect(wf.sampler.inputs.seed).toBe(7);
	});

	it('leaves Z-Image without a negative prompt (it is distilled)', () => {
		const wf = buildWorkflow({ model: 'z-image', prompt: 'ink', seed: 1, width: 64, height: 64 });
		expect(wf.negative.class_type).toBe('ConditioningZeroOut');
		expect(wf.negative.inputs.text).toBeUndefined();
	});
});
