// Renderer harness for desktop/plugin.js: no app, no React, no dependencies.
//
// The plugin only needs three imports (TRANSCRIPT_DIRECTIVE_AREA, host, jsx), so
// this test writes tiny stub packages into a temp dir, copies the plugin in as
// ESM, and drives the directive renderer directly. Components are plain functions
// under the stubs, so calling one gives an element tree we can assert on.
//
//   node tests/chips.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const pluginSource = resolve(here, '..', 'desktop', 'plugin.js')
const dir = mkdtempSync(join(tmpdir(), 'followup-chips-test-'))
const nm = join(dir, 'node_modules')

function pkg(name, files) {
  const root = join(nm, name)
  mkdirSync(root, { recursive: true })
  for (const [file, body] of Object.entries(files)) {
    writeFileSync(join(root, file), body)
  }
}

pkg('@hermes/plugin-sdk', {
  'package.json': JSON.stringify({ name: '@hermes/plugin-sdk', type: 'module', main: 'index.js' }),
  'index.js': [
    "export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directives'",
    '// The test mutates this object the way the app would provide it.',
    'export const host = { composer: { submit: () => false }, notify: () => {} }',
  ].join('\n'),
})

// Minimal hooks: state is kept per call order so a component can be called again
// and see the values the last call produced, which is enough for one flat tree.
pkg('react', {
  'package.json': JSON.stringify({
    name: 'react',
    type: 'module',
    main: 'index.js',
    exports: { '.': './index.js', './jsx-runtime': './jsx-runtime.js' },
  }),
  'index.js': [
    'const states = new Map()',
    'const effectDeps = new Map()',
    'const cleanups = []',
    'let cursor = 0',
    'let effectCursor = 0',
    'export function __reset() {',
    '  cursor = 0',
    '  effectCursor = 0',
    '  states.clear()',
    '  effectDeps.clear()',
    '  while (cleanups.length) { const c = cleanups.pop(); try { c() } catch (e) {} }',
    '}',
    'export function useState(initial) {',
    '  const slot = cursor++',
    '  if (!states.has(slot)) states.set(slot, typeof initial === "function" ? initial() : initial)',
    '  const set = (next) => { states.set(slot, typeof next === "function" ? next(states.get(slot)) : next) }',
    '  return [states.get(slot), set]',
    '}',
    '// Effects run on the spot, honouring deps the way React would on a mount.',
    'export function useEffect(fn, deps) {',
    '  const slot = effectCursor++',
    '  const key = deps ? JSON.stringify(deps) : null',
    '  if (deps && effectDeps.get(slot) === key) return',
    '  effectDeps.set(slot, key)',
    '  const cleanup = fn()',
    '  if (typeof cleanup === "function") cleanups.push(cleanup)',
    '}',
  ].join('\n'),
  'jsx-runtime.js': [
    'export function jsx(type, props, key) { return { type, props: props || {}, key } }',
    'export const jsxs = jsx',
    'export const Fragment = "Fragment"',
  ].join('\n'),
})

writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
const entry = join(dir, 'plugin.mjs')
copyFileSync(pluginSource, entry)

const sdk = await import(pathToFileURL(join(nm, '@hermes/plugin-sdk', 'index.js')).href)
const react = await import(pathToFileURL(join(nm, 'react', 'index.js')).href)
const plugin = (await import(pathToFileURL(entry).href)).default

/* ---- a renderer: expand function components into element trees ---------- */
function render(node) {
  if (node == null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(render)
  if (typeof node.type === 'function') {
    react.__reset()
    return render(node.type(node.props))
  }
  const props = Object.assign({}, node.props)
  if (props.children != null) props.children = render(props.children)
  return { type: node.type, props, key: node.key }
}

function roots(el) {
  // A chips block is a div whose children are chip buttons plus an optional send button.
  assert.equal(el.type, 'div')
  return el.props.children
}

function chips(el) {
  return roots(el).filter((c) => c.props.className.indexOf('fu-send') === -1)
}

function send(el) {
  return roots(el).find((c) => c.props.className.indexOf('fu-send') !== -1)
}

function label(el) {
  const first = el.props.children[0]
  if (first == null || typeof first !== 'object') return first
  const inner = first.props.children
  // A chip label is [tick span, text span]; only what is visible counts, so an
  // unpicked chip reads as its text and a picked one keeps the ✓.
  if (Array.isArray(inner)) {
    return inner
      .filter((part) => !(part && part.props && part.props.style && part.props.style.visibility === 'hidden'))
      .map((part) => (part && typeof part === 'object' ? part.props.children : part))
      .join('')
  }
  return inner
}

function tickReserved(el) {
  const label = el.props.children[0]
  const inner = label && label.props && label.props.children
  if (!Array.isArray(inner)) return false
  return inner.some((part) => part && part.props && part.props.children === '✓ ')
}

function badge(el) {
  const mark = el.props.children.find(
    (child) => child && typeof child === 'object' && child.props && child.props.children === 'Recommended'
  )
  return mark ? mark.props : null
}

/* ---- harness state ------------------------------------------------------ */
const submits = []
sdk.host.composer.submit = (sessionId, text) => {
  submits.push([sessionId, text])
  return true
}
sdk.host.notify = (n) => submits.push(['notify', n])

const store = new Map()
const events = {}
let directive = null
plugin.register({
  storage: {
    get: (key, fallback) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
    set: (key, value) => store.set(key, structuredClone(value)),
  },
  onEvent: (name, fn) => {
    ;(events[name] = events[name] || []).push(fn)
  },
  register: (contribution) => {
    directive = contribution
  },
})

assert.equal(directive.id, 'followups', 'registers the followups directive')
assert.equal(directive.area, 'transcript.directives', 'registers into the transcript area')
const register = directive.data.render

const results = []
function test(name, fn) {
  try {
    fn()
    results.push(['ok', name])
  } catch (error) {
    results.push(['fail', name, error.message])
  }
}

/* ---- single select: unchanged behaviour --------------------------------- */
test('single click sends at once and shows no send button', () => {
  submits.length = 0
  const el = render(register({ attrs: { q1: 'Push it?', q2: 'Tag it?' }, sessionId: 's1', source: 'src-a' }))
  assert.equal(chips(el).length, 2)
  assert.equal(send(el), undefined, 'single select has no send button')
  chips(el)[1].props.onClick()
  assert.deepEqual(submits, [['s1', 'Tag it?']])
})

test('single select marks the chosen chip and settles on message.complete', () => {
  let el = render(register({ attrs: { q1: 'Push it?', q2: 'Tag it?' }, sessionId: 's2', source: 'src-b' }))
  chips(el)[0].props.onClick()
  el = render(register({ attrs: { q1: 'Push it?', q2: 'Tag it?' }, sessionId: 's2', source: 'src-b' }))
  assert.match(chips(el)[0].props.className, /fu-chosen/)
  assert.match(chips(el)[0].props.className, /fu-running/)
  assert.equal(label(chips(el)[0]), '✓ Push it?')
  events['message.complete'][0]('s2')
  el = render(register({ attrs: { q1: 'Push it?', q2: 'Tag it?' }, sessionId: 's2', source: 'src-b' }))
  assert.doesNotMatch(chips(el)[0].props.className, /fu-running/)
})

/* ---- multi select ------------------------------------------------------- */
test('multi renders a disabled send button until something is picked', () => {
  const el = render(
    register({ attrs: { multi: '1', q1: 'A', q2: 'B', q3: 'C' }, sessionId: 'm1', source: 'src-m1' })
  )
  assert.equal(chips(el).length, 3)
  const button = send(el)
  assert.ok(button, 'multi select shows a send button')
  assert.equal(button.props.disabled, true)
  assert.equal(label(button), 'Send')
})

test('multi chip click toggles instead of sending', () => {
  submits.length = 0
  const attrs = { multi: '1', q1: 'Add docs', q2: 'Add a test', q3: 'Bump' }
  let el = render(register({ attrs, sessionId: 'm2', source: 'src-m2' }))
  chips(el)[0].props.onClick()
  assert.equal(submits.length, 0, 'nothing is sent on a chip click')
  el = render(register({ attrs, sessionId: 'm2', source: 'src-m2' }))
  assert.equal(label(chips(el)[0]), '✓ Add docs')
  assert.equal(chips(el)[0].props['aria-pressed'], true)
  assert.equal(chips(el)[1].props['aria-pressed'], false, 'other chips stay unpressed')
  assert.equal(send(el).props.disabled, false)
  assert.equal(label(send(el)), 'Send 1')
  chips(el)[0].props.onClick()
  el = render(register({ attrs, sessionId: 'm2', source: 'src-m2' }))
  assert.equal(label(chips(el)[0]), 'Add docs', 'a second click un-picks')
  assert.equal(send(el).props.disabled, true)
})

test('multi send carries every pick in q order as one turn', () => {
  submits.length = 0
  const attrs = { multi: '1', q1: 'Add docs', q2: 'Add a test', q3: 'Bump' }
  let el = render(register({ attrs, sessionId: 'm3', source: 'src-m3' }))
  chips(el)[2].props.onClick()
  el = render(register({ attrs, sessionId: 'm3', source: 'src-m3' }))
  chips(el)[0].props.onClick()
  el = render(register({ attrs, sessionId: 'm3', source: 'src-m3' }))
  assert.equal(label(send(el)), 'Send 2')
  send(el).props.onClick()
  assert.deepEqual(submits, [['m3', 'Add docs\nBump']], 'one message, picks in q order')
})

test('a sent block cannot be picked again and keeps its marks', () => {
  submits.length = 0
  const attrs = { multi: '1', q1: 'A', q2: 'B' }
  let el = render(register({ attrs, sessionId: 'm4', source: 'src-m4' }))
  chips(el)[0].props.onClick()
  el = render(register({ attrs, sessionId: 'm4', source: 'src-m4' }))
  send(el).props.onClick()
  el = render(register({ attrs, sessionId: 'm4', source: 'src-m4' }))
  assert.equal(label(send(el)), '✓ Sent')
  assert.equal(send(el).props.disabled, true)
  chips(el)[1].props.onClick()
  el = render(register({ attrs, sessionId: 'm4', source: 'src-m4' }))
  assert.equal(label(chips(el)[1]), 'B', 'no picking after the turn was sent')
})

test('picks persist across a reload from ctx.storage', () => {
  const attrs = { multi: '1', q1: 'A', q2: 'B' }
  const saved = store.get('choices')
  const key = Object.keys(saved).find((k) => k.indexOf('src-m4') !== -1)
  assert.ok(key, 'the block has a stored entry')
  assert.deepEqual(saved[key].picked, [0])
  assert.equal(saved[key].sent, true)
})

test('a failed submit warns instead of marking the block', () => {
  sdk.host.composer.submit = () => false
  submits.length = 0
  const attrs = { multi: '1', q1: 'A', q2: 'B' }
  let el = render(register({ attrs, sessionId: 'm5', source: 'src-m5' }))
  chips(el)[0].props.onClick()
  el = render(register({ attrs, sessionId: 'm5', source: 'src-m5' }))
  send(el).props.onClick()
  assert.equal(submits[0][0], 'notify')
  el = render(register({ attrs, sessionId: 'm5', source: 'src-m5' }))
  assert.equal(label(send(el)), 'Send 1', 'the block stays unsent')
  sdk.host.composer.submit = (sessionId, text) => {
    submits.push([sessionId, text])
    return true
  }
})

test('multi="true" and multi="yes" are accepted, single stays the default', () => {
  for (const flag of ['true', 'yes', 'on', true]) {
    const el = render(register({ attrs: { multi: flag, q1: 'A', q2: 'B' }, sessionId: 'f', source: 'src-' + flag }))
    assert.ok(send(el), 'multi via ' + JSON.stringify(flag))
  }
  const plain = render(register({ attrs: { q1: 'A', q2: 'B' }, sessionId: 'f', source: 'src-plain' }))
  assert.equal(send(plain), undefined)
})

test('q order is numeric, not lexicographic', () => {
  const attrs = { multi: '1', q10: 'Tenth', q2: 'Second', q1: 'First' }
  const el = render(register({ attrs, sessionId: 'o', source: 'src-order' }))
  assert.deepEqual(
    chips(el).map((c) => label(c)),
    ['First', 'Second', 'Tenth']
  )
})

test('an empty directive renders nothing', () => {
  assert.equal(render(register({ attrs: { multi: '1' }, sessionId: 'e', source: 'empty' })), null)
})

/* ---- recommended options ------------------------------------------------ */
const recAttrs = { multi: '1', rec: '1,3', q1: 'Push it', q2: 'Tag it', q3: 'Write the notes' }

test('rec pre-picks the recommended chips and tags them', () => {
  const el = render(register({ attrs: recAttrs, sessionId: 'r1', source: 'src-r1' }))
  assert.equal(label(chips(el)[0]), '✓ Push it')
  assert.equal(chips(el)[0].props['aria-pressed'], true)
  assert.ok(badge(chips(el)[0]), 'recommended chip carries the tag')
  assert.equal(chips(el)[1].props['aria-pressed'], false, 'unrecommended chip stays unmarked')
  assert.equal(badge(chips(el)[1]), null)
  assert.ok(badge(chips(el)[2]))
  assert.equal(label(send(el)), 'Send 2')
})

test('un-ticking a recommended chip is never undone by the defaults', () => {
  const first = render(register({ attrs: recAttrs, sessionId: 'r2', source: 'src-r2' }))
  assert.equal(label(send(first)), 'Send 2')
  chips(first)[0].props.onClick()
  const second = render(register({ attrs: recAttrs, sessionId: 'r2', source: 'src-r2' }))
  assert.equal(label(chips(second)[0]), 'Push it', 'the unticked chip stays unticked')
  assert.equal(label(send(second)), 'Send 1')
})

test('a stored block does not re-seed its recommended picks on reload', () => {
  const first = render(register({ attrs: recAttrs, sessionId: 'r3', source: 'src-r3' }))
  chips(first)[1].props.onClick()
  const second = render(register({ attrs: recAttrs, sessionId: 'r3', source: 'src-r3' }))
  assert.equal(label(send(second)), 'Send 3')
  const stored = store.get('choices')['r3::src-r3']
  assert.equal(stored.touched, true, 'the block is marked as used')
  assert.deepEqual(stored.picked, [0, 1, 2])
})

test('single select shows the tag but never pre-chooses', () => {
  const el = render(register({ attrs: { rec: '2', q1: 'Push it', q2: 'Tag it' }, sessionId: 'r4', source: 'src-r4' }))
  assert.equal(label(chips(el)[1]), 'Tag it', 'no ✓ before a click')
  assert.ok(badge(chips(el)[1]))
  assert.equal(send(el), undefined)
})

test('junk rec values are ignored instead of trusted', () => {
  for (const rec of ['0', '9', 'abc', '', '2,2', ' 1 ; 3 ']) {
    const el = render(register({ attrs: { multi: '1', rec, q1: 'A', q2: 'B', q3: 'C' }, sessionId: 'r5-' + rec, source: 'src-r5-' + rec }))
    const picked = chips(el).filter((c) => c.props['aria-pressed'] === true)
    assert.ok(picked.length <= 2, 'rec=' + JSON.stringify(rec) + ' picked ' + picked.length)
  }
})

/* ---- polish: accent tint and one width for the row ---------------------- */

test('a recommended chip is accented by default, even when it is not picked', () => {
  const el = render(register({ attrs: { rec: '2', q1: 'Push it', q2: 'Tag it' }, sessionId: 'p1', source: 'src-p1' }))
  const recommended = chips(el)[1]
  assert.ok(recommended.props.className.includes('fu-recommended'), 'recommended chip carries the accent class')
  assert.ok(/color-mix\(in srgb, var\(--dt-primary[\s\S]*70%/.test(recommended.props.style.border), 'accent border: ' + recommended.props.style.border)
  assert.ok(!chips(el)[0].props.className.includes('fu-recommended'), 'a plain chip is not accented')
})

test('accent="0" drops the tint but keeps the Recommended tag', () => {
  const el = render(
    register({ attrs: { rec: '2', accent: '0', q1: 'Push it', q2: 'Tag it' }, sessionId: 'p2', source: 'src-p2' })
  )
  assert.ok(!chips(el)[1].props.className.includes('fu-recommended'), 'no accent class at all')
  assert.ok(chips(el)[1].props.style.border.includes('ui-stroke-secondary'), 'neutral border')
  assert.equal(chips(el)[1].props.style.background, 'transparent')
  assert.ok(badge(chips(el)[1]), 'the tag stays')
  assert.ok(
    badge(chips(el)[1]).style.color.includes('ui-text-secondary'),
    'the tag goes neutral too: ' + badge(chips(el)[1]).style.color
  )
})

test('accent on, the tag carries the accent', () => {
  const el = render(register({ attrs: { rec: '1', q1: 'A', q2: 'B' }, sessionId: 'p2b', source: 'src-p2b' }))
  assert.ok(badge(chips(el)[0]).style.color.includes('--dt-primary'), 'accented tag: ' + badge(chips(el)[0]).style.color)
  assert.equal(badge(chips(el)[0]).style.marginLeft, 'auto', 'tags line up on the right edge')
})

test('accent accepts the same spellings as multi, and junk leaves it on', () => {
  for (const [value, wants] of [['0', false], ['false', false], ['off', false], ['1', true], ['yes', true], ['', true], ['nonsense', true]]) {
    const attrs = { rec: '1', accent: value, q1: 'A', q2: 'B' }
    const el = render(register({ attrs, sessionId: 'p3-' + value, source: 'src-p3-' + value }))
    const accented = chips(el)[0].props.className.includes('fu-recommended')
    assert.equal(accented, wants, 'accent=' + JSON.stringify(value))
  }
})

test('the tick slot is laid out on every chip so a pick cannot resize the row', () => {
  const el = render(register({ attrs: { multi: '1', q1: 'A', q2: 'B' }, sessionId: 'p4', source: 'src-p4' }))
  for (const chip of chips(el)) {
    assert.ok(tickReserved(chip), 'tick span present')
    assert.equal(label(chip), chip.props.title, 'no ✓ before a pick')
  }
  chips(el)[0].props.onClick()
  const after = render(register({ attrs: { multi: '1', q1: 'A', q2: 'B' }, sessionId: 'p4', source: 'src-p4' }))
  assert.ok(tickReserved(chips(after)[0]), 'the slot survives the pick')
  assert.equal(label(chips(after)[0]), '✓ A')
  assert.equal(label(chips(after)[1]), 'B', 'the other chip keeps its own text')
})

test('the row is one grid column sized to the widest chip, with Send outside it', () => {
  const el = render(register({ attrs: { multi: '1', q1: 'A', q2: 'A much longer option' }, sessionId: 'p5', source: 'src-p5' }))
  assert.equal(el.props.style.display, 'grid')
  assert.equal(el.props.style.gridTemplateColumns, 'minmax(0, max-content)')
  for (const chip of chips(el)) {
    assert.equal(chip.props.style.width, undefined, 'no per-chip width to fight the grid')
    assert.equal(chip.props.style.boxSizing, 'border-box')
  }
  assert.equal(send(el).props.style.justifySelf, 'start', 'Send keeps its own width')
})

/* ---- carry over: unanswered proposals follow their session --------------- */
function freshChips(el) {
  return roots(el).filter(
    (c) =>
      c &&
      c.props &&
      typeof c.props.className === 'string' &&
      c.props.className.indexOf('fu-stale-row') === -1 &&
      c.props.className.indexOf('fu-send') === -1
  )
}

function staleRows(el) {
  return roots(el).filter((c) => c && c.props && c.props.className === 'fu-stale-row')
}

function staleButton(row) {
  return row.props.children[0]
}

function staleDismiss(row) {
  return row.props.children[1]
}

function staleLabels(el) {
  return staleRows(el).map((row) => label(staleButton(row)))
}

/* The age badge: "2 responses ago", and a jump button in its own right. */
function ageBadge(row) {
  return staleButton(row).props.children.find(
    (c) => c && typeof c === 'object' && c.props && c.props.className === 'fu-age'
  )
}

function ageText(row) {
  return ageBadge(row).props.children
}

test('carry: a reply that proposes nothing still shows the unanswered chips', () => {
  const s = 'carry-none'
  render(register({ attrs: { carry: '1', q1: 'Push it', q2: 'Tag it', q3: 'Write notes' }, sessionId: s, source: 'r1' }))
  const el = render(register({ attrs: { carry: '1' }, sessionId: s, source: 'r2' }))
  assert.deepEqual(staleLabels(el), ['Push it', 'Tag it', 'Write notes'])
  assert.ok(staleRows(el).every((row) => ageBadge(row)), 'every carried chip says how old it is')
  assert.deepEqual(staleRows(el).map(ageText), ['1 response ago', '1 response ago', '1 response ago'])
  assert.equal(freshChips(el).length, 0, 'this reply proposed nothing of its own')
})

test('carry: the newest reply shows its own chips first, then the older ones', () => {
  const s = 'carry-mix'
  render(register({ attrs: { carry: '1', q1: 'Push the branch', q2: 'Tag a release', q3: 'Write the notes' }, sessionId: s, source: 'm1' }))
  render(register({ attrs: { carry: '1' }, sessionId: s, source: 'm2' }))
  const el = render(register({ attrs: { carry: '1', q1: 'Add a test', q2: 'Update the docs' }, sessionId: s, source: 'm3' }))
  assert.deepEqual(freshChips(el).map(label), ['Add a test', 'Update the docs'])
  assert.deepEqual(staleLabels(el), ['Push the branch', 'Tag a release', 'Write the notes'])
  assert.equal(freshChips(el).length + staleRows(el).length, 5, 'two new plus three stale')
})

test('carry: a carried chip sends exactly itself', () => {
  const s = 'carry-click'
  render(register({ attrs: { carry: '1', multi: '1', q1: 'A', q2: 'B' }, sessionId: s, source: 'k1' }))
  const el = render(register({ attrs: { carry: '1', multi: '1', q1: 'C' }, sessionId: s, source: 'k2' }))
  submits.length = 0
  staleButton(staleRows(el)[0]).props.onClick()
  assert.deepEqual(submits, [[s, 'A']])
})

test('carry: the X retires a proposal and a reload does not bring it back', () => {
  const s = 'carry-x'
  render(register({ attrs: { carry: '1', q1: 'A', q2: 'B' }, sessionId: s, source: 'x1' }))
  const el = render(register({ attrs: { carry: '1' }, sessionId: s, source: 'x2' }))
  staleDismiss(staleRows(el)[0]).props.onClick()
  const after = render(register({ attrs: { carry: '1' }, sessionId: s, source: 'x3' }))
  assert.deepEqual(staleLabels(after), ['B'], 'the dismissed one is gone')
  /* A reload re-mounts the original reply, which re-registers its own chips.
     The tombstone is what stops the dismissed chip coming back. */
  render(register({ attrs: { carry: '1', q1: 'A', q2: 'B' }, sessionId: s, source: 'x1' }))
  const reloaded = render(register({ attrs: { carry: '1' }, sessionId: s, source: 'x4' }))
  assert.deepEqual(staleLabels(reloaded), ['B'], 're-registering does not resurrect it')
})

test('carry: answering a block retires its own proposals', () => {
  const s = 'carry-answer'
  const first = render(register({ attrs: { carry: '1', q1: 'A', q2: 'B' }, sessionId: s, source: 'a1' }))
  freshChips(first)[0].props.onClick()
  /* Nothing is carried any more, so the next reply draws no chips line at all. */
  const next = render(register({ attrs: { carry: '1' }, sessionId: s, source: 'a2' }))
  assert.equal(next, null, 'an answered reply is not carried')
})

test('carry: a block without the attribute ignores the queue', () => {
  const s = 'carry-off'
  render(register({ attrs: { carry: '1', q1: 'A' }, sessionId: s, source: 'o1' }))
  const el = render(register({ attrs: { q1: 'B' }, sessionId: s, source: 'o2' }))
  assert.equal(staleRows(el).length, 0)
})

test('carry: an empty queue draws no block at all', () => {
  const el = render(register({ attrs: { carry: '1' }, sessionId: 'carry-empty', source: 'e1' }))
  assert.equal(el, null, 'nothing to carry and nothing proposed means no chips line')
})

test('carry: proposals stay inside their own session', () => {
  render(register({ attrs: { carry: '1', q1: 'A' }, sessionId: 'carry-sess-a', source: 'p1' }))
  const other = render(register({ attrs: { carry: '1' }, sessionId: 'carry-sess-b', source: 'p2' }))
  assert.equal(other, null)
})

test('carry: the queue is capped so a long session cannot grow without bound', () => {
  const s = 'carry-cap'
  const many = { carry: '1' }
  for (let i = 1; i <= 33; i += 1) many['q' + i] = 'Option ' + i
  render(register({ attrs: many, sessionId: s, source: 'cap1' }))
  const el = render(register({ attrs: { carry: '1' }, sessionId: s, source: 'cap2' }))
  assert.equal(staleRows(el).length, 30, 'keeps the newest 30')
  assert.equal(label(staleButton(staleRows(el)[0])), 'Option 4', 'the oldest four were retired')
})


test('carry: the badge counts replies, not chips', () => {
  const s = 'carry-age'
  render(register({ attrs: { carry: '1', q1: 'A', q2: 'B' }, sessionId: s, source: 'g1' }))
  const second = render(register({ attrs: { carry: '1' }, sessionId: s, source: 'g2' }))
  assert.deepEqual(staleRows(second).map(ageText), ['1 response ago', '1 response ago'])
  const third = render(register({ attrs: { carry: '1', q1: 'C' }, sessionId: s, source: 'g3' }))
  assert.deepEqual(staleRows(third).map(ageText), ['2 responses ago', '2 responses ago'])
})

test('carry: the age badge jumps to the offering reply and sends nothing', () => {
  const s = 'carry-jump'
  const first = render(register({ attrs: { carry: '1', q1: 'A' }, sessionId: s, source: 'j1' }))
  const originId = first.props.id
  assert.ok(/^fu-block-[a-z0-9]+-1$/.test(originId || ''), 'the offering block has a stable address')
  const el = render(register({ attrs: { carry: '1', q1: 'B' }, sessionId: s, source: 'j2' }))
  assert.notEqual(el.props.id, originId, 'each reply has its own address')
  const row = staleRows(el)[0]
  const badge = ageBadge(row)
  assert.equal(ageText(row), '1 response ago')

  const jumps = []
  globalThis.document = {
    getElementById: (id) => (id === originId ? { scrollIntoView: (opts) => jumps.push(opts) } : null),
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  submits.length = 0
  let stopped = false
  badge.props.onClick({ stopPropagation: () => { stopped = true } })
  delete globalThis.document

  assert.equal(stopped, true, 'the badge click never reaches the pill')
  assert.equal(submits.length, 0, 'jumping is not sending')
  assert.equal(jumps.length, 1, 'it scrolls the offering reply into view')
  assert.equal(jumps[0].block, 'center')
})

test('carry: a missing offering reply notifies instead of throwing', () => {
  const s = 'carry-gone'
  render(register({ attrs: { carry: '1', q1: 'A' }, sessionId: s, source: 'z1' }))
  const el = render(register({ attrs: { carry: '1', q1: 'B' }, sessionId: s, source: 'z2' }))
  globalThis.document = { getElementById: () => null, createElement: () => ({ id: '', textContent: '' }), head: { appendChild: () => {} } }
  submits.length = 0
  ageBadge(staleRows(el)[0]).props.onClick({ stopPropagation: () => {} })
  delete globalThis.document
  assert.equal(submits.length, 1)
  assert.equal(submits[0][0], 'notify')
})

test('carry: pressing the pill with the keyboard sends it, Enter and Space alike', () => {
  const s = 'carry-keys'
  render(register({ attrs: { carry: '1', q1: 'A' }, sessionId: s, source: 'y1' }))
  const el = render(register({ attrs: { carry: '1', q1: 'B' }, sessionId: s, source: 'y2' }))
  const pill = staleButton(staleRows(el)[0])
  assert.equal(pill.props.role, 'button')
  assert.equal(pill.props.tabIndex, 0)
  submits.length = 0
  let prevented = 0
  pill.props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented += 1 } })
  pill.props.onKeyDown({ key: ' ', preventDefault: () => { prevented += 1 } })
  assert.deepEqual(submits, [[s, 'A'], [s, 'A']])
  assert.equal(prevented, 2, 'space must not also scroll the transcript')
})

/* ---- report ------------------------------------------------------------- */
/* Root plugin.js is the single-file copy of this same renderer. Two copies drift
   silently, so the harness fails the moment they differ. */
test('root plugin.js is byte-identical to desktop/plugin.js', () => {
  const root = readFileSync(resolve(here, '..', 'plugin.js'), 'utf8')
  const desktop = readFileSync(pluginSource, 'utf8')
  assert.equal(root === desktop, true, 'run: cp desktop/plugin.js plugin.js')
})

rmSync(dir, { recursive: true, force: true })
const failed = results.filter((r) => r[0] === 'fail')
for (const [state, name, detail] of results) {
  console.log((state === 'ok' ? 'ok   ' : 'FAIL ') + name + (detail ? '\n       ' + detail : ''))
}
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed')
process.exit(failed.length ? 1 : 0)
