// followup-chips: clickable follow-up question chips inside the transcript.
// The agent ends a reply with a paragraph alone on its own line:
//   ::followups{q1="..." q2="..." q3="..."}
// Each qN renders as a chip; click sends it as the next user turn.
// Add multi="1" to let several chips be picked and sent as one turn:
//   ::followups{multi="1" q1="..." q2="..." q3="..."}
// Add rec="1,3" (1-based q numbers) to mark the options a ranker put first:
// those chips carry a Recommended tag and start out picked.
import { TRANSCRIPT_DIRECTIVE_AREA, host } from '@hermes/plugin-sdk'
import { useState, useEffect } from 'react'
import { jsx } from 'react/jsx-runtime'

function ensureArcStyle() {
  if (typeof document === 'undefined' || document.getElementById('followup-chips-arc-style')) return
  const style = document.createElement('style')
  style.id = 'followup-chips-arc-style'
  /* Mirrors the app's .arc-border pair: a masked ring wrapper (.fu-arc) plus a
     240% gradient ::before translated by keyframes. Two layers, never merged —
     merging puts inset and width:240% on one element and the ring pumps. */
  style.textContent = [
    '@keyframes fu-arc-border{0%{transform:translate(0,0)}100%{transform:translate(-50%,-50%)}}',
    '.fu-chip{position:relative}',
    '.fu-chip .fu-arc{pointer-events:none;position:absolute;overflow:hidden;',
    'border-radius:calc(12px + 0.125rem);inset:-0.125rem;padding:0.078125rem;',
    'opacity:0;transition:opacity 160ms ease;',
    '--arc-c0:color-mix(in srgb,var(--dt-primary,var(--accent,#f59e0b)) 0%,transparent);',
    '--arc-c1:var(--dt-primary,var(--accent,#f59e0b));',
    '--arc-c2:color-mix(in srgb,var(--dt-primary,var(--accent,#f59e0b)) 45%,transparent);',
    'mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);',
    '-webkit-mask-composite:xor;mask-composite:exclude;}',
    '.fu-chip:hover .fu-arc,.fu-chip.fu-running .fu-arc{opacity:1}',
    '.fu-chip.fu-chosen:not(.fu-running):not(:hover) .fu-arc{opacity:0}',
    '.fu-chip .fu-arc::before{content:"";position:absolute;top:0;left:0;width:240%;height:240%;',
    'background:repeating-linear-gradient(160deg,transparent 0%,transparent 18.75%,',
    'var(--arc-c1,#f59e0b) 25%,var(--arc-c2,transparent) 31.25%,',
    'transparent 43.75%,transparent 50%);',
    'will-change:transform;animation:fu-arc-border 2.23s linear infinite;}',
  ].join('')
  document.head.appendChild(style)
}

/* Per-session chip state: which chip was chosen, and whether the agent is still
   answering that session (arc keeps running until message.complete). Backed by
   ctx.storage so choices survive window reloads.
   `chosen` is the single-select index (null when nothing was sent); `picked` is
   the multi-select list of indexes; `sent` records that a block's picks were
   submitted as one turn. */
const groups = new Map()

let storage = null /* bound in register */
/* Only the most recent choice may run its arc; every older block keeps its
   ✓ but rests. */
let activeKey = null

function setActive(key) {
  activeKey = key
  groups.forEach(function (g, k) {
    if (k !== key && g.running) g.running = false
  })
}

function persistChoice(key, g) {
  if (!storage) return
  try {
    const all = storage.get('choices', {}) || {}
    all[key] = { chosen: g.chosen, picked: g.picked, sent: g.sent, touched: g.touched }
    storage.set('choices', all)
  } catch (e) {
    /* persistence is best-effort */
  }
}

function hydrate() {
  if (!storage) return
  try {
    const all = storage.get('choices', null)
    if (all && typeof all === 'object') {
      Object.keys(all).forEach(function (key) {
        const v = all[key]
        if (v && typeof v === 'object') {
          const g = group(key)
          /* A stored entry means this block has been used (or was seeded), so the
             recommended defaults must never run over it again. */
          g.touched = true
          if (v.chosen != null) g.chosen = v.chosen
          if (Array.isArray(v.picked)) {
            g.picked = v.picked.filter(function (n) {
              return typeof n === 'number' && n >= 0
            })
          }
          if (v.sent === true) g.sent = true
        }
      })
    }
  } catch (e) {
    /* start fresh on corrupt state */
  }
}

function group(key) {
  let g = groups.get(key)
  if (!g) {
    g = { chosen: null, picked: [], sent: false, touched: false, running: false, listeners: new Set() }
    groups.set(key, g)
  }
  return g
}

function emit(key) {
  const g = groups.get(key)
  if (g) g.listeners.forEach(function (fn) { fn() })
}

function subscribe(key, fn) {
  const g = group(key)
  g.listeners.add(fn)
  return function () {
    g.listeners.delete(fn)
  }
}

function snapshot(key) {
  const g = groups.get(key)
  return g ? g.chosen : null
}

function pickedOf(key) {
  const g = groups.get(key)
  return g ? g.picked : []
}

function sentOf(key) {
  const g = groups.get(key)
  return g ? g.sent : false
}

function running(key) {
  const g = groups.get(key)
  return g ? g.running : false
}

/* Tri-state: true = pick several, false = one click sends, null = the caller decides.
   `multi="0"` (or false/no/off) opts a block out of picking. */
function isMulti(value) {
  if (value === true) return true
  if (value === false) return false
  if (value == null) return null
  const text = String(value).trim()
  if (/^(0|false|no|off)$/i.test(text)) return false
  if (/^(1|true|yes|on)$/i.test(text)) return true
  return null
}

/* accent="0" drops the recommended tint. Absent means on: the agent half only
   stamps the attribute when the owner turned the setting off, because renderer
   code cannot read plugin settings. */
function accentOn(value) {
  if (value == null) return true
  if (value === false) return false
  return !/^(0|false|no|off)$/i.test(String(value).trim())
}

/* rec="1,3" → [0, 2]. 1-based so it lines up with the qN an agent writes; junk,
   zero and out-of-range numbers are dropped instead of trusted. */
function parseRec(value, count) {
  if (value == null) return []
  const raw = Array.isArray(value) ? value : String(value).split(/[\s,;]+/)
  const out = []
  raw.forEach(function (item) {
    if (!/^\d+$/.test(String(item).trim())) return
    const idx = parseInt(String(item).trim(), 10) - 1
    if (idx >= 0 && idx < count && out.indexOf(idx) === -1) out.push(idx)
  })
  return out.sort(function (a, b) {
    return a - b
  })
}

const REC_MARK = {
  fontSize: '0.85em',
  fontWeight: 600,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  padding: '1px 7px',
  borderRadius: '999px',
  whiteSpace: 'nowrap',
  lineHeight: 1.35,
}

function Chip(props) {
  const q = props.q
  const idx = props.idx
  const sessionKey = props.sessionKey
  const multi = props.multi
  const active = props.active
  const onSend = props.onSend
  const onToggle = props.onToggle
  ensureArcStyle()
  const chosen = useGroupState(sessionKey)
  const picked = usePickedState(sessionKey)
  const isChosen = !multi && chosen === idx
  const isPicked = multi && picked.indexOf(idx) !== -1
  const isRunning = isChosen && runningState(sessionKey)
  const [hover, setHover] = useState(false)
  const primary = 'var(--dt-primary, var(--accent, var(--foreground)))'
  const marked = isChosen || isPicked
  /* A recommended option keeps the accent even when it is not picked, so the
     suggested steps read as one group. accent="0" (from the plugin setting) drops
     that tint and leaves the Recommended tag alone. */
  const accented = props.accent !== false && props.recommended === true
  /* In multi-select nothing is sent on a chip, so an unanswered block keeps
     every chip at full strength; single-select dims the ones you passed over. */
  const dimmed = multi ? !active : chosen != null && !isChosen
  const className =
    'fu-chip' + (marked ? ' fu-chosen' : '') + (isRunning ? ' fu-running' : '') + (accented ? ' fu-recommended' : '')
  /* Three tints, strongest last: hover hints, a recommendation is accented, a
     pick is the loudest. One scale so the three states never fight. */
  const stroke = marked ? 75 : accented ? 70 : hover ? 55 : 0
  const tint = marked ? 14 : accented ? 11 : hover ? 7 : 0
  return jsx(
    'button',
    {
      type: 'button',
      className: className,
      'aria-pressed': multi ? isPicked : undefined,
      onClick: function () {
        if (multi) onToggle(idx)
        else onSend(q, idx)
      },
      onMouseEnter: function () {
        setHover(true)
      },
      onMouseLeave: function () {
        setHover(false)
      },
      title: q,
      style: {
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        boxSizing: 'border-box',
        border: stroke
          ? '1px solid color-mix(in srgb, ' + primary + ' ' + stroke + '%, transparent)'
          : '1px solid var(--ui-stroke-secondary, var(--border))',
        borderRadius: '12px',
        background: tint ? 'color-mix(in srgb, ' + primary + ' ' + tint + '%, transparent)' : 'transparent',
        color: stroke ? primary : 'var(--ui-text-secondary, var(--foreground))',
        opacity: dimmed ? 0.72 : 1,
        padding: '5px 12px',
        fontSize: '0.9em',
        textAlign: 'left',
        /* No width: the row is a one-column grid sized to its widest chip, so every
           chip stretches to that width instead of each sizing to its own text. */
        maxWidth: '100%',
        lineHeight: 1.35,
        transition: 'border-color 160ms ease, background 160ms ease, color 160ms ease, opacity 160ms ease',
      },
      children: [
        jsx('span', {
          key: 'label',
          style: { display: 'inline-flex', alignItems: 'baseline' },
          children: [
            /* The tick is always laid out, only hidden when unmarked: reserving it
               keeps the pill width still when a pick adds the glyph. */
            jsx('span', {
              key: 'tick',
              'aria-hidden': 'true',
              style: { visibility: marked ? 'visible' : 'hidden' },
              children: '✓ ',
            }),
            jsx('span', { key: 'q', children: q }),
          ],
        }),
        props.recommended
          ? jsx('span', {
              key: 'rec',
              style: Object.assign({}, REC_MARK, {
                marginLeft: 'auto',
              }, accented
                ? {
                    /* Darkened against the foreground so the small uppercase text
                       clears 4.5:1 on its own 10% fill (the raw accent measured
                       4.35:1). */
                    color: 'color-mix(in srgb, ' + primary + ' 76%, var(--foreground, #111) 24%)',
                    background: 'color-mix(in srgb, ' + primary + ' 10%, transparent)',
                  }
                : {
                    /* accent="0" means no accent anywhere on a recommendation. The tag
                       goes neutral too, otherwise turning the setting off would be
                       invisible on a pre-picked chip, where the pick tint dominates. */
                    color: 'var(--ui-text-secondary, var(--foreground))',
                    background: 'color-mix(in srgb, var(--ui-stroke-secondary, var(--border)) 55%, transparent)',
                  }),
              children: 'Recommended',
            })
          : null,
        jsx('span', { key: 'arc', className: 'fu-arc', 'aria-hidden': 'true' }),
      ],
    },
    'chip' + idx
  )
}

/* The only submit path in multi-select. It carries the arc while the agent
   answers, so the block still shows which turn is in flight. */
function Send(props) {
  const sessionKey = props.sessionKey
  const count = props.count
  const sent = props.sent
  const onSend = props.onSend
  ensureArcStyle()
  const isRunning = sent && runningState(sessionKey)
  const [hover, setHover] = useState(false)
  const primary = 'var(--dt-primary, var(--accent, var(--foreground)))'
  const disabled = count === 0 || sent
  const live = hover && !disabled
  return jsx(
    'button',
    {
      type: 'button',
      className: 'fu-chip fu-send' + (isRunning ? ' fu-running' : ''),
      disabled: disabled,
      onClick: function () {
        if (!disabled) onSend()
      },
      onMouseEnter: function () {
        setHover(true)
      },
      onMouseLeave: function () {
        setHover(false)
      },
      title: sent ? 'Sent' : count === 0 ? 'Pick one or more' : 'Send the picked steps as one message',
      style: {
        cursor: disabled ? 'default' : 'pointer',
        /* Its own width: the row's common width belongs to the pills. */
        justifySelf: 'start',
        border: '1px solid color-mix(in srgb, ' + primary + ' ' + (disabled ? '28%' : '55%') + ', transparent)',
        borderRadius: '12px',
        background: disabled
          ? 'transparent'
          : live
            ? 'color-mix(in srgb, ' + primary + ' 16%, transparent)'
            : 'color-mix(in srgb, ' + primary + ' 9%, transparent)',
        color: disabled ? 'var(--ui-text-secondary, var(--foreground))' : primary,
        opacity: disabled ? 0.55 : 1,
        padding: '5px 14px',
        marginTop: '2px',
        fontSize: '0.9em',
        fontWeight: 500,
        lineHeight: 1.35,
        transition: 'border-color 160ms ease, background 160ms ease, color 160ms ease, opacity 160ms ease',
      },
      children: [
        sent ? '✓ Sent' : count === 0 ? 'Send' : 'Send ' + count,
        jsx('span', { key: 'arc', className: 'fu-arc', 'aria-hidden': 'true' }),
      ],
    },
    'send'
  )
}

/* Re-render hook: subscribes the component to its session's chip state. */
function useGroupState(key) {
  const [, force] = useState(0)
  useEffect(
    function () {
      return subscribe(key, function () {
        force(function (n) {
          return n + 1
        })
      })
    },
    [key]
  )
  return snapshot(key)
}

function usePickedState(key) {
  useGroupState(key)
  return pickedOf(key)
}

function runningState(key) {
  return running(key)
}

function Chips(props) {
  const attrs = (props && props.attrs) || {}
  const sessionId = props && props.sessionId
  /* Unique per directive block: session + the raw directive source text. Each
     followups block starts blank; a chosen state never leaks into the next one. */
  const source = (props && props.source) || ''
  const groupKey = (sessionId || 'current') + '::' + source
  /* Any count: q1..qN in numeric order, no hard limit. */
  const qs = Object.keys(attrs)
    .filter(function (k) {
      return /^q\d+$/.test(k)
    })
    .sort(function (a, b) {
      return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)
    })
    .map(function (k) {
      return attrs[k]
    })
    .filter(function (q) {
      return typeof q === 'string' && q.length > 0
    })
  /* Two or more chips are pickable unless the directive says otherwise. A block
     that defaulted to one-click-sends made picking two next steps send two turns
     and queue them; multi="0" is the opt-out for genuinely exclusive options. */
  const multi = isMulti(attrs.multi) !== false && qs.length > 1
  if (qs.length === 0) return null

  const rec = parseRec(attrs.rec, qs.length)
  const accent = accentOn(attrs.accent)
  /* Recommended options start picked, exactly once. A stored entry or any later
     tick counts as touched, so a user who unticks them is never overruled by the
     defaults coming back on the next render. */
  const g = group(groupKey)
  if (multi && rec.length && !g.touched && !g.sent) {
    g.picked = rec.slice()
    g.touched = true
  }

  const picked = usePickedState(groupKey)
  const sent = sentOf(groupKey)
  const active = multi ? !sent : snapshot(groupKey) == null

  function send(q, idx) {
    var submit = host && host.composer && host.composer.submit
    var ok = typeof submit === 'function' ? submit(sessionId != null ? sessionId : null, q) : false
    if (ok) {
      const g = group(groupKey)
      g.chosen = idx
      g.running = true
      setActive(groupKey)
      persistChoice(groupKey, g)
      emit(groupKey)
      groups.forEach(function (_, k) {
        if (k !== groupKey) emit(k)
      })
    } else if (host && host.notify) {
      host.notify({ kind: 'warning', message: 'Open that chat to continue' })
    }
  }

  /* One turn carries every picked chip, in q order, one per line: the agent
     reads it as a person asking for several things at once. */
  function sendPicked() {
    const text = qs
      .filter(function (q, i) {
        return picked.indexOf(i) !== -1
      })
      .join('\n')
    if (!text) return
    var submit = host && host.composer && host.composer.submit
    var ok = typeof submit === 'function' ? submit(sessionId != null ? sessionId : null, text) : false
    if (ok) {
      const g = group(groupKey)
      g.sent = true
      g.running = true
      setActive(groupKey)
      persistChoice(groupKey, g)
      emit(groupKey)
      groups.forEach(function (_, k) {
        if (k !== groupKey) emit(k)
      })
    } else if (host && host.notify) {
      host.notify({ kind: 'warning', message: 'Open that chat to continue' })
    }
  }

  function toggle(idx) {
    const g = group(groupKey)
    if (g.sent) return
    if (g.picked.indexOf(idx) === -1) {
      g.picked = g.picked.concat([idx]).sort(function (a, b) { return a - b })
    } else {
      g.picked = g.picked.filter(function (n) { return n !== idx })
    }
    persistChoice(groupKey, g)
    emit(groupKey)
  }

  const rows = qs.map(function (q, i) {
    return jsx(Chip, {
      key: String(i) + ':' + q,
      q: q,
      idx: i,
      multi: multi,
      active: active,
      recommended: rec.indexOf(i) !== -1,
      accent: accent,
      sessionKey: groupKey,
      onSend: send,
      onToggle: toggle,
    })
  })

  if (multi) {
    rows.push(
      jsx(Send, {
        key: 'send',
        sessionKey: groupKey,
        count: picked.length,
        sent: sent,
        onSend: sendPicked,
      })
    )
  }

  return jsx('div', {
    style: {
      /* One implicit column sized to the widest chip: every chip stretches to it,
         so all pills share a width and the narrowest option is not a stub. The
         single column also means a very long option is capped by the row, and its
         text wraps inside the pill rather than pushing the row wide. */
      display: 'grid',
      gridTemplateColumns: 'minmax(0, max-content)',
      gap: '6px',
      margin: '6px 0 2px 0',
    },
    children: rows,
  })
}

const plugin = {
  id: 'followup-chips',
  name: 'Follow-up chips',
  description: 'Clickable follow-up question chips after assistant replies',
  register: function register(ctx) {
    storage = (ctx && ctx.storage) || null
    hydrate()
    const area =
      typeof TRANSCRIPT_DIRECTIVE_AREA === 'string' && TRANSCRIPT_DIRECTIVE_AREA
        ? TRANSCRIPT_DIRECTIVE_AREA
        : 'transcript.directives'
    if (typeof ctx.onEvent === 'function') {
      /* Settle every block of the session: keys are `<sessionId>::<source>`. */
      const settle = function (sid) {
        const prefix = (sid || 'current') + '::'
        groups.forEach(function (g, key) {
          if (key.indexOf(prefix) === 0 && g.running) {
            g.running = false
            if (activeKey === key) activeKey = null
            emit(key)
          }
        })
      }
      ctx.onEvent('message.complete', settle)
      /* A fresh user/assistant exchange also settles any stuck running state. */
      ctx.onEvent('message.start', settle)
    }
    ctx.register({
      id: 'followups',
      area: area,
      data: {
        name: 'followups',
        render: function render(args) {
          return jsx(Chips, {
            attrs: args && args.attrs,
            sessionId: args && args.sessionId,
            source: args && args.source,
          })
        },
      },
    })
  },
}

export default plugin
