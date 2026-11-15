"""What register(ctx) wires up, and that the hook stays off unless the owner turns it on."""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_plugin():
    """Import this folder as a package (its name has a dash, so it cannot be imported by name)."""
    spec = importlib.util.spec_from_file_location(
        "followup_chips", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["followup_chips"] = module
    spec.loader.exec_module(module)
    return module


plugin = load_plugin()

OFFER = "Branch is pushed.\n\nWant me to open the PR?"


class FakeCtx:
    def __init__(self, settings=None):
        self.settings = settings or {}
        self.sections = []
        self.hooks = {}

    def register_system_prompt_section(self, section_id, content, **kwargs):
        self.sections.append((section_id, content, kwargs))

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def get_config(self, key, default=None):
        return self.settings.get(key, default)


class RegisterTest(unittest.TestCase):
    def test_registers_one_prompt_section_and_the_output_hook(self):
        ctx = FakeCtx()
        plugin.register(ctx)
        self.assertEqual([s[0] for s in ctx.sections], ["followup-chips"])
        self.assertEqual(ctx.sections[0][2]["max_chars"], plugin.MAX_CHARS)
        self.assertEqual(list(ctx.hooks), ["transform_llm_output"])

    def test_prompt_section_never_asks_for_a_directive_off_desktop(self):
        ctx = FakeCtx()
        plugin.register(ctx)
        rule = ctx.sections[0][1]
        self.assertIn("::followups", rule({"platform": "local"}))
        self.assertIn("never write a ::followups directive", rule({"platform": "telegram"}))

    def test_hook_is_silent_until_auto_offers_is_on(self):
        ctx = FakeCtx()
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        self.assertIsNone(hook(response_text=OFFER, platform="local"))

    def test_hook_rewrites_the_offer_when_enabled(self):
        ctx = FakeCtx({"auto_offers": True})
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        self.assertEqual(
            hook(response_text=OFFER, platform="local"),
            'Branch is pushed.\n\n::followups{q1="Open the PR"}',
        )

    def test_hook_leaves_other_surfaces_alone_even_when_enabled(self):
        ctx = FakeCtx({"auto_offers": True})
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        self.assertIsNone(hook(response_text=OFFER, platform="telegram"))

    def test_hook_survives_kwargs_and_a_broken_setting_store(self):
        ctx = FakeCtx({"auto_offers": True})
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        self.assertIsNone(hook(turn_id="t1", model="m", session_id="s"))
        ctx.get_config = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no store"))
        self.assertIsNone(hook(response_text=OFFER, platform="local"))

    def test_offer_hook_ignores_non_string_replies(self):
        self.assertIsNone(plugin.offer_hook(response_text=None, platform="local", auto_offers=True))


if __name__ == "__main__":
    unittest.main()
