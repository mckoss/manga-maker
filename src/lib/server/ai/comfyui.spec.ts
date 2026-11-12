import { describe, expect, it } from 'vitest';
import {
	buildEditWorkflow,
	buildWorkflow,
	H3_AREA,
	h3Canvas,
	h3Prompt,
	STRONG_CFG
} from './comfyui';
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

describe('MiniMax H3-Image', () => {
	it('draws on a ~4 MP canvas of the requested shape, then scales to the requested size', () => {
		const wf = buildWorkflow({
			model: 'minimax-h3-image',
			prompt: 'ink',
			seed: 7,
			width: 1344,
			height: 768
		});
		const { width, height } = wf.positive.inputs as { width: number; height: number };
		expect(width % 32).toBe(0);
		expect(height % 32).toBe(0);
		expect(width / height).toBeCloseTo(1344 / 768, 1);
		expect(Math.abs(width * height - H3_AREA) / H3_AREA).toBeLessThan(0.05);
		expect(wf.positive.inputs.prompt).toBe('ink');
		expect(wf.sampler.inputs).toMatchObject({
			seed: 7,
			steps: 6,
			cfg: 1,
			latent_image: ['positive', 1]
		});
		expect(wf.scale.inputs).toMatchObject({ width: 1344, height: 768 });
		expect(wf.unet.inputs.unet_name).toBe('minimax_h3_image_pruned_bf16.safetensors');
	});

	it('keeps a square at the native 2048 × 2048', () => {
		expect(h3Canvas(1024, 1024)).toEqual({ width: 2048, height: 2048 });
	});

	it('edits the first picture with the rest as references, named as H3 expects', () => {
		const wf = buildEditWorkflow(
			{ model: 'minimax-h3-image', prompt: 'put image 2 in front of Image 1', seed: 5 },
			['a.png', 'b.png', 'c.png']
		);
		expect(wf.load1.inputs.image).toBe('a.png');
		expect(wf.positive.inputs['images.image_1']).toEqual(['align', 0]);
		expect(wf.load3.inputs.image).toBe('c.png');
		expect(wf.positive.inputs['images.image_3']).toEqual(['load3', 0]);
		expect(wf.positive.inputs.prompt).toBe('put <Picture 2> in front of <Picture 1>');
		expect(wf.sampler.inputs.seed).toBe(5);
		expect(() =>
			buildEditWorkflow({ model: 'minimax-h3-image', prompt: '', seed: 1 }, Array(17).fill('a.png'))
		).toThrow();
	});

	it('leaves other words alone when naming pictures', () => {
		expect(h3Prompt('an image of image 3')).toBe('an image of <Picture 3>');
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
