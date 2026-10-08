import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE, normalizeSettings } from '../core.js';
import { AutoScheduler, GenerationRuntime, PROVIDERS } from '../runtime.js';

function fixture(overrides = {}) {
    let settings = normalizeSettings(overrides);
    let current = {
        chatId: 'chat-a', characterId: 0, name1: 'User', name2: 'Mira', chat: [], chatMetadata: {},
        characters: [{ description: 'A mage' }], extensionSettings: { connectionManager: { selectedProfile: 'profile-1', profiles: [{ id: 'profile-1', api: 'custom', 'api-url': 'https://api.literouter.com/v1', 'secret-id': 'saved-key-id' }] } },
        substituteParams: (text, options = {}) => text.replace(/{{(.*?)}}/g, (_, key) => options.dynamicMacros?.[key] ?? `{{${key}}}`),
        substituteParamsExtended(text, macros) { return this.substituteParams(text, { dynamicMacros: macros }); },
        getRequestHeaders: () => ({}),
    };
    return { context: () => current, settings: () => settings, switchChat: () => { current = { ...current, chatId: 'chat-b', chat: [], chatMetadata: {} }; }, replaceSettings: value => { settings = normalizeSettings(value); } };
}

function schedulerFixture(overrides = {}) {
    const f = fixture({ auto: { enabled: true, every: 3, role: 'assistant', cooldownSeconds: 30 }, ...overrides });
    let calls = 0;
    let busy = false;
    let next = null;
    let time = 100000;
    const scheduler = new AutoScheduler({
        ...f, generate: async () => { calls++; }, busy: () => busy, saveMetadata: () => {},
        now: () => time, setTimer: (fn, delay) => { next = { fn, delay }; return 1; }, clearTimer: () => { next = null; },
    });
    const message = (name = 'Mira', is_user = false, type) => {
        const index = f.context().chat.push({ name, is_user, mes: 'A new scene' }) - 1;
        scheduler.observe(index, type);
        return index;
    };
    return { ...f, scheduler, message, calls: () => calls, next: () => next, setBusy: value => { busy = value; }, setTime: value => { time = value; } };
}

test('automation counts roles, ignores duplicate events and triggers on the requested interval', async () => {
    const f = schedulerFixture();
    f.message('User', true);
    const index = f.message();
    f.scheduler.observe(index);
    f.message();
    assert.equal(f.scheduler.state().count, 2);
    assert.equal(f.calls(), 0);
    f.message();
    assert.equal(f.scheduler.state().count, 0);
    assert.equal(f.scheduler.pending, true);
    assert.equal(f.next().delay, 650);
    await f.scheduler.flush();
    assert.equal(f.calls(), 1);
});

test('user and exact-name rules work independently of unrelated bot messages', async () => {
    const f = schedulerFixture({ auto: { enabled: true, every: 2, role: 'user', names: 'Zephyr' } });
    f.message('Other', true);
    f.message('Zephyr', false);
    f.message('zephyr', true);
    assert.equal(f.scheduler.state().count, 1);
    f.message('Zephyr', true);
    await f.scheduler.flush();
    assert.equal(f.calls(), 1);
});

test('automation starts from new messages; greeting, swipe and generated messages do not count', () => {
    const f = schedulerFixture();
    const existing = f.message();
    f.scheduler.reset();
    f.scheduler.observe(existing);
    for (const type of ['extension', 'first_message', 'swipe', 'continue', 'regenerate', 'quiet']) f.message('Mira', false, type);
    f.context().chat.push({ name: 'ImageGen+', mes: 'image', is_system: true, extra: { [MODULE]: {} } });
    f.scheduler.observe(f.context().chat.length - 1);
    assert.equal(f.scheduler.state().count, 1);
});

test('foreground generation and provider work delay automatic requests, then coalesce triggers', async () => {
    const f = schedulerFixture({ auto: { enabled: true, every: 1, role: 'assistant' } });
    f.scheduler.setChatBusy(true);
    for (let i = 0; i < 4; i++) f.message();
    assert.equal(f.next(), null);
    await f.scheduler.flush();
    assert.equal(f.calls(), 0);
    f.scheduler.setChatBusy(false);
    assert(f.next());
    f.setBusy(true);
    await f.scheduler.flush();
    assert.equal(f.calls(), 0);
    f.setBusy(false);
    await f.scheduler.flush();
    assert.equal(f.calls(), 1);
    assert.equal(f.scheduler.pending, false);
});

test('cooldown delays subsequent requests and changing chats drops pending work', async () => {
    const f = schedulerFixture({ auto: { enabled: true, every: 1, role: 'assistant', cooldownSeconds: 30 } });
    f.message();
    await f.scheduler.flush();
    f.message();
    assert.equal(f.next().delay, 30000);
    f.switchChat();
    f.scheduler.reset();
    await f.scheduler.flush();
    assert.equal(f.calls(), 1);
    assert.equal(f.scheduler.state().count, 0);
});

test('automatic group images wait for the entire group turn, including gaps between member replies', async () => {
    const f = schedulerFixture({ auto: { enabled: true, every: 1, role: 'assistant' } });
    f.scheduler.setGroupBusy(true);
    f.scheduler.setChatBusy(true);
    f.message();
    f.scheduler.setChatBusy(false);
    await f.scheduler.flush();
    assert.equal(f.calls(), 0);
    f.scheduler.setGroupBusy(false);
    await f.scheduler.flush();
    assert.equal(f.calls(), 1);
});

test('saved per-chat counts survive scheduler recreation and rule changes reset them', () => {
    const f = schedulerFixture();
    f.message();
    f.message();
    const reloaded = new AutoScheduler({ ...f, generate: async () => {}, busy: () => false, saveMetadata: () => {} });
    assert.equal(reloaded.state().count, 2);
    f.replaceSettings({ auto: { enabled: true, every: 5, role: 'user' } });
    assert.equal(reloaded.state().count, 0);
    reloaded.stop();
});

test('failures pause automation without retrying and resume permits later messages', async () => {
    const f = schedulerFixture({ auto: { enabled: true, every: 1, role: 'assistant' } });
    f.scheduler.generate = async () => { throw new Error('Rate limit'); };
    f.message();
    await f.scheduler.flush();
    assert.equal(f.scheduler.paused, 'Rate limit');
    assert.equal(f.next(), null);
    f.scheduler.generate = async () => {};
    f.scheduler.resume();
    assert.equal(f.next(), null);
    f.message();
    assert(f.next());
    f.scheduler.stop();
});

test('disabled automation never queues or generates work', async () => {
    const f = schedulerFixture({ auto: { enabled: false } });
    for (let i = 0; i < 10; i++) f.message();
    await f.scheduler.flush();
    assert.equal(f.calls(), 0);
    assert.equal(f.next(), null);
});

function runtimeFixture(options = {}) {
    const f = fixture(options.settings);
    let saved = 0;
    let published = 0;
    let payload;
    f.context().ConnectionManagerRequestService = {
        constructPrompt: (messages, profile) => { assert.equal(profile, 'profile-1'); return messages; },
        sendRequest: async (profile, messages, maxTokens, custom) => {
            assert.equal(profile, 'profile-1');
            assert.equal(custom.stream, false);
            assert.equal(custom.includePreset, true);
            assert(custom.signal);
            if (options.write) return options.write();
            return { content: '<think>hidden</think>A silver-haired mage in a tavern' };
        },
    };
    const providerId = 'test-provider';
    PROVIDERS.set(providerId, {
        generate: async (prompt, params) => { payload = { prompt, params }; if (options.provider) await options.provider(); return { blob: new Blob(['image']), model: 'test-model', seed: Object.hasOwn(options, 'responseSeed') ? options.responseSeed : '99', format: 'jpg' }; },
    });
    const runtime = new GenerationRuntime({
        ...f, settings: () => ({ ...f.settings(), provider: providerId }),
        apiKey: () => options.apiKey ?? '',
        saveImage: async () => { saved++; if (options.save) await options.save(); return '/image.jpg'; },
        publishImage: async () => { published++; },
    });
    return { ...f, runtime, saved: () => saved, published: () => published, payload: () => payload };
}

test('prompt-only generation writes through the chosen profile without requesting or saving an image', async () => {
    const f = runtimeFixture();
    const result = await f.runtime.run('prompt');
    assert.equal(result.draft, 'A silver-haired mage in a tavern');
    assert.equal(f.payload(), undefined);
    assert.equal(f.saved(), 0);
    assert.equal(f.runtime.busy, false);
});

test('a saved Text Completion profile receives its native instruct-formatted prompt', async () => {
    const f = runtimeFixture({ settings: { profileId: 'text-profile' } });
    const originalProfile = f.context().extensionSettings.connectionManager.selectedProfile;
    let usedProfile;
    f.context().ConnectionManagerRequestService = {
        constructPrompt: (messages, profileId) => {
            usedProfile = profileId;
            return `[SYSTEM]${messages[0].content}[USER]${messages[1].content}[ASSISTANT]`;
        },
        sendRequest: async (profileId, prompt) => {
            assert.equal(profileId, 'text-profile');
            assert.equal(typeof prompt, 'string');
            assert(prompt.startsWith('[SYSTEM]'));
            return { content: 'A scene from a text model' };
        },
    };
    const result = await f.runtime.run('prompt');
    assert.equal(result.draft, 'A scene from a text model');
    assert.equal(usedProfile, 'text-profile');
    assert.equal(f.context().extensionSettings.connectionManager.selectedProfile, originalProfile);
});

test('scene generation composes fixed additions once, saves image and records reproducible options', async () => {
    const f = runtimeFixture({ settings: { prefix: 'masterpiece', suffix: 'soft lighting' } });
    const result = await f.runtime.run('scene', { auto: true });
    assert.equal(f.payload().prompt, 'masterpiece, A silver-haired mage in a tavern, soft lighting');
    assert.equal(f.saved(), 1);
    assert.equal(f.published(), 1);
    assert.equal(result.automatic, true);
    assert.equal(result.settings.seed, '99');
    assert.equal(f.payload().params.profile['secret-id'], 'saved-key-id');
    assert.equal(Object.hasOwn(f.payload().params, 'key'), false);
});

test('image generation uses its chosen LiteRouter profile without switching the prompt writer or active profile', async () => {
    const f = runtimeFixture({ settings: { imageProfileId: 'image-profile' } });
    f.context().extensionSettings.connectionManager.profiles.push({ id: 'image-profile', api: 'custom', 'api-url': 'https://api.literouter.com/v1/', 'secret-id': 'image-secret' });
    await f.runtime.run('scene');
    assert.equal(f.payload().params.profile.id, 'image-profile');
    assert.equal(f.payload().params.profile['secret-id'], 'image-secret');
    assert.equal(f.context().extensionSettings.connectionManager.selectedProfile, 'profile-1');
});

test('an unrelated connection profile is rejected before image generation', async () => {
    const f = runtimeFixture({ settings: { imageProfileId: 'wrong-profile' } });
    f.context().extensionSettings.connectionManager.profiles.push({ id: 'wrong-profile', api: 'custom', 'api-url': 'https://another-provider.test/v1' });
    await assert.rejects(() => f.runtime.run('image', { draft: 'A scene' }), /saved Custom.*connection profile/);
    assert.equal(f.payload(), undefined);
});

test('repeat requests retain exact prompt and original draft without reapplying additions', async () => {
    const f = runtimeFixture({ settings: { prefix: 'NEW PREFIX' } });
    const result = await f.runtime.run('image', { draft: 'unrelated draft', exact: { prompt: 'original prefix, old draft', draft: 'old draft', settings: { provider: 'test-provider', width: 768, height: 1024, seed: '42' } } });
    assert.equal(f.payload().prompt, 'original prefix, old draft');
    assert.equal(f.payload().params.settings.seed, '42');
    assert.equal(result.draft, 'old draft');
});

test('chat switching during prompt writing prevents image requests', async () => {
    let f;
    f = runtimeFixture({ write: () => { f.switchChat(); return { content: 'A scene' }; } });
    await assert.rejects(() => f.runtime.run('scene'), { name: 'AbortError' });
    assert.equal(f.payload(), undefined);
    assert.equal(f.saved(), 0);
});

test('chat switching during provider generation prevents saves and publishing', async () => {
    let f;
    f = runtimeFixture({ provider: () => f.switchChat() });
    await assert.rejects(() => f.runtime.run('image', { draft: 'A scene' }), { name: 'AbortError' });
    assert.equal(f.saved(), 0);
    assert.equal(f.published(), 0);
});

test('chat switching during an image upload prevents insertion into another chat', async () => {
    let f;
    f = runtimeFixture({ save: () => f.switchChat() });
    await assert.rejects(() => f.runtime.run('image', { draft: 'A scene' }), { name: 'AbortError' });
    assert.equal(f.saved(), 1);
    assert.equal(f.published(), 0);
});

test('cancellation suppresses image saving and always clears busy state', async () => {
    let f;
    f = runtimeFixture({ provider: () => f.runtime.cancel() });
    await assert.rejects(() => f.runtime.run('image', { draft: 'A scene' }), { name: 'AbortError' });
    assert.equal(f.saved(), 0);
    assert.equal(f.runtime.busy, false);
});

test('concurrent requests are rejected instead of duplicated', async () => {
    let release;
    const f = runtimeFixture({ provider: () => new Promise(resolve => { release = resolve; }) });
    const request = f.runtime.run('image', { draft: 'A scene' });
    await assert.rejects(() => f.runtime.run('image', { draft: 'Another' }), /already running/);
    release();
    await request;
    assert.equal(f.saved(), 1);
});

test('manual generation works without saved image profiles and never stores the key in image results', async () => {
    const f = runtimeFixture({ settings: { imageConnection: 'manual', finalTemplate: 'quality\n{{ig_prompt}}\nlighting' }, apiKey: 'manual-private-key' });
    f.context().extensionSettings.connectionManager.profiles = [];
    const result = await f.runtime.run('image', { draft: 'A moonlit lake' });
    assert.equal(f.payload().params.profile, null);
    assert.equal(f.payload().params.apiKey, 'manual-private-key');
    assert.equal(f.payload().prompt, 'quality\nA moonlit lake\nlighting');
    assert.equal(JSON.stringify(result).includes('manual-private-key'), false);
    assert.equal(JSON.stringify(f.settings()).includes('manual-private-key'), false);
    assert.equal(f.saved(), 1);
});

test('missing manual credentials prevent scene-writing costs but do not prevent prompt-only drafting', async () => {
    let writes = 0;
    const f = runtimeFixture({ settings: { imageConnection: 'manual' }, write: () => { writes++; return 'A scene'; } });
    await assert.rejects(() => f.runtime.run('scene'), /Enter your LiteRouter API key/);
    assert.equal(writes, 0);
    assert.equal(f.runtime.busy, false);
    const result = await f.runtime.run('prompt');
    assert.equal(result.draft, 'A scene');
    assert.equal(writes, 1);
    assert.equal(f.payload(), undefined);
});

test('studio options affect only their request and leave saved defaults and later generations unchanged', async () => {
    const f = runtimeFixture();
    const defaults = structuredClone(f.settings());
    const imageOptions = { model: 'proteus', width: 768, height: 1024, seed: '42', imageConnection: 'manual', timeoutSeconds: 600 };
    const result = await f.runtime.run('image', { draft: 'A scene', imageOptions });
    assert.equal(f.payload().params.settings.model, 'proteus');
    assert.equal(f.payload().params.settings.width, 768);
    assert.equal(f.payload().params.settings.seed, '42');
    assert.equal(f.payload().params.settings.imageConnection, 'profile');
    assert.equal(f.payload().params.settings.timeoutSeconds, defaults.timeoutSeconds);
    assert.equal(result.settings.width, 768);
    assert.deepEqual(f.settings(), defaults);
    await f.runtime.run('image', { draft: 'Another scene' });
    assert.equal(f.payload().params.settings.model, defaults.model);
    assert.equal(f.payload().params.settings.width, defaults.width);
    assert.equal(f.payload().params.settings.seed, defaults.seed);
});

test('invalid temporary image options fail before prompt writing or provider requests', async () => {
    let writes = 0;
    const f = runtimeFixture({ write: () => { writes++; return 'A scene'; } });
    for (const imageOptions of [{ width: 0 }, { width: NaN }, { model: 'text-model' }, { seed: '-1' }]) await assert.rejects(() => f.runtime.run('scene', { imageOptions }));
    assert.equal(writes, 0);
    assert.equal(f.payload(), undefined);
    assert.equal(f.runtime.busy, false);
});

test('fixed studio seeds remain available for preview and repeat when the native proxy omits response metadata', async () => {
    const f = runtimeFixture({ responseSeed: null });
    const result = await f.runtime.run('image', { draft: 'A scene', imageOptions: { seed: '0' } });
    assert.equal(result.seed, '0');
    assert.equal(result.settings.seed, '0');
    const random = await f.runtime.run('image', { draft: 'Another scene', imageOptions: { seed: '' } });
    assert.equal(random.seed, null);
});
