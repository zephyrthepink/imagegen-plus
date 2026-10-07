# ImageGen+

Turn your SillyTavern conversations into images with editable AI-written prompts, flexible automatic generation, and LiteRouter image generation.

**Version 1.0.1 · Author: ZephyrThePink · MIT license**

## Features

- **Image studio:** write your own prompt, ask an AI to draft one, or illustrate the latest scene in one click. Preview the final prompt before submitting it.
- **LiteRouter image generation:** reuse a saved LiteRouter connection profile, select from 23 curated image models, refresh availability, choose square/portrait/landscape sizes, set optional seeds and cancel requests.
- **Intelligent prompt writing:** use a saved SillyTavern Connection Manager profile, including chat and text completion profiles. Your active chat connection is not switched.
- **Choose your sources:** recent conversation, character description, user/persona description, scenario, personality and example dialogue. Choose how many recent messages to include. Selected descriptions and messages are included in full. Group chats use SillyTavern's current character-card resolution.
- **Custom templates:** native SillyTavern macros and extension source macros. Preview the exact instructions and scene input sent to your prompt writer.
- **Style presets:** cinematic, illustration tags, anime and photographic, plus your own instructions and things to exclude.
- **Always include:** prepend or append fixed tags, descriptions or macros to both manual and AI-written prompts.
- **Optional automatic images:** every N bot, user or combined messages, with optional exact speaker names. Automatic generation is off by default.
- **Chat integration:** images are saved to SillyTavern's image folder and inserted as image messages. Reopen the studio to download the latest image, reuse its prompt or repeat its request.
- **Theme-aware UI:** compact cards and collapsible settings matching Live2D+ and LiteRouter Tracker, with responsive mobile layouts.
- **Portable settings:** export/import configuration without credentials or conversation data.

## Installation

Requires **SillyTavern 1.19.0 or newer**, Connection Manager, a saved LiteRouter Custom connection profile and the bundled **ImageGen+ profile bridge**. Intelligent prompt writing can use any supported saved chat/text completion profile. No Extras service or npm installation is needed.

1. Open **Extensions → Install extension**.
2. Paste `https://github.com/zephyrthepink/imagegen-plus` and install.
3. Reload SillyTavern and open **Extensions → ImageGen+**.
4. Download **ImageGenPlus-Server-Bridge.zip** from the [latest release](https://github.com/zephyrthepink/imagegen-plus/releases/latest), extract it into your SillyTavern root folder, set `enableServerPlugins: true` in `config.yaml`, and restart SillyTavern. This is a one-time setup; [manual installation details](server/README.md) are also available.
5. Under **Connection**, choose a saved **Custom (OpenAI-compatible)** profile using `https://api.literouter.com/v1`. Its existing saved credentials are reused for models and images. The profile's chat model is unchanged.
6. Open **Prompt writer** and choose the connection profile that writes your prompts. It can be different from the LiteRouter image connection.
7. Open a chat, then select **Open image studio** or **ImageGen+ studio** from the chat's wand menu.

The extension has no API-key entry or credential store. The bridge reads the authenticated user's saved Custom key using the profile's secret ID, matching native SillyTavern behavior. Keys stay on the server; enabling key exposure or the CORS proxy is unnecessary. Upgrading from 1.0.0 removes its obsolete stored credential copy. Configuration exports contain profile IDs, prompts and rules, but no keys or chat history.

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

In **Build from selected sources** mode, selected fields are assembled automatically. **Only include the last N conversation messages** controls history: choose 5, for example, to include the latest five conversation messages. Those messages and all selected description fields are included in full. Inline HTML and closed reasoning blocks are removed; there is no extension character truncation.

In **Use my custom template** mode, your template replaces the assembled input. These additional macros use your selected sources:

| Macro | Source |
| --- | --- |
| `{{ig_history}}` | Recent conversation |
| `{{ig_character}}` | Character description |
| `{{ig_persona}}` | User/persona description |
| `{{ig_scenario}}` | Scenario |
| `{{ig_personality}}` | Character personality |
| `{{ig_examples}}` | Example dialogue |

Native macros such as `{{char}}`, `{{user}}`, `{{description}}` and STscript variable macros are expanded by SillyTavern. Native macros can include information independently of the source checkboxes; preview the input if you use them. Native macros also work in writer instructions, scene direction and fixed prompt additions.

Style presets are starting instructions, supplemented by **Your instructions**. Choose **My own instructions** to provide your entire style guide. **Things to exclude** guides the text model; it does not send a negative-prompt field to LiteRouter, whose documented API has no such parameter. Exclusions cannot guarantee what the image model produces.

### What does “Always include” mean?

It adds fixed text to every image request, in this order:

**Beginning additions → editable prompt → ending additions**

For example, beginning additions `masterpiece, high_res`, draft `a mage in a tavern` and ending additions `accurate anatomy` produce:

```text
masterpiece, high_res, a mage in a tavern, accurate anatomy
```

Use the beginning field for tags or style cues you want up front, and the ending field for details you want appended. You can use either field, both, or neither. These are parts of the final image prompt, rather than instructions for the prompt-writing AI. The settings include a live example, and the studio previews the exact final prompt. Your editable draft keeps just the scene text, so fixed additions are applied once.

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
- Optional response headers: `X-Model`, `X-Seed`, `X-Request-ID`, forwarded by the bridge for reproducibility and debugging.

The browser sends the chosen profile's ID, Custom API source, endpoint and saved secret ID to the bridge. The authenticated user's account directories determine the key lookup. The bridge sends the key only to the fixed image host, never to a URL supplied by the browser. The extension never retries a generation automatically.

The model selector contains the 23 image models from the supplied LiteRouter catalog: `2dn-pony-v2`, `aniflatmix-anime`, `animagine-xl-31`, `artiwaifu-diffusion`, `atomix-xl`, `boltning`, `crystal-clear-xl-lightning`, `cyberrealistic-pony-v9`, `cyberrealistic-xl`, `dreamshaper-v1`, `dreamshaper-xl`, `fast-sdxl`, `fluently-xl`, `gen-illustrious`, `hassaku`, `hidream-i1-fast`, `p-image`, `persona`, `proteus`, `prunaai`, `realpony-xl`, `rev-animated` and `sdxl-turbo`. Plan and credit labels reflect that reference catalog. Refresh checks which curated IDs the image endpoint currently lists; it never adds chat models or removes your configured choice. Access depends on the account plan. The curated selector remains available if refresh fails.

The default is `sdxl-turbo`. Dimensions from 256 to 2048 and nonnegative 32-bit seeds are accepted by the extension; the selected provider/model may impose narrower limits. HTTP errors, invalid image responses and timeouts are surfaced in the UI.

## Development

The extension is plain JavaScript ES modules and can be installed directly from this repository. No build step or runtime dependencies.

```sh
npm run check
npm test
```

`core.js` handles settings, sources, macros and prompt composition. `runtime.js` handles requests, chat ownership, cancellation and scheduling. `providers/literouter.js` implements the browser provider contract. `server/` contains the profile bridge and shared catalog/validation functions. `index.js`, `settings.html`, `studio.html` and `style.css` provide SillyTavern integration and UI.

Built using the [SillyTavern extension example](https://github.com/city-unit/st-extension-example) as the manifest/settings entry-point reference, and local SillyTavern source as the API reference. The implementation uses native Connection Manager, macro, chat-event, popup, image-upload and settings APIs.

Report issues and suggest improvements through [GitHub Issues](https://github.com/zephyrthepink/imagegen-plus/issues).
