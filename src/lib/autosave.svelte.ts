import type { SubmitFunction } from '$app/forms';

/**
 * Save a form by itself: when a field changes and the user leaves it (the
 * `change` event), or on ⌘/Ctrl+Enter in a text box. Each save is a new
 * version on the server, so it happens once per edit, not per keystroke.
 *
 *   const save = new AutoSave();
 *   <form use:enhance={save.enhance} {@attach save.attach}>…</form>
 *   {save.status}
 */
export class AutoSave {
	/** '' until the first save; then saving, saved or failed. */
	state = $state<'' | 'saving' | 'saved' | 'failed'>('');

	get status(): string {
		return { '': '', saving: 'Saving…', saved: 'Saved', failed: 'Not saved' }[this.state];
	}

	/** Submit without clearing what the user typed, and track the result. */
	enhance: SubmitFunction = () => {
		this.state = 'saving';
		return async ({ result, update }) => {
			this.state = result.type === 'success' ? 'saved' : 'failed';
			await update({ reset: false });
		};
	};

	attach = (form: HTMLFormElement) => {
		const submit = () => form.requestSubmit();
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				submit();
			}
		};
		form.addEventListener('change', submit);
		form.addEventListener('keydown', key);
		return () => {
			form.removeEventListener('change', submit);
			form.removeEventListener('keydown', key);
		};
	};
}
