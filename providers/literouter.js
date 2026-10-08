import { IMAGE_HOST, IMAGE_MODELS, createImagePayload, normalizeModels } from '../server/shared.mjs';
export { createImagePayload, normalizeModels } from '../server/shared.mjs';

export const BRIDGE = '/api/plugins/imagegen-plus';

async function request(path, { profile, apiKey = '', settings, signal, headers = {}, fetchFn = fetch, payload = {} }) {
    const manual = settings.imageConnection === 'manual';
    const proxy = manual && settings.directTransport === 'proxy';
    if (manual && !apiKey.trim()) throw new Error('Enter your LiteRouter API key in Connection settings.');
    if (!manual && !profile?.id) throw new Error('Choose your saved LiteRouter connection profile in Connection settings.');
    const timeout = AbortSignal.timeout(settings.timeoutSeconds * 1000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
        const url = manual ? `${proxy ? '/proxy/' : ''}${IMAGE_HOST}/${path}` : `${BRIDGE}/${path}`;
        const catalog = manual && path === 'models';
        const requestHeaders = !manual || proxy ? { ...headers } : {};
        if (manual) requestHeaders.Authorization = `Bearer ${apiKey.trim()}`;
        if (!catalog) requestHeaders['Content-Type'] = 'application/json';
        response = await fetchFn(url, {
            method: catalog ? 'GET' : 'POST', signal: combined,
            credentials: manual && !proxy ? 'omit' : 'same-origin', redirect: 'error',
            headers: requestHeaders,
            ...(catalog ? {} : { body: JSON.stringify(manual ? payload : { profile, timeoutSeconds: settings.timeoutSeconds, ...payload }) }),
        });
    } catch (error) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
        if (timeout.aborted) throw new Error(`LiteRouter did not respond within ${settings.timeoutSeconds} seconds.`, { cause: error });
        if (manual) {
            const message = proxy
                ? 'Could not reach LiteRouter through SillyTavern’s CORS proxy. Check your connection and enableCorsProxy setting.'
                : 'Could not reach LiteRouter directly. Check your connection; if your browser blocks cross-origin requests, choose the SillyTavern CORS proxy.';
            throw new Error(message, { cause: error });
        }
        throw new Error('Could not reach the ImageGen+ server bridge. Check the SillyTavern connection.', { cause: error });
    }
    if (!response.ok) {
        if (manual) {
            if (proxy && response.status === 404) throw new Error('Enable enableCorsProxy: true in SillyTavern’s config.yaml and restart, or choose a direct browser request. No ImageGen+ server plugin is needed.');
            const detail = { 401: 'Check your LiteRouter API key.', 403: 'Check your key and account plan.', 429: 'Rate limit reached. Try again later.' }[response.status] || '';
            throw new Error(`LiteRouter image request failed (${response.status}). ${detail}`.trim());
        }
        if (response.status === 404) throw new Error('Install the bundled ImageGen+ server bridge and restart SillyTavern, or choose Manual API key in Connection settings.');
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
        if (options.settings.imageConnection !== 'manual' && !Array.isArray(payload.models)) throw new Error('The image bridge returned an invalid model list.');
        const ids = new Set(normalizeModels(payload));
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
