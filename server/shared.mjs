export const IMAGE_HOST = 'https://image.literouter.com';

// Curated from the user's LiteRouter image-model catalog reference.
export const IMAGE_MODELS = [
    ['2dn-pony-v2', 'Pro', 50], ['aniflatmix-anime', 'Pro', 50],
    ['animagine-xl-31', 'Pro', 50], ['artiwaifu-diffusion', 'Pro', 50],
    ['atomix-xl', 'Pro', 50], ['boltning', 'Pro', 50],
    ['crystal-clear-xl-lightning', 'Pro', 50], ['cyberrealistic-pony-v9', 'Pro', 50],
    ['cyberrealistic-xl', 'Pro', 50], ['dreamshaper-v1', 'Plus', 30],
    ['dreamshaper-xl', 'Pro', 50], ['fast-sdxl', 'Pro', 50],
    ['fluently-xl', 'Pro', 50], ['gen-illustrious', 'Pro', 50],
    ['hassaku', 'Pro', 50], ['hidream-i1-fast', 'Plus', 30],
    ['p-image', 'Pro', 50], ['persona', 'Pro', 50],
    ['proteus', 'Plus', 30], ['prunaai', 'Pro', 50],
    ['realpony-xl', 'Pro', 50], ['rev-animated', 'Plus', 20],
    ['sdxl-turbo', '', 15],
].map(([id, tier, cost]) => Object.freeze({ id, tier, cost }));

export function isLiteRouterProfile(profile) {
    if (!profile || profile.api !== 'custom' || typeof profile.id !== 'string' || !profile.id) return false;
    try {
        const url = new URL(profile['api-url']);
        return url.protocol === 'https:' && url.hostname === 'api.literouter.com' && !url.port &&
            !url.username && !url.password && !url.search && !url.hash && url.pathname.replace(/\/+$/, '') === '/v1';
    } catch { return false; }
}

export function imageProfiles(context) {
    if (context.extensionSettings.disabledExtensions?.includes('connection-manager')) return [];
    return (context.extensionSettings.connectionManager?.profiles ?? []).filter(isLiteRouterProfile);
}

export function resolveImageProfile(context, profileId = '') {
    const id = profileId || context.extensionSettings.connectionManager?.selectedProfile;
    const profile = imageProfiles(context).find(profile => profile.id === id);
    if (!profile) throw new Error('Choose a saved Custom (OpenAI-compatible) connection profile using https://api.literouter.com/v1 in Connection settings.');
    return { id: profile.id, api: profile.api, 'api-url': profile['api-url'], 'secret-id': profile['secret-id'] || null };
}

export function createImagePayload(prompt, settings) {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('The image prompt is empty.');
    for (const key of ['width', 'height']) {
        if (!Number.isInteger(settings[key]) || settings[key] < 256 || settings[key] > 2048) throw new Error(`${key} must be a whole number from 256 to 2048.`);
    }
    const model = typeof settings.model === 'string' ? settings.model.trim() : '';
    if (!IMAGE_MODELS.some(entry => entry.id === model)) throw new Error('Choose an image model from the curated LiteRouter list.');
    const payload = { prompt, model, width: settings.width, height: settings.height };
    if (settings.seed !== '' && settings.seed !== undefined) {
        const seed = Number(settings.seed);
        if (!/^\d+$/.test(String(settings.seed)) || !Number.isSafeInteger(seed) || seed > 4294967295) throw new Error('Seed must be blank or a whole number from 0 to 4294967295.');
        payload.seed = seed;
    }
    return payload;
}

export function normalizeModels(payload) {
    const list = Array.isArray(payload) ? payload : payload?.models ?? payload?.data;
    const rows = Array.isArray(list) ? list : list && typeof list === 'object' ? Object.entries(list).map(([id, value]) => ({ ...value, id })) : [];
    return [...new Set(rows.map(row => typeof row === 'string' ? row : row?.id ?? row?.name ?? row?.model).filter(id => typeof id === 'string' && id.trim()))];
}
