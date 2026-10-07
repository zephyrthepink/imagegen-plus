import { IMAGE_MODELS, createImagePayload } from '../server/shared.mjs';
export { createImagePayload, normalizeModels } from '../server/shared.mjs';

export const BRIDGE = '/api/plugins/imagegen-plus';

async function request(path, { profile, settings, signal, headers = {}, fetchFn = fetch, payload = {} }) {
    if (!profile?.id) throw new Error('Choose your saved LiteRouter connection profile in Connection settings.');
    const timeout = AbortSignal.timeout(settings.timeoutSeconds * 1000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
        response = await fetchFn(`${BRIDGE}/${path}`, {
            method: 'POST', signal: combined,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile, timeoutSeconds: settings.timeoutSeconds, ...payload }),
        });
    } catch (error) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
        if (timeout.aborted) throw new Error(`LiteRouter did not respond within ${settings.timeoutSeconds} seconds.`, { cause: error });
        throw new Error('Could not reach the ImageGen+ server bridge. Check the SillyTavern connection.', { cause: error });
    }
    if (!response.ok) {
        if (response.status === 404) throw new Error('Install the bundled ImageGen+ server bridge and restart SillyTavern. Open Connection settings for setup instructions.');
        let detail = '';
        try { detail = (await response.json()).error || ''; } catch { /* Missing/unavailable plugin route. */ }
        throw new Error(detail || `ImageGen+ image request failed (${response.status}).`);
    }
    return response;
}

export const liteRouter = {
    id: 'literouter', name: 'LiteRouter',
    async models(options) {
        const response = await request('models', options);
        const payload = await response.json();
        if (!Array.isArray(payload.models)) throw new Error('The image bridge returned an invalid model list.');
        const ids = new Set(payload.models);
        return IMAGE_MODELS.map(model => ({ ...model, listed: ids.has(model.id) }));
    },
    async generate(prompt, options) {
        const payload = createImagePayload(prompt, options.settings);
        const response = await request('generate', { ...options, payload });
        const blob = await response.blob();
        const magic = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
        if (!blob.size || magic[0] !== 0xff || magic[1] !== 0xd8 || magic[2] !== 0xff) throw new Error('LiteRouter returned an unexpected response instead of a JPEG image.');
        return {
            blob: new Blob([blob], { type: 'image/jpeg' }), format: 'jpg',
            model: response.headers.get('X-Model') || payload.model,
            seed: response.headers.get('X-Seed') ?? (payload.seed === undefined ? null : String(payload.seed)),
            requestId: response.headers.get('X-Request-ID') || null,
        };
    },
};
