import { describe, expect, it } from 'vitest';
import { buildEditWorkflow, buildWorkflow, STRONG_CFG } from './comfyui';
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
			if (model === 'qwen-image-2.1-strong') continue; // guided on purpose, below
			if (model.startsWith('qwen-image-2.1')) {
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
		expect(wf.sigmas.class_type).toBe('ManualSigmas');
	});

	it('runs the full Qwen-Image 2.1 for 25 steps on its own weights', () => {
		const wf = buildWorkflow({
			model: 'qwen-image-2.1-full',
			prompt: 'ink',
			seed: 7,
			width: 512,
			height: 768
		});
		expect(wf.positive.inputs.prompt).toBe('ink');
		expect(wf.noise.inputs.noise_seed).toBe(7);
		expect(wf.unet.inputs.unet_name).toBe('qwen_image_2.1_bf16.safetensors');
		expect(wf.sigmas).toEqual({
			class_type: 'BasicScheduler',
			inputs: { model: ['cache', 0], scheduler: 'simple', steps: 25, denoise: 1 }
		});
		expect(wf.sample.inputs.sigmas).toEqual(['sigmas', 0]);
	});

	it('weighs the prompt and the Avoid list with the strong-prompt model only', () => {
		const req = { prompt: 'ink', negative: 'text', seed: 7, width: 64, height: 64 };
		const strong = buildWorkflow({ ...req, model: 'qwen-image-2.1-strong' });
		expect(strong.unet.inputs.unet_name).toBe('qwen_image_2.1_bf16.safetensors');
		expect(strong.guider.inputs.cfg).toBe(STRONG_CFG);
		expect(strong.positive.inputs.negative_prompt).toBe('text');
		const full = buildWorkflow({ ...req, model: 'qwen-image-2.1-full' });
		expect(full.guider.inputs.cfg).toBe(1);
		expect(full.positive.inputs.negative_prompt).toBe('');
		const edit = buildEditWorkflow(
			{ model: 'qwen-image-2.1-strong', prompt: 'x', negative: 'text', seed: 1 },
			['a.png']
		);
		expect(edit.guider.inputs.cfg).toBe(STRONG_CFG);
		expect(edit.positive.inputs.negative_prompt).toBe('text');
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
		expect(wf.unet.inputs.unet_name).toBe('qwen_image_2.1_turbo_bf16.safetensors');
		const full = buildEditWorkflow({ model: 'qwen-image-2.1-full', prompt: 'x', seed: 1 }, [
			'a.png',
			'b.png'
		]);
		expect(full.unet.inputs.unet_name).toBe('qwen_image_2.1_bf16.safetensors');
		expect(full.sigmas.inputs.steps).toBe(25);
		expect(full.positive.inputs['images.image_2']).toEqual(['resize2', 0]);
		const z = buildEditWorkflow({ model: 'z-image', prompt: 'x', seed: 1 }, ['a.png']);
		expect(z.unet.inputs.unet_name).toBe('qwen_image_edit_2509_bf16.safetensors');
	});
});
