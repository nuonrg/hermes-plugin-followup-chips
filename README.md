# followup-chips

![Follow-up chips — chosen state with ✓](screenshot.png)

Clickable follow-up suggestion chips for Hermes desktop replies. 54-second demo: `demo.mp4` (also posted with the contest entry).

Latest release: **[releases/latest](https://github.com/apoapostolov/hermes-plugin-followup-chips/releases/latest)** — every feature, the settings table and the install steps on one page. The link follows the newest release, so it does not go stale when one ships.

## What it does

The agent registers its follow-up options, either by calling the `followup_chips` tool or by ending the reply with a directive:

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

Add `rec="1,3"` to mark the options a classifier would pick:

```
::followups{multi="1" rec="1,3" q1="Push the branch" q2="Tag a release" q3="Write the notes"}
```

Those chips carry a **Recommended** tag and start out ticked, so the reply arrives one click from the steps worth taking. `rec` takes the 1-based `q` numbers, the same numbering the agent already writes.

### Risky options

Some next steps look harmless and are not: deleting a tag, force-pushing, overwriting a file, running a migration. With **Mark risky options** on, a classifier reads every chip for what it could damage and the ones that clear the bar carry a **Risky** pill in amber, so a destructive step never looks like the safe one beside it.

```
::followups{risky="2" q1="Tag the release" q2="Force-push the branch"}
```

The judgement is about harm, not effort: damage to files or data, a broken build, a new bug, money spent, or a mess that needs its own cleanup. A step that is merely slow or incomplete is not risky. Reversibility counts, which is why "delete the tag and start over" reads riskier than "tag the branch" even though both touch the same repository. The bar is 0.6 and the verdict must beat its own safe reading, so a split answer marks nothing: a warning pill on every other chip is noise, and one that appears when nothing is wrong teaches people to ignore it.

Off by default, because the plugin is guessing about consequences and a wrong warning is worse than none. It needs a classifier plugin; without one nothing is marked and the chips behave normally. Turning the setting off also strips the mark from replies that arrive carrying one, so a model cannot leave the pill on by writing the attribute itself.

### Options that exclude each other

A row can hold steps that combine and a pair that does not. `alt` says which ones cannot both be picked:

```
::followups{alt="1,3|2,3" q1="Force-push the branch" q2="Delete the tag and start over" q3="Leave it as it is"}
```

Each group is 1-based numbers, groups separated by `|`. Picking a chip clears every other member of its groups, so choosing a route automatically lets go of the one it replaces. A chip a pick has ruled out stays visible and greyed, and clicking it swaps the pick rather than doing nothing. Two groups let one chip be opposed to two others without making those two oppose each other.

The pairs are the model's call, with one rule applied whether or not it says so: an option that means leaving things as they are (`Leave it as it is`, `Not now`, `Wait for review`, `No change`, and the rest of the deferral phrasings) is opposed to every action in the block. That pairing is computed, not requested, because a model that recommends three steps and a "leave it" tends to forget that picking all four is not a decision.

On the tool path the same decision travels as `alternates: [[1, 3]]`, and the implied pairs are merged in before the directive is written.

Chips that exclude each other are drawn next to each other, in the order the model put them, so a route and the one it replaces never sit apart with unrelated steps between them. An option that means leaving things as they are closes the row, and with three or more options a chip the groups pair with all of the others is treated the same way even when its label does not say so. The numbers in `alt`, `rec` and `risky` are rewritten to the new positions, and a directive already in order is not touched.

Every chip in a block shares one width, the width of its longest option, so a row of short actions lines up instead of staggering. `accent="0"` drops the accent tint on the recommended chips and leaves everything else alone.

```
::followups{multi="1" rec="1,3" accent="0" q1="Push the branch" q2="Tag a release"}
```

### Interaction model

- **Hover** — Hermes' signature `arc-border` travelling-light ring (two-layer masked ring, themed to `--dt-primary`), subtle tint on border/background, 160 ms fades. Never a plain box-shadow.
- **Chosen, while the agent answers** — single-select: the arc keeps running on the chosen chip; the chip shows `✓` and the unchosen chips dim. Multi-select: ticked chips show `✓` and the arc runs on the **Send** button, because that is the turn being answered.
- **Answer complete** — the arc rests (driven by the real `message.complete` / `message.start` gateway events, no timers).
- **One active arc** — only the most recent choice ever runs; older blocks keep their ✓ but rest.
- **Sent blocks lock** — after Send, the button reads `✓ Sent` and the block cannot be picked again.
- **Persistent** — choices survive window reloads via `ctx.storage` (keyed `hermes.plugin.followup-chips.choices`).
- **Per-block isolation** — every `::followups` block is keyed `sessionId::directive-source`, so a new block always starts blank and never inherits an earlier choice.
- **Any count** — `q1..qN` parsed in numeric order, no hard limit. A block with two or more chips is pickable by default; `multi="1"`, `"true"`, `"yes"` and `"on"` say so explicitly, and `"0"`, `"false"`, `"no"` and `"off"` opt out.
- **Composer guard** — if the chat is no longer open, the click warns instead of sending into the wrong conversation.
- **Recommended** — `rec="1,3"` tags those chips and, in multi-select, ticks them once. Any tick or a sent block ends the defaults, so un-ticking a recommendation is never undone on the next render, and a reload keeps what you chose.
- **Equal widths** — the row is one grid column sized to its longest chip, so every pill stretches to that width. A very long option is capped by the row and its text wraps inside the pill. The tick slot is laid out on every chip and only hidden, so picking one does not resize the row.
- **Accent** — a recommended chip keeps the accent border and tint while it is unpicked, and the tag sits on the pill's right edge, lining up down the column. Picked chips are the strongest tint of the three states (rest, recommended, picked). With the accent setting off, the tag turns neutral grey as well, so turning it off is visible even on a chip that starts picked.

### Recommendations are optional and need the `nerve` plugin

The classifier is a separate plugin: [`nerve`](https://github.com/keeltrace/hermes-nerve), which provides `nerve_assess` (the older `jev_assess` contract is accepted too). **Install it only if you want the marks.** This plugin detects it at session start and asks for it only when it is there.

With `nerve` absent, everything else in this README works exactly as written: the agent still ends a choice with `::followups`, the chips still render and send, multi-select still ticks, blocks still persist, and `auto_offers` still converts a prose offer. The only difference is that nothing ever computes `rec`, so no chip carries the **Recommended** tag and none starts ticked.

| Installed | Chips, clicks, multi-select | Recommended tags |
|---|---|---|
| this plugin alone | yes | never |
| this plugin + `nerve` | yes | when the classifier clears the bar |

The plugin does not list `nerve` in `requires_plugins`. That field is advisory in Hermes, so the plugin would still load, but it logs a warning that a required plugin is missing, and a warning on a working install reads as breakage. The capability is probed per session instead, and `followup_recommend` answers "leave rec out" when nothing answers.

## Recommended options (agent half)

`rec` is a plain attribute: anything that writes the directive can set it. The bundled `followup_recommend` tool fills it from the decision classifier (the `nerve` plugin's `nerve_assess`, or the older `jev_assess` name of the same contract):

```
followup_recommend(options=["Push the branch", "Tag a release", "Write the notes"], context="Apo asked for the release to go out")
→ Recommended 1 of 3: 1 (0.91). Write rec="1" into the directive.
```

One `choice` question per option rides in a single classifier call (200-350 ms), so a five-option reply still costs one call. The payload is built so the classifier can see the choice it is judging: the state lists the candidates numbered, and each question names the other options, because "take it now" cannot be true of two options that are alternatives to each other.

The policy is in code, not in the model, and four rules decide what gets marked:

- an option is recommended when it clears **0.5** on "take it now" and beats both "later" and "skip", so a 0.51 beside a 0.49 skip is not a verdict;
- a **"none of these" option** (a deferral such as "Wait for review" counts as one) is never marked beside another option, and only when it is preferred over every other option, because taking a step and taking no step cannot both be right;
- **every option clearing the bar is not a recommendation**: the weakest is left out, so two options cannot both be marked;
- at most **3** survive, strongest first.

More than one can still be marked, which is the point when the steps genuinely belong together; what cannot happen is all of them, or two that contradict. When nothing clears, the tool reports the highest score so the model can see how close it was.

When no classifier is loaded, or the owner turns **Ask the decision classifier which steps to pick** off (`auto_recommend`), the tool answers "leave rec out": no tag, no pre-pick, and nothing else about the reply changes. A classifier error never changes a reply either, so a missing, slow or broken `nerve` costs you a recommendation and never a message.

### The accent setting

**Accent the recommended options** (`accent_recommended`, on by default) is the only setting that has to travel to the renderer, and it travels as an attribute. Renderer code cannot read plugin settings: the desktop SDK exposes no settings surface to a plugin's `plugin.js`, so a toggle alone would be invisible to the chips. The agent half reads the setting on every reply and, when it is off, stamps `accent="0"` into any directive it sees:

```
::followups{rec="1" q1="Push the branch"}
↓ accent_recommended off
::followups{accent="0" rec="1" q1="Push the branch"}
```

On, nothing is added, because accented is the default. Off, a recommended chip stays on the neutral surface until you pick it, and the Recommended tag stays in the neutral grey instead of the accent. The tag changes as well because otherwise the setting would be invisible on a pre-picked chip, where the pick tint dominates. The hook that does this is the same `transform_llm_output` used by `auto_offers`: both read their setting per reply, so a toggle applies to the next turn rather than the next plugin reload. With `auto_offers` off and the accent on, the hook reads both settings and returns the reply untouched, with no text scan at all.

### A busy chat queues the click (agent half, off by default for steering)

A chip's text normally becomes the next user message. That is what happens on an idle chat: it starts a turn.

While the agent is already working, the click is admitted into the durable gateway queue instead (`prompt.submit`, which always admits with mode `queue`), so it becomes the next turn and runs when the current one ends. This is the only path, and it does not depend on the setting below, because the composer's own busy route is not the queue: it steers or interrupts the running turn. A chip that silently changed the answer in progress, or left a request with no turn behind it, would be worse than a late one.

With `send_as_steer` on, the click also steers the live turn first (`session.steer`, the same gateway call the composer's steer makes, with the desktop protocol filling in the execution generation). The wire contract reads `rejected` as "not corrected, queue it as the next prompt", and any other refusal, thrown error or missing session means the same thing, so the queue admission is the floor: a steered click that does not land still becomes the next turn.

Chips are marked by attribute, `steer="1"`, because renderer code cannot read plugin settings. The behaviour covers all three send paths: one chip, a multi-row Send, and a carried chip.

### Carried over proposals (agent half, off by default)

A reply's chips only exist while that reply is on screen. In a long queued session the next reply buries them, and a step you never answered is gone.

The queue is capped at thirty, and what it gives up is chosen rather than first-in-first-out: tombstones go first, then the oldest proposal that was never recommended, and only when the queue is nothing but recommendations does an old recommendation go. So the newest work survives, plus everything the classifier thought worth doing. Proposals stored before that flag existed are unknown rather than unmarked: they are retired after the confirmed-unmarked ones, and a block that still renders in the transcript gives its entries their verdict back on the next load, because the directive is still there to read. Once the cap is reached the row also reads newest first, because the proposals nearest this reply are the ones still worth a click.

**Carry Over Old Proposals** (`carry_over`, off by default) keeps them. Every reply then also draws the proposals earlier replies left unanswered. Each carried chip says how far back it came from (`2 responses ago`) and carries an **✕** at its end to drop it; clicking the age jumps the transcript back to the reply that offered it.

| Reply | Proposes | Shows |
|---|---|---|
| 1 | three steps | its three |
| 2 | nothing | the same three, each saying `1 response ago` |
| 3 | two steps | its two, then the same three |

Picking a chip sends it as the turn and retires it. Picking anything in a block retires that whole block, because a reply you answered is not a proposal any more. The ✕ retires one chip and sends nothing, and the age badge scrolls without sending: the pill, the age and the ✕ are three separate targets, because a label that looks like a link but sends a message is a trap. The count is not an estimate: every reply in a carrying session takes the next number when its chips first mount, the numbers are stored with the queue, and a chip's age is the difference between its reply and the one you are reading. The queue is per session, capped at 30 entries, and survives a window reload; dismissing is permanent, so a reload cannot bring a dropped chip back.

**Clean Old Follow-Ups ↓** ends the row, right-aligned past the send button. One click drops every proposal carried in from earlier replies, which is the difference between clearing a stale queue and pressing ✕ thirty times. It tombstones the entries rather than deleting them, so a reload cannot bring a dropped chip back, and it leaves this reply's own proposals alone: cleaning what was carried does not answer what is on screen. The button only exists when something is carried.

Two mechanics are worth knowing, because both come from the plugin's split halves:

- Renderer code cannot read plugin settings, so the agent half stamps `carry="1"` into the directive.
- A reply that proposes nothing still needs a slot to draw in. The directive paragraph is the only place a desktop plugin can render, so with the setting on the agent half appends one empty `::followups{carry="1"}` line to a reply that proposes nothing. With nothing to carry and nothing proposed, that line renders as nothing at all, and no chips line appears.

Because that empty block is a rewrite of the reply text, it applies on Desktop only; other surfaces never see the directive.

## Chips from a tool call (agent half)

A model writing `::followups` by hand has to escape quotes, keep braces balanced, remember `multi` and `rec`, and never wrap the line in a sentence. Each of those is a way to ship a chip row that renders wrong or not at all, and it arrives as prose in the transcript instead of an error.

`followup_chips` moves the options out of the text and into the call's arguments:

```
followup_chips(options=["Push the branch", "Tag a release", "Write the notes"], multi=False, recommend=True)
→ Chips registered: 3 options (one choice), recommended 1. They render under this reply;
  do not also write a ::followups line.
```

Options are validated on the way in: 2 to 6 of them, whitespace collapsed, case-insensitive duplicates dropped, 120 characters each (longer labels are truncated with an ellipsis rather than rejected). `multi` is explicit, so three exclusive options stay exclusive instead of defaulting to a row the user can send two of at once. `recommend=true` runs the same classifier and policy as `followup_recommend` in the same call and puts its verdict in the `rec` attribute.

The reply hook that already stamps `accent` and `carry` appends the directive from the registration before the reply is stored, so a tool-built block is identical to a written one and inherits every setting. The prose stays prose.

A registration belongs to one reply. It is consumed by the next reply in that session, dropped off Hermes Desktop (where the directive would arrive as raw text), dropped when the reply already carries a directive of its own because a model that wrote one meant it, and expires after 15 minutes if the turn dies before the hook runs. A second `followup_chips` call in the same turn replaces the first, which is what a model retrying after a validation message expects.

The text directive is still supported and is what the prompt rule falls back to, because a model without tool calling still has to be able to produce chips.

## The prompt rule (agent half)

The plugin registers one system-prompt section (`prompt_section.py`) telling the agent that when the next step is a choice it calls `followup_chips` with 2 to 5 imperative options and writes no directive itself, falling back to the directive only where tool calling is unavailable. It forbids the phrases that leave a reply dead-ended — "say the word and I'll…", "want me to…?", "shall I…?", "let me know if…" — and asks for 2 to 5 imperative options. On surfaces that cannot draw chips (Telegram, the CLI) the section asks for a numbered list instead, so no raw directive line is ever printed there.

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
- `__init__.py` — the agent half: the prompt section, both tools, the optional `transform_llm_output` hook
- `prompt_section.py` — the chip rule, per surface, with the classifier sentence when one is loaded
- `offers.py` — the closing-offer detector
- `chips.py` — `followup_chips`: option validation, the per-session pending store, and the reply attach
- `recommend.py` — the classifier call and the pick policy, shared by both tools
- `plugin.yaml` — manifest, `provides_tools` / `provides_hooks`, and the four settings: `auto_offers`, `auto_recommend`, `accent_recommended`, `carry_over`
- `tests/` — detector, carry stamp, recommendation, chip-tool and registration tests (Python), renderer harness (Node, no dependencies)

## Install

Both halves, as one plugin:

```
git clone https://github.com/nuonrg/hermes-plugin-followup-chips
hermes plugins install ./hermes-plugin-followup-chips
```

Or install the published release, which needs no checkout:

```
hermes plugins install apoapostolov/hermes-plugin-followup-chips --enable
```

Or by hand: copy the folder to `%LOCALAPPDATA%/hermes/plugins/followup-chips/` and enable it in Settings → Plugins. Then reload the window: `Ctrl+K` opens the command palette, where **Reload window** is the entry. The app has no reload keybind of its own.

Desktop-only install (chips, no prompt rule, no hook): copy `plugin.js` to `%LOCALAPPDATA%/hermes/desktop-plugins/followup-chips/plugin.js` and reload the window the same way.

## Tests

```
python -m unittest discover -s tests -t .   # 216 tests: detector, stamps, alternates, risk, recommendation, chip tool, hook, registration
node tests/chips.test.mjs                   # 70 cases: renderer, carry queue, cleanup, alternates, risky pill, busy queue, steering, with stub SDK and React
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
  provides_tools: [followup_recommend]
  provides_hooks: [transform_llm_output]
```

No self-updating code, no core patches, no native binaries — the plugin only uses the public desktop SDK (`TRANSCRIPT_DIRECTIVE_AREA`, `host.composer.submit`, `ctx.storage`, `ctx.onEvent`) and public plugin APIs (`register_system_prompt_section`, `register_hook`, `get_config`).

## Credits

Built by **@nuonrg** for the Hermes Agent Plugin Hackathon (Nous Research, Nov 2026).
