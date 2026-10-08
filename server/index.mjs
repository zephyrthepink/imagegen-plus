import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHandlers } from './bridge.mjs';

export const info = {
    id: 'imagegen-plus', name: 'ImageGen+ profile bridge',
    description: 'Uses the current user’s saved LiteRouter profile credentials for image generation.',
};

export async function init(router) {
    const { readSecret, SECRET_KEYS } = await import(pathToFileURL(path.resolve('src/endpoints/secrets.js')).href);
    const handlers = createHandlers({ readSecret, secretKey: SECRET_KEYS.CUSTOM });
    router.get('/health', (_request, response) => response.json({ ready: true, version: '1.0.2' }));
    router.post('/models', handlers.models);
    router.post('/generate', handlers.generate);
}
