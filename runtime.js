import { MODULE, PROMPT_MAX_TOKENS, applyImageOptions, buildPromptRequest, chatKey, cleanPromptResponse, composeFinalPrompt, expandMacros, matchesRule, ruleSignature } from './core.js';
import { resolveImageProfile } from './server/shared.mjs';
import { liteRouter } from './providers/literouter.js';

export const PROVIDERS = new Map([[liteRouter.id, liteRouter]]);

export class GenerationRuntime {
    constructor({ context, settings, apiKey = () => '', saveImage, publishImage, onState = () => {} }) {
        Object.assign(this, { context, settings, apiKey, saveImage, publishImage, onState });
        this.controller = null;
        this.phase = 'idle';
        this.lastResult = null;
    }
    get busy() { return this.controller !== null; }
    cancel() { this.controller?.abort(new DOMException('Generation cancelled', 'AbortError')); }
    assertCurrent(origin, signal) {
        signal.throwIfAborted();
        const current = this.context();
        if (chatKey(current) !== chatKey(origin) || current.chat !== origin.chat) throw new DOMException('Chat changed', 'AbortError');
    }
    async run(kind, { draft = '', focus = '', auto = false, exact = null, imageOptions = {} } = {}) {
        if (this.busy) throw new Error('A UIGE request is already running.');
        const settings = structuredClone(this.settings());
        if (!settings.enabled) throw new Error('Enable UIGE first.');
        const imageSettings = exact ? { ...settings, ...exact.settings } : kind === 'prompt' ? settings : applyImageOptions(settings, imageOptions);
        const origin = this.context();
        if (!chatKey(origin)) throw new Error('Open a character or group chat first.');
        const imageProfile = kind !== 'prompt' && settings.imageConnection === 'profile' ? resolveImageProfile(origin, settings.imageProfileId) : null;
        const apiKey = kind !== 'prompt' && settings.imageConnection === 'manual' ? this.apiKey().trim() : '';
        if (kind !== 'prompt' && settings.imageConnection === 'manual' && !apiKey) throw new Error('Enter your LiteRouter API key in Connection settings.');
        const controller = new AbortController();
        this.controller = controller;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(settings.timeoutSeconds * 1000)]);
        const phase = name => { this.phase = name; this.onState(); };
        try {
            let written = exact?.draft ?? draft;
            if (kind === 'prompt' || kind === 'scene') {
                phase('Writing prompt…');
                const service = origin.ConnectionManagerRequestService;
                const profileId = settings.profileId || origin.extensionSettings.connectionManager?.selectedProfile;
                if (!service || !profileId) throw new Error('Select a saved connection profile in Prompt writer settings.');
                if (origin.groupId) await origin.unshallowGroupMembers?.(origin.groupId);
                else if (origin.characterId !== undefined) await origin.unshallowCharacter?.(origin.characterId);
                this.assertCurrent(origin, signal);
                const messages = buildPromptRequest(origin, settings, focus);
                // constructPrompt preserves the instruct format for Text Completion profiles.
                const prompt = service.constructPrompt(messages, profileId);
                const response = await service.sendRequest(profileId, prompt, PROMPT_MAX_TOKENS, { stream: false, extractData: true, includePreset: true, includeInstruct: true, signal });
                this.assertCurrent(origin, signal);
                written = cleanPromptResponse(response);
                if (kind === 'prompt') return { draft: written };
            }
            phase('Generating image…');
            const prompt = exact?.prompt ?? composeFinalPrompt(written, settings, (text, macros) => expandMacros(origin, text, macros));
            const provider = PROVIDERS.get(imageSettings.provider);
            if (!provider) throw new Error('This image provider is not available.');
            const image = await provider.generate(prompt, { profile: imageProfile, apiKey, settings: imageSettings, signal, headers: origin.getRequestHeaders() });
            this.assertCurrent(origin, signal);
            phase('Saving image…');
            const url = await this.saveImage(image, origin);
            this.assertCurrent(origin, signal);
            const result = {
                url, prompt, draft: written, model: image.model,
                seed: image.seed ?? (imageSettings.seed === '' || imageSettings.seed == null ? null : String(imageSettings.seed)),
                requestId: image.requestId, transport: image.transport,
                createdAt: new Date().toISOString(), automatic: auto,
                settings: { provider: imageSettings.provider, model: imageSettings.model, width: imageSettings.width, height: imageSettings.height, seed: image.seed ?? imageSettings.seed },
            };
            await this.publishImage(result, origin);
            this.lastResult = result;
            return result;
        } finally {
            this.controller = null;
            phase('idle');
        }
    }
}

export class AutoScheduler {
    constructor({ context, settings, generate, busy, saveMetadata, onState = () => {}, now = Date.now, setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer) }) {
        Object.assign(this, { context, settings, generate, busy, saveMetadata, onState, now, setTimer, clearTimer });
        this.timer = null;
        this.epoch = 0;
        this.running = false;
        this.chatBusy = false;
        this.groupBusy = false;
        this.reset();
    }
    reset() {
        this.epoch++;
        this.clearTimer(this.timer);
        this.timer = null;
        this.pending = false;
        this.paused = '';
        this.lastStarted = -Infinity;
        this.key = chatKey(this.context());
        this.seen = new WeakSet(this.context().chat ?? []);
        this.state();
        this.onState();
    }
    state() {
        const context = this.context();
        const metadata = context.chatMetadata ?? {};
        const signature = ruleSignature(this.settings().auto);
        const stored = metadata[MODULE]?.auto;
        if (!stored || stored.signature !== signature || !Number.isInteger(stored.count) || stored.count < 0 || stored.count >= this.settings().auto.every) {
            metadata[MODULE] ??= {};
            metadata[MODULE].auto = { signature, count: 0 };
        }
        return metadata[MODULE].auto;
    }
    observe(index, type) {
        const context = this.context();
        if (chatKey(context) !== this.key) this.reset();
        const message = context.chat?.[Number(index)];
        if (!message || this.seen.has(message)) return;
        this.seen.add(message);
        const settings = this.settings();
        if (!settings.enabled || !settings.auto.enabled || !this.key || ['extension', 'first_message', 'swipe', 'regenerate', 'continue', 'quiet'].includes(type) || !matchesRule(message, settings.auto)) return;
        const state = this.state();
        state.count++;
        if (state.count >= settings.auto.every) { state.count = 0; this.pending = true; }
        this.saveMetadata();
        this.onState();
        this.schedule();
    }
    schedule() {
        this.clearTimer(this.timer);
        this.timer = null;
        if (!this.pending || this.paused || this.running || this.chatBusy || this.groupBusy || this.busy()) return;
        const delay = Math.max(650, this.lastStarted + this.settings().auto.cooldownSeconds * 1000 - this.now());
        this.timer = this.setTimer(() => { this.timer = null; void this.flush(); }, delay);
    }
    async flush() {
        const settings = this.settings();
        if (!settings.enabled || !settings.auto.enabled) { this.pending = false; return; }
        if (!this.pending || this.paused || this.chatBusy || this.groupBusy || this.running || this.busy()) return;
        if (chatKey(this.context()) !== this.key) { this.reset(); return; }
        const epoch = this.epoch;
        this.pending = false;
        this.running = true;
        this.lastStarted = this.now();
        try { await this.generate(); }
        catch (error) {
            if (epoch === this.epoch) { this.paused = error.name === 'AbortError' ? 'Automatic generation was cancelled.' : error.message; this.pending = false; }
        } finally {
            this.running = false;
            this.onState();
            this.schedule();
        }
    }
    resume() { this.paused = ''; this.onState(); this.schedule(); }
    setChatBusy(value) { this.chatBusy = value; this.schedule(); }
    setGroupBusy(value) { this.groupBusy = value; this.schedule(); }
    stop() { this.pending = false; this.clearTimer(this.timer); this.timer = null; }
}
