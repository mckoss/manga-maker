import { describe, expect, it } from 'vitest';
import { buildEditWorkflow, buildWorkflow } from './comfyui';
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

describe('buildEditWorkflow', () => {
	it('edits the first image and passes the rest as references', () => {
		const wf = buildEditWorkflow({ prompt: 'turn around', seed: 3 }, ['a.png', 'b.png']);
		expect(wf.load.inputs.image).toBe('a.png');
		expect(wf.load2.inputs.image).toBe('b.png');
		expect(wf.positive.inputs.image2).toEqual(['load2', 0]);
		expect(wf.positive.inputs.prompt).toBe('turn around');
		expect(wf.sampler.inputs).toMatchObject({ seed: 3, cfg: 1 });
		expect(() => buildEditWorkflow({ prompt: '', seed: 1 }, [])).toThrow();
	});
});
