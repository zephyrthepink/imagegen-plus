# UIGE — Unremarkable Image Generation Extension

Generate images from your SillyTavern chats using LiteRouter. Write a prompt yourself or have a connection profile draft one from your chat, character and persona.

## Install

Requires SillyTavern 1.19.0 or newer.

1. Open **Extensions → Install extension** and paste:
   ```text
   https://github.com/zephyrthepink/imagegen-plus
   ```
2. Reload and open **Extensions → UIGE**.
3. Choose **Manual API key** and enter your LiteRouter key.
4. Select a **Prompt writer** connection profile if you want AI-written prompts.

To reuse saved LiteRouter credentials instead, follow the [optional profile bridge setup](server/README.md).

## Use

Open **Image studio** from the wand menu. Write or draft a prompt, edit it, then generate. Model, size and seed changes in the studio apply only to that session. Each image is added to the chat; previous images stay available.

Choose the prompt writer's sources and style in settings. Add tags with the final prompt template:

```text
masterpiece, high_res, {{ig_prompt}}, accurate anatomy
```

`{{ig_prompt}}` is your draft. Native SillyTavern macros also work.

**Automatic images** is off by default. Enable it to generate every few messages, filtered by user, bot or speaker name.

Use `/uige` to illustrate the current scene, or `/uige your prompt` to generate directly.
