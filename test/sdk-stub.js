/**
 * Stand-in for the app's `@hermes/plugin-sdk` module, so the plugin renders
 * and submits outside Hermes (tests + demo). Mirrors the real surface the
 * plugin uses: TRANSCRIPT_DIRECTIVE_AREA, host.composer.submit, host.notify,
 * ctx.onEvent and ctx.storage (sync get/set).
 */
export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directives'

const submissions = []
const requests = []
let busy = false
let requestResult = null

export const host = {
  composer: {
    /** Mirrors the real contract: returns true when accepted. */
    submit: function (sessionId, text) {
      submissions.push({ sessionId, text, at: Date.now() })
      return true
    },
  },
  notify: function (msg) {
    submissions.push({ notify: msg })
  },
  /** The desktop bus used by Steer. Requests are logged so a test can prove
      session.steer was called and prompt.submit was not. */
  request: function (method, params) {
    requests.push({ method, params })
    return requestResult ? requestResult(method, params) : Promise.resolve({ status: 'queued' })
  },
  state: { busyBySession: { get: function () { return busy ? { 'sess-1': true } : {} } } },
}

export function requestLog() { return requests }
export function resetRequestLog() { requests.length = 0 }
export function setBusy(value) { busy = Boolean(value) }
export function resetBusy() { busy = false; requestResult = null }
export function setRequestResult(fn) { requestResult = fn }

/** Reads like the real one: submissions[submissions.length - 1]. */
export function lastSubmission() {
  return submissions.length ? submissions[submissions.length - 1] : null
}

export function resetSubmissionLog() {
  submissions.length = 0
}

/** The plugin registers itself against a ctx like this in tests/demo. */
export function makeCtx() {
  const handlers = {}
  const store = new Map()
  const registered = []
  return {
    onEvent: function (name, fn) {
      handlers[name] = handlers[name] || []
      handlers[name].push(fn)
    },
    emitEvent: function (name, payload) {
      ;(handlers[name] || []).forEach(function (fn) {
        fn(payload)
      })
    },
    register: function (contrib) {
      registered.push(contrib)
    },
    registered,
    storage: {
      get: function (key, fallback) {
        return store.has(key) ? store.get(key) : fallback
      },
      set: function (key, value) {
        store.set(key, value)
      },
    },
    _store: store,
  }
}
