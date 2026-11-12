// followup-chips: clickable follow-up question chips inside the transcript.
// The agent ends a reply with a paragraph alone on its own line:
//   ::followups{q1="..." q2="..." q3="..."}
// Each qN renders as a chip; click sends it as the next user turn.
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
   ctx.storage so choices survive window reloads. */
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
    all[key] = { chosen: g.chosen }
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
        if (v && typeof v === 'object' && v.chosen != null) {
          group(key).chosen = v.chosen
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
    g = { chosen: null, running: false, listeners: new Set() }
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

function running(key) {
  const g = groups.get(key)
  return g ? g.running : false
}

function Chip(props) {
  const q = props.q
  const idx = props.idx
  const sessionKey = props.sessionKey
  const onSend = props.onSend
  ensureArcStyle()
  const chosen = useGroupState(sessionKey)
  const isChosen = chosen === idx
  const isRunning = isChosen && runningState(sessionKey)
  const [hover, setHover] = useState(false)
  const primary = 'var(--dt-primary, var(--accent, var(--foreground)))'
  const className =
    'fu-chip' + (isChosen ? ' fu-chosen' : '') + (isRunning ? ' fu-running' : '')
  return jsx(
    'button',
    {
      type: 'button',
      className: className,
      onClick: function () {
        onSend(q, idx)
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
        border: isChosen
          ? '1px solid color-mix(in srgb, ' + primary + ' 55%, transparent)'
          : hover
            ? '1px solid color-mix(in srgb, ' + primary + ' 55%, transparent)'
            : '1px solid var(--ui-stroke-secondary, var(--border))',
        borderRadius: '12px',
        background: isChosen
          ? 'color-mix(in srgb, ' + primary + ' 7%, transparent)'
          : hover
            ? 'color-mix(in srgb, ' + primary + ' 7%, transparent)'
            : 'transparent',
        color: isChosen || hover ? primary : 'var(--ui-text-secondary, var(--foreground))',
        opacity: isChosen ? 1 : chosen != null ? 0.72 : 1,
        padding: '5px 12px',
        fontSize: '0.9em',
        textAlign: 'left',
        width: 'fit-content',
        maxWidth: '100%',
        lineHeight: 1.35,
        transition: 'border-color 160ms ease, background 160ms ease, color 160ms ease, opacity 160ms ease',
      },
      children: [
        (isChosen ? '✓ ' : '') + q,
        jsx('span', { key: 'arc', className: 'fu-arc', 'aria-hidden': 'true' }),
      ],
    },
    'chip' + idx
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
  if (qs.length === 0) return null

  function send(q, idx) {
    var submit = host && host.composer && host.composer.submit
    var sent = typeof submit === 'function' ? submit(sessionId != null ? sessionId : null, q) : false
    if (sent) {
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

  return jsx('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: '6px',
      margin: '6px 0 2px 0',
    },
    children: qs.map(function (q, i) {
      return jsx(Chip, {
        key: String(i) + ':' + q,
        q: q,
        idx: i,
        sessionKey: groupKey,
        onSend: send,
      })
    }),
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
