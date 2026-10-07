import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../core.js';
import { liteRouter, createImagePayload, normalizeModels } from '../providers/literouter.js';
import { IMAGE_MODELS, isLiteRouterProfile, imageProfiles, resolveImageProfile } from '../server/shared.mjs';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const profile = { id: 'image-profile', api: 'custom', 'api-url': 'https://api.literouter.com/v1', 'secret-id': 'saved-secret' };

test('curated list matches all 23 models in the supplied reference, including plan and cost labels', () => {
    assert.deepEqual(IMAGE_MODELS.map(model => model.id), [
        '2dn-pony-v2', 'aniflatmix-anime', 'animagine-xl-31', 'artiwaifu-diffusion', 'atomix-xl', 'boltning',
        'crystal-clear-xl-lightning', 'cyberrealistic-pony-v9', 'cyberrealistic-xl', 'dreamshaper-v1',
        'dreamshaper-xl', 'fast-sdxl', 'fluently-xl', 'gen-illustrious', 'hassaku', 'hidream-i1-fast',
        'p-image', 'persona', 'proteus', 'prunaai', 'realpony-xl', 'rev-animated', 'sdxl-turbo',
    ]);
    assert.equal(IMAGE_MODELS.find(model => model.id === 'rev-animated').cost, 20);
    assert.equal(IMAGE_MODELS.find(model => model.id === 'proteus').tier, 'Plus');
    assert.equal(IMAGE_MODELS.find(model => model.id === 'sdxl-turbo').cost, 15);
});

test('image profiles require the exact LiteRouter custom endpoint and reject unrelated or deceptive URLs', () => {
    assert.equal(isLiteRouterProfile(profile), true);
    assert.equal(isLiteRouterProfile({ ...profile, 'api-url': 'https://api.literouter.com/v1/' }), true);
    for (const url of ['http://api.literouter.com/v1', 'https://api.literouter.com.evil.test/v1', 'https://api.literouter.com/v1?target=other', 'https://username:password@api.literouter.com/v1', 'https://api.literouter.com/v1/chat/completions']) assert.equal(isLiteRouterProfile({ ...profile, 'api-url': url }), false);
    assert.equal(isLiteRouterProfile({ ...profile, api: 'openai' }), false);
    const context = { extensionSettings: { connectionManager: { selectedProfile: profile.id, profiles: [profile, { ...profile, id: 'other', 'api-url': 'https://other.test/v1' }] } } };
    assert.deepEqual(imageProfiles(context), [profile]);
    assert.deepEqual(resolveImageProfile(context), profile);
    assert.throws(() => resolveImageProfile(context, 'other'), /Choose a saved/);
});

test('image payload uses only documented fields and rejects unknown models', () => {
    const settings = normalizeSettings({ seed: '', exclusions: 'logos', prefix: 'high quality' });
    assert.deepEqual(createImagePayload('A lake', settings), { prompt: 'A lake', model: 'sdxl-turbo', width: 1024, height: 1024 });
    assert.equal(createImagePayload('A lake', { ...settings, seed: '0' }).seed, 0);
    assert.throws(() => createImagePayload('A lake', { ...settings, seed: '-1' }), /Seed/);
    assert.throws(() => createImagePayload('A lake', { ...settings, height: 50000 }), /height/);
    assert.throws(() => createImagePayload('A lake', { ...settings, model: 'unknown' }), /curated/);
});

test('the browser sends the selected profile and secret ID to the authenticated bridge, with no raw key', async () => {
    let actual;
    const image = await liteRouter.generate('A lake', {
        profile, settings: normalizeSettings(), headers: { 'X-CSRF-Token': 'local-csrf' },
        fetchFn: async (url, options) => { actual = { url, options }; return new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg', 'X-Model': 'sdxl-turbo', 'X-Seed': '123', 'X-Request-ID': 'request-1' } }); },
    });
    assert.equal(actual.url, '/api/plugins/imagegen-plus/generate');
    assert.equal(actual.options.headers.Authorization, undefined);
    assert.equal(actual.options.headers['X-CSRF-Token'], 'local-csrf');
    assert.equal(actual.options.method, 'POST');
    assert.deepEqual(JSON.parse(actual.options.body).profile, profile);
    assert.equal(image.blob.type, 'image/jpeg');
    assert.equal(image.seed, '123');
    assert.equal(image.requestId, 'request-1');
});

test('bridge errors are surfaced without retrying and missing bridges have setup instructions', async () => {
    let calls = 0;
    await assert.rejects(() => liteRouter.generate('A lake', {
        profile, settings: normalizeSettings(),
        fetchFn: async () => { calls++; return Response.json({ error: 'Rate limit reached.' }, { status: 429 }); },
    }), /Rate limit/);
    assert.equal(calls, 1);
    await assert.rejects(() => liteRouter.models({ profile, settings: normalizeSettings(), fetchFn: async () => new Response('not found', { status: 404 }) }), /Install the bundled/);
});

test('HTML, JSON, empty and invalid binary responses are rejected instead of saved', async () => {
    for (const body of ['<html>Cloudflare</html>', '{"error":"no image"}', '', new Uint8Array([1, 2, 3])]) {
        await assert.rejects(() => liteRouter.generate('A lake', { profile, settings: normalizeSettings(), fetchFn: async () => new Response(body) }), /instead of a JPEG/);
    }
});

test('cancellation preserves AbortError and missing profiles do not send requests', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => liteRouter.generate('A lake', {
        profile, settings: normalizeSettings(), signal: controller.signal,
        fetchFn: async (_, options) => { options.signal.throwIfAborted(); },
    }), { name: 'AbortError' });
    await assert.rejects(() => liteRouter.models({ settings: normalizeSettings(), fetchFn: () => assert.fail('must not send') }), /connection profile/);
});

test('model refresh annotates the curated list and never adds unrelated text models', async () => {
    assert.deepEqual(normalizeModels(['sdxl-turbo', 'sdxl-turbo']), ['sdxl-turbo']);
    assert.deepEqual(normalizeModels({ data: [{ id: 'model-a' }, { name: 'model-b' }] }), ['model-a', 'model-b']);
    assert.deepEqual(normalizeModels({ models: { 'model-a': { description: 'A model' } } }), ['model-a']);
    const models = await liteRouter.models({ profile, settings: normalizeSettings(), fetchFn: async () => Response.json({ models: ['sdxl-turbo', 'text-model'] }) });
    assert.equal(models.length, 23);
    assert.equal(models.find(model => model.id === 'sdxl-turbo').listed, true);
    assert.equal(models.some(model => model.id === 'text-model'), false);
});
