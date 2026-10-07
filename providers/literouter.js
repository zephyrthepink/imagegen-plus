const HOST = 'https://image.literouter.com';

export function createImagePayload(prompt, settings) {
    if (!prompt?.trim()) throw new Error('The image prompt is empty.');
    for (const key of ['width', 'height']) {
        if (!Number.isInteger(settings[key]) || settings[key] < 256 || settings[key] > 2048) throw new Error(`${key} must be a whole number from 256 to 2048.`);
    }
    const payload = { prompt, model: settings.model.trim(), width: settings.width, height: settings.height };
    if (!payload.model) throw new Error('Choose an image model.');
    if (settings.seed !== '') {
        const seed = Number(settings.seed);
        if (!/^\d+$/.test(String(settings.seed)) || !Number.isSafeInteger(seed) || seed > 4294967295) throw new Error('Seed must be blank or a whole number from 0 to 4294967295.');
        payload.seed = seed;
    }
    return payload;
}

async function request(path, { key, settings, signal, headers = {}, fetchFn = fetch, ...options }) {
    if (!key?.trim()) throw new Error('Enter your LiteRouter API key in Connection settings.');
    const timeout = AbortSignal.timeout(settings.timeoutSeconds * 1000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const url = settings.transport === 'proxy' ? `/proxy/${HOST}${path}` : `${HOST}${path}`;
    let response;
    try {
        response = await fetchFn(url, {
            ...options, signal: combined,
            headers: { ...(settings.transport === 'proxy' ? headers : {}), 'Authorization': `Bearer ${key.trim()}`, ...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        });
    } catch (error) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
        if (timeout.aborted) throw new Error(`LiteRouter did not respond within ${settings.timeoutSeconds} seconds.`, { cause: error });
        throw new Error('Could not reach LiteRouter. Check your network, or select the SillyTavern CORS proxy if direct requests are blocked.', { cause: error });
    }
    if (!response.ok) {
        // Never echo a remote response that might contain the submitted API key.
        const hints = { 401: 'Your API key was rejected.', 402: 'Check your LiteRouter credits or plan.', 403: 'Access was denied. Check your key, plan, or Cloudflare access.', 404: settings.transport === 'proxy' ? 'Check that enableCorsProxy is true in SillyTavern config.yaml, then restart SillyTavern.' : 'The requested endpoint or model was not found.', 429: 'Rate limit reached. Wait before trying again.' };
        throw new Error(`LiteRouter request failed (${response.status}). ${hints[response.status] ?? 'Try again later or check the provider status.'}`);
    }
    return response;
}

export function normalizeModels(payload) {
    const list = Array.isArray(payload) ? payload : payload?.models ?? payload?.data;
    const rows = Array.isArray(list) ? list : list && typeof list === 'object' ? Object.entries(list).map(([id, value]) => ({ ...value, id })) : [];
    return [...new Set(rows.map(row => typeof row === 'string' ? row : row?.id ?? row?.name ?? row?.model).filter(id => typeof id === 'string' && id.trim()))];
}

export const liteRouter = {
    id: 'literouter', name: 'LiteRouter',
    async models(options) {
        const response = await request('/models', { ...options, method: 'GET' });
        const models = normalizeModels(await response.json());
        if (!models.length) throw new Error('LiteRouter returned no recognized models. You can enter a model ID manually.');
        return models;
    },
    async generate(prompt, options) {
        const payload = createImagePayload(prompt, options.settings);
        const response = await request('/generate', { ...options, method: 'POST', body: JSON.stringify(payload) });
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
