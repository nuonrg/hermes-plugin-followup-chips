"""Turn a reply that offers next steps in prose into a ::followups directive.

Hermes Desktop draws chips for a `::followups{q1="…"}` paragraph; the plugin asks
the model to end a choice with that directive (see prompt_section.py). When a
model writes the offer as text anyway — "say the word and I'll push the branch",
"want me to run the tests?" — this module moves it into the directive so the
reply gets a card instead of a sentence nobody can click.

Pure text in, text out: no network, no model call, no state, and nothing happens
off Hermes Desktop. A reply that does not read as a closing offer is returned
untouched (None), never rewritten on a guess.
"""

from __future__ import annotations

import hashlib
import re

# Surfaces that draw transcript directives: the Desktop app and its local session.
DRAWS = frozenset({"local", "desktop"})

DIRECTIVE_RE = re.compile(r"::followups\s*\{")

# Split a directive into its opening, its attributes and its closing brace, so a
# stamp can add one attribute and leave everything else exactly as written.
_DIRECTIVE_BODY_RE = re.compile(r"(::followups\s*\{)([^}]*)(\})")

# The closing-offer vocabulary. Deliberately narrow: a bare "I'll …" is a
# statement of intent, not an offer, so it stays out of this list (it is only
# stripped from an option once a real trigger has matched).
TRIGGER_RE = re.compile(
    r"(?:\b(?:say|just say|give me|need)\s+the\s+(?:word|go-ahead|go)\b"
    r"|\bjust say (?:go|yes|when)\b"
    r"|\b(?:if|once) you say (?:the word|go|yes)\b"
    r"|\b(?:on|at) your (?:word|say|go|go-ahead)\b"
    r"|\b(?:do )?you want me to\b"
    r"|\bwould you like me to\b"
    r"|\bwant me to\b"
    r"|\bshall i\b"
    r"|\bshould i\b"
    r"|\bi (?:can|could) also\b"
    r"|\bi(?:'d| would) be (?:happy|glad) to\b"
    r"|\b(?:happy|glad) to\b"
    r"|\blet me know if you(?:'d| would)? (?:want|like|need)\b"
    r"|\bif you(?:'d| would)? (?:want|like)\b)",
    re.IGNORECASE,
)

# Leading filler removed when a whole sentence becomes one option.
LEADINS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"say the word and i(?:'ll| will)\s+",
        r"just say (?:the word|go|yes)(?: and i(?:'ll| will)\s+)?",
        r"(?:give me|need) the (?:word|go-ahead|go) and i(?:'ll| will)\s+",
        r"(?:if|once) you say (?:the word|go|yes),? and i(?:'ll| will)\s+",
        r"(?:do )?you want me to\s+",
        r"would you like me to\s+",
        r"want me to\s+",
        r"shall i\s+",
        r"should i\s+",
        r"i (?:can|could) also\s+",
        r"i(?:'d| would) be (?:happy|glad) to\s+",
        r"(?:happy|glad) to\s+",
        r"let me know if you(?:'d| would)? (?:want|like|need)(?: me to)?\s+",
        r"i(?:'ll| will)\s+",
    )
)

# Trailing qualifiers that read as the offer, not the work.
TRAILERS = re.compile(
    r"(?:[\s,]+(?:if|when|once|whenever)\s+(?:you(?:'d| would)? (?:like|want|prefer|say so)"
    r"|you(?:'re| are) ready|you say (?:the word|go|yes))"
    r"|[\s,]+on your (?:word|say|go)"
    r"|[\s,]+at your (?:word|say|go)"
    r"|[\s,]+any ?time)[.?!]*$",
    re.IGNORECASE,
)

BULLET_RE = re.compile(r"^\s*(?:[-*•·]|\d{1,2}[.)])\s+(.+?)\s*$")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[\"'“(\[]?[A-Z0-9])")

MAX_OPTIONS = 6
MIN_OPTION_CHARS = 3
MAX_OPTION_CHARS = 120
MAX_SENTENCE_CHARS = 220


def _sane(text: str) -> str:
    """One option, safe to put inside a directive attribute: no quotes, braces or
    line breaks, single-spaced."""
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    cleaned = cleaned.replace('"', "'").replace("{", "(").replace("}", ")")
    return cleaned


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in SENTENCE_SPLIT_RE.split(text.strip()) if s.strip()]


def _strip_option(sentence: str) -> str | None:
    """'Want me to run the tests?' → 'Run the tests'. None when nothing matched."""
    original = sentence.strip()
    text = original
    stripped = False
    changed = True
    while changed:
        changed = False
        for lead in LEADINS:
            match = lead.match(text)
            if match:
                text = text[match.end():]
                changed = stripped = True
    trimmed = TRAILERS.sub("", text)
    if trimmed != text:
        text = trimmed
        stripped = True
    text = text.strip().strip("\"'“”‘’").strip()
    text = text.rstrip(".?!:;, ")
    if not stripped or not text:
        return None
    text = text[0].upper() + text[1:]
    if not any(ch.isalpha() for ch in text):
        return None
    if len(text) < MIN_OPTION_CHARS or len(text) > MAX_OPTION_CHARS:
        return None
    return text


def _clean(options: list[str]) -> list[str]:
    """Sane, de-duplicated options in order, capped; keeps the list usable or drops it."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in options:
        option = _sane(raw)
        if not option:
            continue
        if len(option) > MAX_OPTION_CHARS:
            option = option[: MAX_OPTION_CHARS - 1].rstrip(" ,;:") + "…"
        key = option.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(option)
    return out[:MAX_OPTIONS]


def _drop_trigger_sentences(text: str) -> str:
    """The block's prose with the lead-in sentences ("Want me to pick one?") gone."""
    kept = [s for s in _sentences(text) if not TRIGGER_RE.search(s)]
    return " ".join(kept).strip()


def _parse_block(block: str) -> tuple[list[str], str] | None:
    """(options, leftover text) for the closing block, or None when it is not an offer."""
    if not TRIGGER_RE.search(block):
        return None
    lines = block.split("\n")
    bullets: list[str] = []
    prose: list[str] = []
    for line in lines:
        match = BULLET_RE.match(line)
        if match:
            bullets.append(match.group(1))
        else:
            prose.append(line)
    prose_text = "\n".join(prose).strip()

    if bullets:
        options = _clean(bullets)
        if options:
            return options, _drop_trigger_sentences(prose_text)

    if not prose_text:
        return None
    sentences = _sentences(prose_text)
    at = None
    for i in range(len(sentences) - 1, -1, -1):
        if TRIGGER_RE.search(sentences[i]):
            at = i
            break
    if at is None or len(sentences[at]) > MAX_SENTENCE_CHARS:
        return None
    option = _strip_option(sentences[at])
    if not option:
        return None
    kept = " ".join(sentences[:at] + sentences[at + 1:]).strip()
    return _clean([option]), kept


def plan(text: str) -> tuple[str, list[str]] | None:
    """(reply without the offer, the offer's options) or None when there is no offer.

    Only the last paragraph is considered: an offer in the middle of a reply is
    prose the author meant, not a closing prompt.
    "Done.\\n\\nWant me to push it?" → ("Done.", ["Push it"])
    """
    if not isinstance(text, str) or not text.strip():
        return None
    if DIRECTIVE_RE.search(text):
        return None
    blocks = text.split("\n\n")
    last = None
    for i in range(len(blocks) - 1, -1, -1):
        if blocks[i].strip():
            last = i
            break
    if last is None:
        return None
    parsed = _parse_block(blocks[last])
    if not parsed:
        return None
    options, leftover = parsed
    if not options:
        return None
    head = [b for b in blocks[:last] if b.strip()]
    if leftover:
        head.append(leftover)
    return "\n\n".join(head).strip(), options


def directive(options: list[str], multi: bool | None = None, rec: str = "") -> str:
    """The paragraph the renderer reads.

    Two or more chips are pickable, so the user can send them as one turn, and that
    is the default: ``multi=None`` means pickable whenever there is more than one
    option. A caller that knows better passes True or False, because a tool call can
    register three exclusive options and a directive that guessed from the count
    would let the user send two contradicting steps as one turn. ``multi=False`` is
    the opt-out, and a single chip carries no attribute because there is nothing to
    pick.

    ``rec`` is already-validated digits ("1,3") and rides the same brace as an attribute.

    ["Push it", "Open the PR"] -> '::followups{multi="1" q1="Push it" q2="Open the PR"}'
    """
    attrs = " ".join(
        'q{}=\"{}\"'.format(i + 1, _sane(option)) for i, option in enumerate(options)
    )
    if multi is None:
        multi = len(options) > 1
    if len(options) < 2:
        head = ""
    elif multi:
        head = 'multi="1" '
    else:
        head = 'multi="0" '
    if rec:
        head += 'rec="{}" '.format(rec)
    return "::followups{" + head + attrs + "}"


# One directive paragraph, balanced-ish: the renderer takes it to the closing brace.
_DIRECTIVE_BODY_RE = re.compile(r"(::followups\s*\{)([^}]*)(\})")


def stamp_accent(text: str, value: str = "0") -> str:
    """Put ``accent="<value>"`` into every directive that has no accent attribute.

    The renderer reads the accent as a per-directive preference, because a desktop
    plugin cannot read its own settings (the SDK exposes no settings surface to
    renderer code). The agent half knows the setting, so it stamps the off case and
    leaves the default alone: nothing is added unless the owner turned it off.

    Idempotent, and it never touches prose: no directive means the text comes back
    unchanged.
    """
    if not isinstance(text, str) or not text or not DIRECTIVE_RE.search(text):
        return text
    # A whitelist rather than _sane: _sane swaps quotes for apostrophes, which is
    # fine inside an option but leaves a broken attribute value.
    safe = re.sub(r"[^0-9a-zA-Z._-]", "", str(value))[:16] or "0"
    try:
        return _DIRECTIVE_BODY_RE.sub(
            lambda m: m.group(1) + m.group(2) + m.group(3)
            if re.search(r"\baccent\s*=", m.group(2))
            else m.group(1) + 'accent="{}" '.format(safe) + m.group(2) + m.group(3),
            text,
        )
    except Exception:  # a hook must never break a reply
        return text


def session_fingerprint(session: str) -> str:
    """A short, stable id for one chat, safe to write into the transcript.

    The queue is stored per session, so the block has to know which one it belongs
    to. The render prop can be empty, and an empty key used to mean one shared
    bucket that every chat wrote into; this fingerprint removes the guess. Twelve
    hex characters keep the raw session id out of the reply while still separating
    chats, and hashing is stable across restarts.
    """
    raw = str(session or "").strip()
    if not raw:
        return ""
    try:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]
    except Exception:  # a hook must never break a reply
        return ""


def stamp_multi(text: str) -> str:
    """Make two or more chips pickable unless the directive already says otherwise.

    The renderer defaults to pickable for a multi-option block, but writing the
    attribute means a renderer from before that rule agrees with a new one. A
    directive that already carries a `multi` (including the opt-out) is left as it
    is, and a single chip gets nothing because there is nothing to pick. Idempotent,
    and it never touches prose: no directive means the text comes back unchanged.
    """
    if not isinstance(text, str) or not text or not DIRECTIVE_RE.search(text):
        return text

    def one(match: "re.Match[str]") -> str:
        body = match.group(2)
        if re.search(r"\bmulti\s*=", body):
            return match.group(0)
        if len(re.findall(r"\bq\d+\s*=", body)) < 2:
            return match.group(0)
        return match.group(1) + 'multi="1" ' + body + match.group(3)

    try:
        return _DIRECTIVE_BODY_RE.sub(one, text)
    except Exception:  # a hook must never break a reply
        return text


def stamp_session(text: str, session: str = "") -> str:
    """Name the chat in the directive, so carried chips cannot cross chats.

    Applied to every directive this plugin emits, with or without chips: the block
    that carries proposals is the one that also records them. Idempotent, and it
    leaves the text alone when there is no session to name, because a made-up key
    is exactly the leak this prevents.
    """
    fingerprint = session_fingerprint(session)
    if not fingerprint or not isinstance(text, str) or not text:
        return text
    if not DIRECTIVE_RE.search(text):
        return text

    def one(match: "re.Match[str]") -> str:
        if re.search(r"\bsid\s*=", match.group(2)):
            return match.group(0)
        return match.group(1) + 'sid="' + fingerprint + '" ' + match.group(2) + match.group(3)

    try:
        return _DIRECTIVE_BODY_RE.sub(one, text)
    except Exception:  # a hook must never break a reply
        return text


def stamp_carry(text: str, platform: str = "") -> str:
    """Mark the reply's chips as carry-over, or add one empty block where there is none.

    The renderer cannot read plugin settings, so the agent half decides and stamps
    the attribute. Two shapes matter:

    - a reply that proposes something keeps its own chips and gets ``carry="1"``, so
      the block also draws whatever earlier replies left unanswered;
    - a reply that proposes nothing gets one empty block, because the directive slot
      is the only place a desktop plugin can draw. That empty block is what lets a
      chip-less response 2 still show the three proposals response 1 left alone.

    Desktop only: on another surface the directive line would arrive as raw text.
    Idempotent, and it never touches prose beyond appending that one line.
    """
    if not isinstance(text, str) or not text:
        return text
    if str(platform or "").strip().lower() not in DRAWS:
        return text
    try:
        if DIRECTIVE_RE.search(text):
            if re.search(r"\bcarry\s*=", text):
                return text
            return _DIRECTIVE_BODY_RE.sub(
                lambda m: m.group(1) + 'carry="1" ' + m.group(2) + m.group(3), text, count=1
            )
        return text.rstrip() + '\n\n::followups{carry="1"}'
    except Exception:  # a hook must never break a reply
        return text


def rewrite(text: str, platform: str = "") -> str | None:
    """The hint's own hook: the reply with its closing offer drawn as chips.

    None (leave the reply as it is) off Hermes Desktop, on a reply that already
    carries a directive, on a reply with no closing offer, and on any error.
    """
    if str(platform or "").strip().lower() not in DRAWS:
        return None
    try:
        planned = plan(text)
    except Exception:  # a hook must never break a reply
        return None
    if not planned:
        return None
    body, options = planned
    line = directive(options)
    out = (body + "\n\n" + line).strip() if body else line
    return out if out and out != text else None
