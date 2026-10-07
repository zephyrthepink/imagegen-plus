import { IMAGE_HOST, IMAGE_MODELS, isLiteRouterProfile, createImagePayload, normalizeModels } from './shared.mjs';

export function createHandlers({ readSecret, secretKey = 'api_key_custom', fetcher = globalThis.fetch }) {
    const handler = operation => async (request, response) => {
        const directories = request.user?.directories;
        if (!directories) return response.status(401).json({ error: 'Sign in to SillyTavern to use ImageGen+.' });
        const body = request.body ?? {};
        if (!isLiteRouterProfile(body.profile)) return response.status(400).json({ error: 'Choose a Custom connection profile using https://api.literouter.com/v1.' });
        if (body.profile['secret-id'] !== null && body.profile['secret-id'] !== undefined && typeof body.profile['secret-id'] !== 'string') return response.status(400).json({ error: 'The connection profile has an invalid saved secret ID.' });
        let payload;
        if (operation === 'generate') {
            try { payload = createImagePayload(body.prompt, body); }
            catch (error) { return response.status(400).json({ error: error.message }); }
        }
        const timeoutSeconds = Number.isInteger(body.timeoutSeconds) && body.timeoutSeconds >= 15 && body.timeoutSeconds <= 600 ? body.timeoutSeconds : 120;
        const controller = new AbortController();
        const disconnected = () => { if (!response.writableEnded) controller.abort(); };
        response.on('close', disconnected);
        try {
            const key = readSecret(directories, secretKey, body.profile['secret-id'] || null);
            if (!key) return response.status(400).json({ error: 'This connection profile has no saved API key. Save its key in SillyTavern Connection Manager.' });
            const result = await fetcher(`${IMAGE_HOST}/${operation === 'generate' ? 'generate' : 'models'}`, {
                method: operation === 'generate' ? 'POST' : 'GET',
                headers: { Authorization: `Bearer ${key}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
                ...(payload ? { body: JSON.stringify(payload) } : {}),
                redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutSeconds * 1000)]),
            });
            if (!result.ok) {
                const hints = { 401: 'The profile’s saved key was rejected.', 402: 'Check your LiteRouter credits or plan.', 403: 'Check the profile’s key, plan or LiteRouter access.', 404: 'The endpoint or model was not found.', 429: 'Rate limit reached. Wait before trying again.' };
                return response.status(result.status === 404 ? 502 : result.status).json({ error: `LiteRouter request failed (${result.status}). ${hints[result.status] || 'Try again later or check the provider status.'}` });
            }
            response.setHeader('Cache-Control', 'no-store');
            if (operation === 'models') {
                const models = normalizeModels(await result.json()).filter(id => IMAGE_MODELS.some(model => model.id === id));
                if (!models.length) return response.status(502).json({ error: 'LiteRouter returned no recognized image models. The curated list is still available.' });
                return response.json({ models });
            }
            const bytes = Buffer.from(await result.arrayBuffer());
            if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return response.status(502).json({ error: 'LiteRouter returned an unexpected response instead of a JPEG image.' });
            controller.signal.throwIfAborted();
            response.setHeader('Content-Type', 'image/jpeg');
            for (const header of ['X-Model', 'X-Seed', 'X-Request-ID']) {
                const value = result.headers.get(header);
                if (value) response.setHeader(header, value);
            }
            return response.send(bytes);
        } catch (error) {
            if (controller.signal.aborted || response.destroyed) return;
            const timeout = error?.name === 'TimeoutError';
            return response.status(timeout ? 504 : 502).json({ error: timeout ? 'LiteRouter image request timed out.' : 'Could not fetch a valid response from LiteRouter.' });
        } finally { response.removeListener('close', disconnected); }
    };
    return { models: handler('models'), generate: handler('generate') };
}
