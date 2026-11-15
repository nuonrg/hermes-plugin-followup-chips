"""The plugin's own system-prompt section: end a choice with chips, not prose.

Hermes freezes it into each new session's prompt under "## Plugin Context: <name>".
The section is told the session's platform: Hermes Desktop gets the directive
rule, every other surface (Telegram, the CLI, …) is told to offer a numbered list
instead, because a raw ::followups line would arrive as text there.

When a decision classifier is available the Desktop rule also tells the agent to
ask it which options are worth taking now, so the reply arrives with the likely
steps already picked instead of making the user read five chips first.
"""

from __future__ import annotations

# Surfaces where the desktop half draws the directive.
DRAWS = frozenset({"local", "desktop"})

MAX_CHARS = 1_800

DESKTOP = (
    "This chat draws follow-up chips under a reply. When the next step is a choice, "
    "do not ask for it in prose: never end with \"say the word and I'll…\", "
    "\"want me to…?\", \"shall I…?\", a \"let me know\" line, or a list of things you "
    "could do next. End with this directive as the last paragraph of the reply, alone "
    "on its own line:\n"
    "::followups{q1=\"Push the branch and open the PR\" q2=\"Add a CHANGELOG entry\"}\n"
    "One qN per option, 2 to 5 of them, imperative and specific, under 120 characters "
    "each, most likely first. Two or more chips are picked and sent together by default; "
    "add multi=\"0\" only when the options are exclusive, because a picked row lets the "
    "user send two contradicting steps as one message. Never put the directive inside a sentence, "
    "a list or a code block, and never write it twice. Put what you did in the prose; the "
    "chips carry what can follow."
)

OTHER = (
    "This surface cannot draw follow-up chips, so never write a ::followups directive "
    "here. When offering next steps, end with a short numbered list of concrete options "
    "instead of an open question."
)

RECOMMEND = (
    " When the chips are a real choice rather than an obvious next step, call "
    "followup_recommend with the option texts and one line on what the user asked for, "
    "then write its rec attribute into the directive (rec=\"1,3\"). It can name more than "
    "one option when several steps belong together; those chips carry a Recommended tag "
    "and start out picked, so recommend only options you would be happy for the user to "
    "send as they stand."
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
