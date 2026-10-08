import { IMAGE_HOST, IMAGE_MODELS, createImagePayload, normalizeModels } from '../server/shared.mjs';
export { createImagePayload, normalizeModels } from '../server/shared.mjs';

export const BRIDGE = '/api/plugins/imagegen-plus';

async function errorDetail(response, apiKey) {
    // The native proxy forwards upstream error bodies without Content-Type.
    // Read a bounded body and redact credentials before displaying provider text.
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks = [];
    let length = 0;
    try {
        while (length < 8192) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value.slice(0, 8192 - length));
            length += value.length;
        }
    } catch { return ''; }
    finally { await reader.cancel().catch(() => {}); }
    const text = new TextDecoder().decode(new Uint8Array(chunks.flatMap(chunk => [...chunk])));
    let message = '';
    try {
        const body = JSON.parse(text);
        message = body.error?.message ?? body.message ?? (typeof body.error === 'string' ? body.error : '');
    } catch {
        if (!/<[a-z!/][^>]*>/i.test(text)) message = text;
    }
    if (typeof message !== 'string') return '';
    for (const key of [apiKey, apiKey.trim(), encodeURIComponent(apiKey.trim())].filter(Boolean)) message = message.replaceAll(key, '[redacted]');
    return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\b(?:sk-|lr-|ltr-)[A-Za-z0-9_-]+/g, '[redacted]').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

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
        const requestHeaders = !manual ? { ...headers } : {};
        if (proxy && headers['X-CSRF-Token']) requestHeaders['X-CSRF-Token'] = headers['X-CSRF-Token'];
        if (manual) requestHeaders.Authorization = `Bearer ${apiKey.trim()}`;
        if (!catalog) requestHeaders['Content-Type'] = 'application/json';
        if (manual) requestHeaders.Accept = catalog ? 'application/json' : 'image/jpeg';
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
        throw new Error('Could not reach the UIGE server bridge. Check the SillyTavern connection.', { cause: error });
    }
    if (!response.ok) {
        if (manual) {
            if (proxy && response.status === 401 && /\bBasic\b.*realm="?SillyTavern\b/i.test(response.headers.get('WWW-Authenticate') || '')) {
                // ST rejects this before its proxy or LiteRouter runs. Only this
                // explicit local auth challenge is safe to retry directly.
                await response.body?.cancel().catch(() => {});
                try {
                    return await request(path, { profile, apiKey, settings: { ...settings, directTransport: 'direct' }, signal: combined, headers, fetchFn, payload });
                } catch (error) {
                    if (combined.aborted) throw combined.reason;
                    throw new Error(`SillyTavern Basic Auth blocks the proxy. Direct request failed: ${error.message}`, { cause: error });
                }
            }
            if (proxy && response.status === 404) throw new Error('Enable enableCorsProxy: true in SillyTavern’s config.yaml and restart, or choose a direct browser request. No UIGE server plugin is needed.');
            const fallback = { 401: 'Check your API key.', 402: 'Payment or model access rejected.', 403: 'Check your key and account plan.', 429: 'Rate limit reached.' }[response.status] || '';
            const detail = await errorDetail(response, apiKey) || fallback;
            throw new Error(`LiteRouter ${proxy ? 'proxy' : 'direct'} request failed (${response.status}). ${detail}`.trim());
        }
        if (response.status === 404) throw new Error('Install the bundled UIGE server bridge and restart SillyTavern, or choose Manual API key in Connection settings.');
        let detail = '';
        try { detail = (await response.json()).error || ''; } catch { /* Missing/unavailable plugin route. */ }
        throw new Error(detail || `UIGE image request failed (${response.status}).`);
    }
    return { response, transport: manual ? proxy ? 'proxy' : 'direct' : 'profile' };
}

export const liteRouter = {
    id: 'literouter', name: 'LiteRouter',
    async models(options) {
        const { response } = await request('models', options);
        const payload = await response.json();
        if (options.settings.imageConnection !== 'manual' && !Array.isArray(payload.models)) throw new Error('The image bridge returned an invalid model list.');
        const ids = new Set(normalizeModels(payload));
        return IMAGE_MODELS.map(model => ({ ...model, listed: ids.has(model.id) }));
    },
    async generate(prompt, options) {
        const payload = createImagePayload(prompt, options.settings);
        const { response, transport } = await request('generate', { ...options, payload });
        const blob = await response.blob();
        const magic = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
        if (!blob.size || magic[0] !== 0xff || magic[1] !== 0xd8 || magic[2] !== 0xff) throw new Error('LiteRouter returned an unexpected response instead of a JPEG image.');
        return {
            blob: new Blob([blob], { type: 'image/jpeg' }), format: 'jpg', transport,
            model: response.headers.get('X-Model') || payload.model,
            seed: response.headers.get('X-Seed') ?? (payload.seed === undefined ? null : String(payload.seed)),
            requestId: response.headers.get('X-Request-ID') || null,
        };
    },
};
