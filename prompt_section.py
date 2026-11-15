"""The plugin's own system-prompt section: end a choice with chips, not prose.

Hermes freezes it into each new session's prompt under "## Plugin Context: <name>".
The section is told the session's platform: Hermes Desktop gets the chip rule, every
other surface (Telegram, the CLI, ...) is told to offer a numbered list instead,
because a raw ::followups line would arrive as text there.

On the Desktop the rule prefers the `followup_chips` tool: the options travel as
arguments, so nothing has to be escaped and an invalid option is caught before it
reaches the reply. The directive form stays documented as the fallback, because a
model without tool calling still has to be able to produce chips.

When a decision classifier is available the rule also says to ask it which options
are worth taking now, so the reply arrives with the likely steps already picked
instead of making the user read five chips first.
"""

from __future__ import annotations

# Surfaces where the desktop half draws the directive.
DRAWS = frozenset({"local", "desktop"})

MAX_CHARS = 2_200

DESKTOP = (
    "This chat draws follow-up chips under a reply. When the next step is a choice, "
    "do not ask for it in prose: never end with \"say the word and I'll...\", "
    "\"want me to...?\", \"shall I...?\", a \"let me know\" line, or a list of things you "
    "could do next.\n"
    "Call followup_chips with 2 to 5 imperative, specific options under 120 characters "
    "each, most likely first, and do not write any ::followups line yourself: the "
    "plugin attaches the chips to the reply you are about to write. Chips are picked and "
    "sent together by default, so pass multi=false only when the options are exclusive, "
    "because a picked row lets the user send two contradicting steps as one message. "
    "When some options exclude each other but the rest can be combined, pass alternates "
    "as pairs of 1-based numbers, so a click clears its opposite instead of sending both: "
    "[[1, 3]] means options 1 and 3 cannot both be picked. An option that means leaving "
    "things as they are is opposed to every action, and that pairing is applied even when "
    "you pass nothing, so say it in the labels rather than the prose. "
    "Never offer an option you would not do as it stands.\n"
    "If you cannot call tools, end instead with this directive alone on its own line, one "
    "qN per option; add multi=\"0\" only for an exclusive choice, and alt=\"1,3\" for "
    "options that cannot be picked together while the rest can:\n"
    "::followups{q1=\"Push the branch and open the PR\" q2=\"Add a CHANGELOG entry\"}\n"
    "Never put a directive inside a sentence, a list or a code block, and never write it "
    "twice. Put what you did in the prose; the chips carry what can follow."
)

OTHER = (
    "This surface cannot draw follow-up chips, so never write a ::followups directive "
    "and never call followup_chips here. When offering next steps, end with a short "
    "numbered list of concrete options instead of an open question."
)

RECOMMEND = (
    " When the chips are a real choice rather than an obvious next step, pass "
    "recommend=true so the decision classifier marks the options worth taking now; they "
    "carry a Recommended tag and start out picked, so recommend only options you would "
    "be happy for the user to send as they stand. On the text-directive path, "
    "followup_recommend returns the same verdict as an attribute to paste (rec=\"1,3\")."
)


def chips_rule(session: dict, recommends: bool = False) -> str:
    """The section's text for one session: the chip rule on the app, text-only elsewhere.

    {"platform": "local"} → DESKTOP;  with a classifier → DESKTOP + RECOMMEND;
    {"platform": "telegram"} → OTHER;  {} → OTHER
    """
    session = session or {}
    if session.get("platform") in DRAWS:
        return DESKTOP + (RECOMMEND if recommends else "")
    return OTHER
