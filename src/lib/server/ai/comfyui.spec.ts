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
			if (model === 'qwen-image-2.1') {
				expect(wf.guider.inputs.cfg).toBe(1);
				expect(wf.positive.inputs.negative_prompt).toBe('');
			} else {
				expect(wf.sampler.inputs.cfg).toBe(1);
				expect(wf.negative.class_type).toBe('ConditioningZeroOut');
			}
		}
	});

	it('fills prompt, size and seed into the Qwen-Image 2.1 template', () => {
		const wf = buildWorkflow({
			model: 'qwen-image-2.1',
			prompt: 'ink',
			seed: 7,
			width: 512,
			height: 768
		});
		expect(wf.positive.inputs.prompt).toBe('ink');
		expect(wf.latent.inputs).toMatchObject({ width: 512, height: 768 });
		expect(wf.noise.inputs.noise_seed).toBe(7);
		expect(wf.unet.inputs.unet_name).toBe('qwen_image_2.1_turbo_bf16.safetensors');
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

	it('edits with Qwen-Image 2.1 itself, every image a reference, its latent from image 1', () => {
		const wf = buildEditWorkflow({ model: 'qwen-image-2.1', prompt: 'merge', seed: 5 }, [
			'a.png',
			'b.png'
		]);
		expect(wf.load1.inputs.image).toBe('a.png');
		expect(wf.load2.inputs.image).toBe('b.png');
		expect(wf.positive.inputs['images.image_1']).toEqual(['resize1', 0]);
		expect(wf.positive.inputs['images.image_2']).toEqual(['resize2', 0]);
		expect(wf.sample.inputs.latent_image).toEqual(['positive', 2]);
		expect(wf.noise.inputs.noise_seed).toBe(5);
		// The other families edit with Qwen-Image-Edit 2509.
		const z = buildEditWorkflow({ model: 'z-image', prompt: 'x', seed: 1 }, ['a.png']);
		expect(z.unet.inputs.unet_name).toBe('qwen_image_edit_2509_bf16.safetensors');
	});
});
