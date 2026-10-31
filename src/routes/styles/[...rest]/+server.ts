import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Styles now live inside each manga; old links go to the collection.
export const GET: RequestHandler = () => redirect(308, '/');
