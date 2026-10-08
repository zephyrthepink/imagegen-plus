# UIGE — Unremarkable Image Generation Extension

Turn your SillyTavern conversations into images with editable AI-written prompts, flexible automatic generation, and LiteRouter image generation.

**Version 1.0.4 · Author: ZephyrThePink · MIT license**

## Features

- **Image studio:** organized prompt, generation and preview panels. Write your own prompt, ask an AI to draft one, or illustrate the latest scene in one click. Override model, size and seed for studio requests without changing saved defaults.
- **LiteRouter image generation:** reuse a saved LiteRouter connection profile or enter your own API key without installing a server plugin. Select from 23 curated image models, refresh availability, choose square/portrait/landscape sizes, set optional seeds and cancel requests.
- **Intelligent prompt writing:** use a saved SillyTavern Connection Manager profile, including chat and text completion profiles. Your active chat connection is not switched.
- **Choose your sources:** recent conversation, character description, user/persona description, scenario, personality and example dialogue. Choose how many recent messages to include. Selected descriptions and messages are included in full. Group chats use SillyTavern's current character-card resolution.
- **Custom templates:** native SillyTavern macros and extension source macros. Preview the exact instructions and scene input sent to your prompt writer.
- **Style presets:** cinematic, illustration tags, anime and photographic, plus your own instructions and things to exclude.
- **Always include:** arrange tags, descriptions and native macros around `{{ig_prompt}}` in a fully editable final prompt template. Works with manual and AI-written prompts.
- **Optional automatic images:** every N bot, user or combined messages, with optional exact speaker names. Automatic generation is off by default.
- **Chat integration:** every generated image adds a separate image message and file. Existing attachments are preserved. Browse earlier images in the studio to download, reuse or repeat them.
- **Theme-aware UI:** compact cards and collapsible settings matching Live2D+ and LiteRouter Tracker, with responsive mobile layouts.

## Installation

Requires **SillyTavern 1.19.0 or newer** and a LiteRouter account. Intelligent prompt writing uses Connection Manager and any supported saved chat/text completion profile. No Extras service or npm installation is needed. The bundled **UIGE profile bridge is optional**: install it only to reuse saved image credentials.

1. Open **Extensions → Install extension**.
2. Paste `https://github.com/zephyrthepink/imagegen-plus` and install.
3. Reload SillyTavern and open **Extensions → UIGE**.
4. Under **Connection → Connect for images using**, choose **Manual API key** or **Saved connection profile** using the setup below.
5. Open **Prompt writer** and choose the connection profile that writes your prompts. It can be different from the LiteRouter image connection.
6. Open a chat, then select **Open image studio** or **Image studio** from the chat's wand menu.

### Manual API key — no UIGE server plugin

Choose **Manual API key**, paste your LiteRouter key, and leave the transport on **Direct browser request**. The key is retained in SillyTavern's account storage across reloads. Press **Clear API key** to remove it explicitly. Requests use the fixed LiteRouter image host and never fetch a saved profile's key.

If your browser blocks cross-origin requests, choose **SillyTavern's built-in CORS proxy**, set `enableCorsProxy: true` in SillyTavern's `config.yaml`, and restart. This uses SillyTavern's existing proxy, with no UIGE server plugin. The proxy transport sends the manually entered key through your SillyTavern server to LiteRouter. Model refresh uses the selected transport as well.

SillyTavern Basic Auth and LiteRouter Bearer authentication share the Authorization header, so the native proxy cannot carry both. If SillyTavern returns its own `401` Basic challenge, UIGE falls back to a direct request with the same payload. This happens before the proxy contacts LiteRouter. Provider errors, including `402`, are shown with a redacted message and are not retried. If direct requests are also blocked, use the saved-profile bridge.

### Saved connection profile

Download **ImageGenPlus-Server-Bridge.zip** from the [latest release](https://github.com/zephyrthepink/imagegen-plus/releases/latest), extract it into your SillyTavern root folder, set `enableServerPlugins: true` in `config.yaml`, and restart. This is a one-time setup; [manual installation details](server/README.md) are also available.

Choose a saved **Custom (OpenAI-compatible)** profile using `https://api.literouter.com/v1`. Its existing saved credentials are reused for models and images. The profile's chat model is unchanged. The bridge reads the authenticated user's saved Custom key using the profile's secret ID, matching native SillyTavern behavior. Keys stay on the server; enabling key exposure or the CORS proxy is unnecessary.

Stored manual keys and settings are preserved when updating. Selecting manual credentials does not change how the prompt writer uses its connection profile. The installation URL and internal storage identifiers remain compatible with earlier ImageGen+ versions.

## Image studio

The **Generation** panel controls model, image size, custom width/height and seed for studio requests. These choices reset to your saved defaults when you reopen the studio or switch chats. They do not affect automatic images or slash commands. Image metadata retains the options used so exact repeats remain available.

- **Write prompt** drafts a prompt from your configured sources and optional scene direction. Edit it before pressing **Generate image**.
- **Illustrate scene** writes a prompt and immediately generates an image.
- **Generate image** submits the editable draft through your final prompt template.
- **Repeat image** resubmits the last image's exact final prompt, model, dimensions and known seed. It does not reapply additions or rewrite the prompt. Provider/model changes can still affect reproducibility. If the seed was not exposed, the repeated request remains random.
- **Reuse prompt** copies the last image's draft into the editor for a variation.
- **Cancel request** stops the extension's current request. Closing the studio leaves an in-progress request running; switching chats or disabling UIGE cancels it.

Each image's prompt, model, dimensions, timestamp and any exposed seed/request ID are retained in its own chat message metadata. The studio's image history is specific to each chat and survives reopening; select a thumbnail to view or reuse an earlier result. Each generation adds a new image without modifying existing messages or attachments. Images are system messages so their prompts do not feed back into the conversation. Generated images and system messages are also excluded from the prompt writer's history.

### Slash command

```text
/uige
/uige a moonlit mountain lake with mist over the water
```

With no argument, `/uige` illustrates the current scene using the prompt writer. With text, it generates directly from that text through your final prompt template. Returns the saved image URL into the STscript pipe. `/igplus` remains an alias for existing scripts.

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

Native macros such as `{{char}}`, `{{user}}`, `{{description}}` and STscript variable macros are expanded by SillyTavern. Native macros can include information independently of the source checkboxes; preview the input if you use them. Native macros also work in writer instructions, scene direction and the final prompt template.

Style presets are starting instructions, supplemented by **Your instructions**. Choose **My own instructions** to provide your entire style guide. **Things to exclude** guides the text model; it does not send a negative-prompt field to LiteRouter, whose documented API has no such parameter. Exclusions cannot guarantee what the image model produces.

### What does “Always include” mean?

It is an editable **Final image prompt template**. The request-local macro `{{ig_prompt}}` contains the AI-written draft including your edits, or the text you wrote manually. Place it anywhere, repeat it, add tags and descriptions, use line breaks, and combine it with native SillyTavern macros. Include `{{ig_prompt}}` at least once; omitting it produces an actionable error instead of generating an image that ignores your draft.

For example:

```text
masterpiece, high_res, {{ig_prompt}}, accurate anatomy
```

With the draft `a mage in a tavern`, this produces:

```text
masterpiece, high_res, a mage in a tavern, accurate anatomy
```

You could also put character information first and quality tags last:

```text
Character: {{char}}
{{ig_prompt}}
Style: soft lighting, masterpiece
```

The default `{{ig_prompt}}` adds nothing. Settings include a live example, and the studio previews the exact final prompt. The macro exists only during composition: it is not registered globally or stored in chat variables. Draft text is inserted literally, so macro-looking text returned by the AI does not execute native macros. Your template's native macros still expand normally. Your editable draft remains separate and the template is applied once. **Repeat image** keeps the original final prompt exactly.

Earlier beginning/end fields migrate into an equivalent template automatically.

## Automatic generation

Automatic images are **off by default**. Configure **Automatic images** and turn the feature on when ready. Each image uses one prompt-writing request and one image-generation request.

| Example | Every N | Count messages from | Speaker names |
| --- | --- | --- | --- |
| Every three bot messages | 3 | Bots | blank |
| Every two user messages | 2 | User | blank |
| Each message from The Storymaker | 1 | Bots | `The Storymaker` |

Use one exact name per line; names are case-insensitive. The role and name filters both apply. Counters are saved per chat and count only new matching conversation messages after enabling the feature. Existing history, greetings, system/image messages, duplicate events, swipes, regenerated replies and continuations do not count. Changing the interval, role or speaker filter resets that chat's counter. Disabling/re-enabling automatic images preserves progress for the same rule; use **Reset this chat's counter** to start over.

Generation waits until the foreground chat reply finishes. While a request is running or the cooldown is active, triggers combine into one pending request for the latest scene. Errors and cancellations pause automation for that session; correct the issue, then press **Resume automatic images**. There are no automatic retries of failed paid requests.

## LiteRouter integration

Implemented against [LiteRouter's image generation documentation](https://docs.literouter.com/image-generation):

- Host: `https://image.literouter.com` (separate from the chat API).
- Models: authenticated `GET /models`.
- Images: authenticated `POST /generate` with `prompt`, `model`, `width`, `height`, and optional `seed`.
- Result: binary JPEG, saved through SillyTavern's native image upload API.
- Optional response headers: `X-Model`, `X-Seed`, `X-Request-ID`, forwarded by the bridge for reproducibility and debugging.

In saved-profile mode, the browser sends the chosen profile's ID, Custom API source, endpoint and saved secret ID to the bridge. The authenticated user's account directories determine the key lookup. The bridge sends the key only to the fixed image host, never to a URL supplied by the browser. In manual mode, the browser sends the key in the Authorization header to the fixed image host directly or through SillyTavern's built-in proxy. Direct requests omit local cookies and CSRF headers. Only a confirmed local SillyTavern Basic Auth rejection triggers a direct fallback; failed upstream generations are never retried and credential modes never switch automatically.

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
