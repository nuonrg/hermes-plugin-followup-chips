# Changelog

All notable changes to followup-chips are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/); dates in Europe/Amsterdam.

## [Unreleased]

### Added
- A small **Steer** button beside the send key in `kind="multi"` and `kind="answer"` blocks. It sends the composed selection into the running turn through `session.steer`, without the queue fallback the plain send path uses. A refused steer warns and leaves the block unsent; with no turn running it starts a normal turn. Plain chips are unchanged.

## [1.2.0] - 2026-11-19

### Added
- `kind="multi"`: checkbox rows + one send button — compose a selection ("do 1 and 3") as the next turn
- `kind="answer"`: checkbox + reply field per item; send composes `1. <item>: <answer>` lines — react per point without typing numbered lists
- Both are opt-in via the directive; plain `::followups{q1..qN}` behaviour is unchanged (one click sends)
- Skill section documenting the reply-type table, the semantic (language-neutral) trigger, and the 2048-char directive body limit

### Fixed
- Send key (↵) aligns with the input column edge instead of floating at window width

## [1.1.1] - 2026-11-19

### Fixed
- `otherLabel` placeholder crashed the contrib boundary (`ReferenceError: attrs is not defined`); the label now arrives via `props` and also works combined with `title`
- Attribute names are matched case-insensitively: the app's parser lowercases every attr key (`otherLabel` arrives as `otherlabel`), so the old lookup silently missed

### Note
- v1.1.0 was tagged and released before these fixes landed on main; the tag is immutable, so both fixes ship in this patch

## [1.1.0] - 2026-11-19

### Added
- `title` attr: optional label above the chips — next-steps / follow-up question lists now render as the directive instead of prose
- `other="true"`: opt-in free-text row below the chips (Enter sends the text as the next turn) — for a remark that is not a chip
- `otherLabel` attr: custom placeholder for the free-text row (language-neutral, defaults to `…`)

## [1.0.0] - 2026-11-12

### Added
- `::followups{q1..qN}` transcript directive: clickable question chips under assistant replies; clicking sends the question as the next turn
- Hermes `arc-border` hover idiom; arc runs while the agent answers, rests on ✓ once chosen
- Per-block choice state (`<sessionId>::<source>`), persisted via `ctx.storage` across reloads
- Single-block `running` state: only the most recent choice animates
- First release in the plugin catalog (`plugin-catalog/followup-chips.yaml`, pin `3e44fa9`)
