# ImageGen+

Turn your SillyTavern conversations into images with editable AI-written prompts, flexible automatic generation, and LiteRouter image generation.

**Version 1.0.0 · Author: ZephyrThePink · MIT license**

## Features

- **Image studio:** write your own prompt, ask an AI to draft one, or illustrate the latest scene in one click. Preview the final prompt before submitting it.
- **LiteRouter image generation:** model discovery, manual model IDs, square/portrait/landscape sizes, optional fixed seeds, timeouts and cancellation. The provider interface is separate from prompt writing and automation to support future providers.
- **Intelligent prompt writing:** use a saved SillyTavern Connection Manager profile, including chat and text completion profiles. Your active chat connection is not switched.
- **Choose your sources:** recent conversation, character description, user/persona description, scenario, personality and example dialogue. Limit message count and source length. Group chats use SillyTavern's current character-card resolution.
- **Custom templates:** native SillyTavern macros and extension source macros. Preview the exact instructions and scene input sent to your prompt writer.
- **Style presets:** cinematic, illustration tags, anime and photographic, plus your own instructions and things to exclude.
- **Always include:** prepend or append fixed tags, descriptions or macros to both manual and AI-written prompts.
- **Optional automatic images:** every N bot, user or combined messages, with optional exact speaker names. Automatic generation is off by default.
- **Chat integration:** images are saved to SillyTavern's image folder and inserted as image messages. Reopen the studio to download the latest image, reuse its prompt or repeat its request.
- **Theme-aware UI:** compact cards and collapsible settings matching Live2D+ and LiteRouter Tracker, with responsive mobile layouts.
- **Portable settings:** export/import configuration without credentials or conversation data.

## Installation

Requires **SillyTavern 1.19.0 or newer**. Intelligent prompt writing requires Connection Manager to be enabled and a supported saved connection profile. Manual prompts do not need a text-generation profile. No Extras service, npm installation or additional server plugin is required.

1. Open **Extensions → Install extension**.
2. Paste `https://github.com/zephyrthepink/imagegen-plus` and install.
3. Reload SillyTavern and open **Extensions → ImageGen+**.
4. Enter a LiteRouter API key under **Connection**.
5. Open **Prompt writer** and choose a saved connection profile, or follow the profile selected in Connection Manager.
6. Open a chat, then select **Open image studio** or **ImageGen+ studio** from the chat's wand menu.

The API key stays in memory until the page closes/reloads unless you explicitly enable **Remember API key in my SillyTavern settings**. Remembered keys are stored unencrypted in SillyTavern account storage, alongside account settings. **Forget key** clears both the in-memory key and its stored copy. Configuration exports never contain credentials.

## Image studio

- **Write prompt** drafts a prompt from your configured sources and optional scene direction. Edit it before pressing **Generate image**.
- **Illustrate scene** writes a prompt and immediately generates an image.
- **Generate image** submits the editable draft with your fixed additions.
- **Repeat image** resubmits the last image's exact final prompt, model, dimensions and known seed. It does not reapply additions or rewrite the prompt. Provider/model changes can still affect reproducibility. If the seed was not exposed, the repeated request remains random.
- **Reuse prompt** copies the last image's draft into the editor for a variation.
- **Cancel request** stops the extension's current request. Closing the studio leaves an in-progress request running; switching chats or disabling ImageGen+ cancels it.

The latest image's prompt, model, dimensions, timestamp and any exposed seed/request ID are retained in its chat message metadata. The studio's latest-image preview is specific to each chat and survives reopening. Images are system messages so their prompts do not feed back into the conversation. Generated images and system messages are also excluded from the prompt writer's history.

### Slash command

```text
/igplus
/igplus a moonlit mountain lake with mist over the water
```

With no argument, `/igplus` illustrates the current scene using the prompt writer. With text, it generates directly from that text, adding your configured prefix/suffix. Returns the saved image URL into the STscript pipe.

## Sources, templates and style

In **Build from selected sources** mode, selected fields are assembled automatically. The source character budget is divided equally among populated sources. Character fields keep their beginning; history keeps its newest portion. Inline HTML and closed reasoning blocks are removed from selected sources. The source budget is measured in characters; the prompt writer's response limit is measured in tokens.

In **Use my custom template** mode, your template replaces the assembled input. These additional macros use your selected, bounded sources:

| Macro | Source |
| --- | --- |
| `{{ig_history}}` | Recent conversation |
| `{{ig_character}}` | Character description |
| `{{ig_persona}}` | User/persona description |
| `{{ig_scenario}}` | Scenario |
| `{{ig_personality}}` | Character personality |
| `{{ig_examples}}` | Example dialogue |

Native macros such as `{{char}}`, `{{user}}`, `{{description}}` and STscript variable macros are expanded by SillyTavern. Native macros can include information independently of the source checkboxes and character budget; preview the input if you use them. Native macros also work in writer instructions, scene direction and fixed prompt additions.

Style presets are starting instructions, supplemented by **Your instructions**. Choose **My own instructions** to provide your entire style guide. **Things to exclude** guides the text model; it does not send a negative-prompt field to LiteRouter, whose documented API has no such parameter. Exclusions cannot guarantee what the image model produces.

## Automatic generation

Automatic images are **off by default**. Configure **Automatic images** and turn the feature on when ready. Each image uses one prompt-writing request and one image-generation request.

| Example | Every N | Count messages from | Speaker names |
| --- | --- | --- | --- |
| Every three bot messages | 3 | Bots | blank |
| Every two user messages | 2 | User | blank |
| Each message from The Storymaker | 1 | Bots | `The Storymaker` |

Use one exact name per line; names are case-insensitive. The role and name filters both apply. Counters are saved per chat and count only new matching conversation messages after enabling the feature. Existing history, greetings, system/image messages, duplicate events, swipes, regenerated replies and continuations do not count. Changing the interval, role or speaker filter resets that chat's counter. Disabling/re-enabling automatic images preserves progress for the same rule; use **Reset this chat's counter** to start over.

Generation waits until the foreground chat reply finishes. While a request is running or the cooldown is active, triggers combine into one pending request for the latest scene. Errors and cancellations pause automation for that session; correct the issue, then press **Resume automatic images**. There are no automatic retries of failed paid requests. Imports turn automation off until you explicitly enable it.

## LiteRouter integration

Implemented against [LiteRouter's image generation documentation](https://docs.literouter.com/image-generation):

- Host: `https://image.literouter.com` (separate from the chat API).
- Models: authenticated `GET /models`.
- Images: authenticated `POST /generate` with `prompt`, `model`, `width`, `height`, and optional `seed`.
- Result: binary JPEG, saved through SillyTavern's native image upload API.
- Optional response headers: `X-Model`, `X-Seed`, `X-Request-ID`. Browsers may not expose these headers; the UI indicates when a random seed is unavailable.

Direct browser requests are the default. If blocked by your network/browser, choose **SillyTavern CORS proxy**, set `enableCorsProxy: true` in SillyTavern's `config.yaml` and restart the server. The extension never falls back or retries a generation automatically, avoiding duplicate requests.

If model refresh fails, enter a supported model ID manually. The documented default is `sdxl-turbo`. Dimensions from 256 to 2048 and nonnegative 32-bit seeds are accepted by the extension; the selected provider/model may impose narrower limits. HTTP errors, invalid image responses and timeouts are surfaced in the UI.

## Development

The extension is plain JavaScript ES modules and can be installed directly from this repository. No build step or runtime dependencies.

```sh
npm run check
npm test
```

`core.js` handles settings, sources, macros and prompt composition. `runtime.js` handles requests, chat ownership, cancellation and scheduling. `providers/literouter.js` implements the provider contract. `index.js`, `settings.html`, `studio.html` and `style.css` provide SillyTavern integration and UI.

Built using the [SillyTavern extension example](https://github.com/city-unit/st-extension-example) as the manifest/settings entry-point reference, and local SillyTavern source as the API reference. The implementation uses native Connection Manager, macro, chat-event, popup, image-upload and settings APIs.

Report issues and suggest improvements through [GitHub Issues](https://github.com/zephyrthepink/imagegen-plus/issues).
