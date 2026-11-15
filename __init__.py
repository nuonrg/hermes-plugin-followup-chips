"""followup-chips: clickable follow-up chips, the rule that fills them, and the picker.

The desktop half (desktop/plugin.js) draws a `::followups{…}` paragraph as chips
under a reply. This half gives the model the rule that ends a choice with that
directive, converts a closing offer it wrote in prose anyway (opt-in), and exposes
`followup_recommend`, which asks the decision classifier which of the options are
worth taking now so the chips arrive pre-picked.

Both halves are optional: the plugin works as a single file dropped into
desktop-plugins/, where the model emits the directive on its own.
"""

from __future__ import annotations

from .offers import rewrite, stamp_accent, stamp_carry
from .prompt_section import MAX_CHARS, chips_rule
from .recommend import FOLLOWUP_RECOMMEND_SCHEMA, handler as recommend_handler

NAME = "followup-chips"
TOOLSET = NAME.replace("-", "_")
SETTING = "auto_offers"
RECOMMEND_SETTING = "auto_recommend"
ACCENT_SETTING = "accent_recommended"
CARRY_SETTING = "carry_over"
# Plugins that register the decision classifier (`nerve_assess`, or the older
# `jev_assess` name of the same contract).
RANKER_PLUGINS = ("nerve", "jev")


def offer_hook(response_text: str = "", platform: str = "", auto_offers: bool = False) -> str | None:
    """The reply with its closing offer drawn as chips, or None to leave it alone.

    Off by default: a hook that rewrites replies is opt-in, and the prompt section
    already asks for the directive.
    """
    if not auto_offers or not isinstance(response_text, str):
        return None
    return rewrite(response_text, platform=platform)


def has_ranker(ctx) -> bool:
    """Whether a decision classifier plugin is loaded. Advisory: the tool degrades on its own."""
    for plugin_id in RANKER_PLUGINS:
        try:
            if ctx.has_plugin(plugin_id):
                return True
        except Exception:
            continue
    return False


def _config(ctx, key: str, default):
    try:
        return ctx.get_config(key, default)
    except Exception:  # an unreadable setting store must not break registration
        return default


def section_text(session: dict, recommends: bool = False) -> str:
    """The prompt section for one session (the section is a callable, so this runs per session)."""
    return chips_rule(session, recommends=recommends)


def register(ctx) -> None:
    # The section is rendered when a session starts, not when the plugin loads, so
    # the classifier probe runs there: plugins register in dependency order and
    # `followup-chips` loads before `nerve`, which made an eager probe always False.
    # The setting is read in the same place, so a toggle applies to the next session.
    def section(session):
        recommends = bool(_config(ctx, RECOMMEND_SETTING, True)) and has_ranker(ctx)
        return section_text(session, recommends=recommends)

    ctx.register_system_prompt_section(NAME, section, max_chars=MAX_CHARS)

    ctx.register_tool(
        name="followup_recommend",
        toolset=TOOLSET,
        schema=FOLLOWUP_RECOMMEND_SCHEMA,
        handler=recommend_handler(ctx.dispatch_tool),
        description=(
            "Rank the next steps you are about to offer, for the rec attribute of the chips. "
            "Optional: it needs the nerve classifier plugin, and without one it answers "
            "'leave rec out' so the chips simply go unmarked."
        ),
        emoji="🎯",
    )

    def transform(response_text: str = "", platform: str = "", **kwargs) -> str | None:
        """Three independent jobs, each gated by its own setting, read per call.

        - auto_offers: a closing offer written in prose becomes a directive.
        - accent_recommended off: the directive gets accent="0", because the
          renderer cannot read plugin settings and the default is accented.
        - carry_over on: the directive gets carry="1", and a reply with no chips
          gets one empty block so its message still shows the unanswered ones.
        """
        del kwargs
        if not isinstance(response_text, str) or not response_text:
            return None
        try:
            auto_offers = bool(ctx.get_config(SETTING, False))
        except Exception:  # an unreadable setting must not break a reply
            auto_offers = False
        try:
            accent = bool(ctx.get_config(ACCENT_SETTING, True))
        except Exception:
            accent = True
        try:
            carry = bool(ctx.get_config(CARRY_SETTING, False))
        except Exception:
            carry = False
        if not auto_offers and accent and not carry:
            return None
        changed = response_text
        if auto_offers:
            converted = offer_hook(response_text=changed, platform=platform, auto_offers=True)
            if converted:
                changed = converted
        if not accent:
            changed = stamp_accent(changed, "0")
        if carry:
            changed = stamp_carry(changed, platform=platform)
        return changed if changed != response_text else None

    ctx.register_hook("transform_llm_output", transform)
