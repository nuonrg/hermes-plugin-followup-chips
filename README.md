# followup-chips

![Follow-up chips — chosen state with ✓](screenshot.png)

Clickable follow-up suggestion chips for Hermes desktop replies. 54-second demo: `demo.mp4` (also posted with the contest entry).

## What it does

End any reply with a directive:

```
::followups{q1="First suggestion?" q2="Second one?" q3="Third?"}
```

The plugin renders each `qN` as a clickable chip under the message.

Two or more chips are toggles. Tick as many as you want and one **Send N** button sends them as a single turn, one per line, in `q` order, so the agent reads it as a person asking for three things at once rather than three queued turns. That is the default because the alternative sent one turn per click.

Add `multi="0"` for a genuinely exclusive choice, where one click sends and picking is never offered:

```
::followups{multi="0" q1="Force-push the branch" q2="Abandon it and start over"}
```

A single chip carries no attribute: there is nothing to pick, so it sends on one click.

### Interaction model

- **Hover** — Hermes' signature `arc-border` travelling-light ring (two-layer masked ring, themed to `--dt-primary`), subtle tint on border/background, 160 ms fades. Never a plain box-shadow.
- **Chosen, while the agent answers** — single-select: the arc keeps running on the chosen chip; the chip shows `✓` and the unchosen chips dim. Multi-select: ticked chips show `✓` and the arc runs on the **Send** button, because that is the turn being answered.
- **Answer complete** — the arc rests (driven by the real `message.complete` / `message.start` gateway events, no timers).
- **One active arc** — only the most recent choice ever runs; older blocks keep their ✓ but rest.
- **Sent blocks lock** — after Send, the button reads `✓ Sent` and the block cannot be picked again.
- **Persistent** — choices survive window reloads via `ctx.storage` (keyed `hermes.plugin.followup-chips.choices`).
- **Per-block isolation** — every `::followups` block is keyed `sessionId::directive-source`, so a new block always starts blank and never inherits an earlier choice.
- **Any count** — `q1..qN` parsed in numeric order, no hard limit. A block with two or more chips is pickable by default; `multi="1"`, `"true"`, `"yes"` and `"on"` say so explicitly, and `"0"`, `"false"`, `"no"` and `"off"` opt out.
- **Stale-composer guard** — if the chat is no longer open, the click warns instead of sending into the wrong conversation.

## The prompt rule (agent half)

A directive only appears if the model writes it. So the plugin registers one system-prompt section (`prompt_section.py`) telling the agent: when the next step is a choice, end with the directive instead of asking in prose. It forbids the phrases that leave a reply dead-ended — "say the word and I'll…", "want me to…?", "shall I…?", "let me know if…" — and asks for 2 to 5 imperative options. On surfaces that cannot draw chips (Telegram, the CLI) the section asks for a numbered list instead, so no raw directive line is ever printed there.

Nothing is sent anywhere; the section is text frozen into the session prompt.

### Optional: the offer you already got

Models do not always follow a rule. With **Turn a written offer into chips** on (Settings → Plugins, `auto_offers`, off by default) a `transform_llm_output` hook reads the closing paragraph of each reply, and when it is an offer it moves it into a directive before the reply is stored:

```
Branch is pushed and the PR is open.

Want me to take any of these next?
- Add a CHANGELOG entry
- Update the docs screenshot
```

becomes

```
Branch is pushed and the PR is open.

::followups{multi="1" q1="Add a CHANGELOG entry" q2="Update the docs screenshot"}
```

`offers.py` is pure text in, text out: no network, no model call. It only looks at the **last** paragraph, only for a recognised offer phrase plus a bullet list or a single offer sentence, and it returns the reply untouched on any other shape — a statement of intent ("I'll check the log first"), a mid-reply question ("Want me to push it?" followed by more prose), a conditional clause ("the rule fires if you want strict mode"), a reply that already carries a directive, and every non-Desktop surface. Quotes are rewritten, braces are stripped, options cap at 6 and 120 characters. A false negative costs nothing; a false positive would rewrite someone's prose, so the bar is deliberately high.

## Why a plugin (and not a prompt/skill)

A skill can emit text; it cannot render interactive UI in the transcript, wire click→composer-submit, host a state machine per directive instance, subscribe to gateway events, or persist UI state across reload. This is transcript-directive rendering + session-scoped state — desktop-plugin territory. And a prompt alone cannot fix the replies that ignore it, which is what the optional hook is for.

## Files

- `desktop/plugin.js` — the renderer (default export `{ id, register }`), the copy the manifest entrypoints
- `plugin.js` — the same file for single-file installs; `tests/chips.test.mjs` fails if the two drift
- `__init__.py` — the agent half: the prompt section and the optional `transform_llm_output` hook
- `prompt_section.py` — the chip rule, per surface
- `offers.py` — the closing-offer detector
- `plugin.yaml` — manifest, `provides_hooks`, `auto_offers` setting
- `tests/` — detector and hook tests (Python), renderer harness (Node, no dependencies)

## Install

Both halves, as one plugin:

```
git clone https://github.com/nuonrg/hermes-plugin-followup-chips
hermes plugins install ./hermes-plugin-followup-chips
```

Or by hand: copy the folder to `%LOCALAPPDATA%/hermes/plugins/followup-chips/` and enable it in Settings → Plugins. Reload with `Ctrl+R`.

Desktop-only install (chips, no prompt rule, no hook): copy `plugin.js` to `%LOCALAPPDATA%/hermes/desktop-plugins/followup-chips/plugin.js` and reload.

## Tests

```
python -m unittest discover -s tests -t .   # detector, hook, registration
node tests/chips.test.mjs                   # renderer, with stub SDK and React
```

## Catalog entry (plugin-catalog/followup-chips.yaml)

```yaml
name: followup-chips
description: >-
  Clickable follow-up question chips under assistant replies. One click sends
  the question as the next turn; with multi="1" several chips are ticked and
  sent as one message, and a bundled prompt rule makes the agent end a choice
  with the chips instead of asking "say the word and I'll...". An optional hook
  turns an offer written in prose into the same chips. Hermes arc-border hover;
  choice persists per block across reload.
repo: https://github.com/nuonrg/hermes-plugin-followup-chips
sha: <40-char commit SHA of the pinned release>
capabilities:
  provides_hooks: [transform_llm_output]
```

No self-updating code, no core patches, no native binaries — the plugin only uses the public desktop SDK (`TRANSCRIPT_DIRECTIVE_AREA`, `host.composer.submit`, `ctx.storage`, `ctx.onEvent`) and public plugin APIs (`register_system_prompt_section`, `register_hook`, `get_config`).

## Credits

Built by **@nuonrg** for the Hermes Agent Plugin Hackathon (Nous Research, Nov 2026).
