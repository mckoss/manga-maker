import { describe, expect, it } from 'vitest';
import { buildWorkflow } from './comfyui';
import { IMAGE_MODELS, type ImageModelId } from './image';

describe('buildWorkflow', () => {
	it('fills prompt, size and seed into the Qwen-Image template', () => {
		const wf = buildWorkflow({
			model: 'qwen-image',
			prompt: 'ink',
			seed: 7,
			width: 512,
			height: 768
		});
		expect(wf.positive.inputs.text).toBe('ink');
		expect(wf.latent.inputs).toMatchObject({ width: 512, height: 768 });
		expect(wf.sampler.inputs.seed).toBe(7);
	});

	it('runs every model at CFG 1 with no negative prompt', () => {
		for (const model of Object.keys(IMAGE_MODELS) as ImageModelId[]) {
			const wf = buildWorkflow({ model, prompt: 'ink', seed: 1, width: 64, height: 64 });
			expect(wf.sampler.inputs.cfg).toBe(1);
			expect(wf.negative.class_type).toBe('ConditioningZeroOut');
		}
	});
});
