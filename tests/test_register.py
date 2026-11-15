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
    def __init__(self, settings=None, plugins=()):
        self.settings = settings or {}
        self.plugins = set(plugins)
        self.sections = []
        self.hooks = {}
        self.tools = {}

    def register_system_prompt_section(self, section_id, content, **kwargs):
        self.sections.append((section_id, content, kwargs))

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def register_tool(self, name=None, toolset=None, schema=None, handler=None, **kwargs):
        self.tools[name] = {"toolset": toolset, "schema": schema, "handler": handler}

    def has_plugin(self, plugin_id):
        return plugin_id in self.plugins

    def get_config(self, key, default=None):
        return self.settings.get(key, default)

    def dispatch_tool(self, name, args, **kwargs):
        raise RuntimeError("no classifier in tests")


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


class RecommendRegistrationTest(unittest.TestCase):
    def test_the_recommend_tool_is_always_registered(self):
        ctx = FakeCtx()
        plugin.register(ctx)
        self.assertEqual(list(ctx.tools), ["followup_recommend"])
        tool = ctx.tools["followup_recommend"]
        self.assertEqual(tool["toolset"], "followup_chips")
        self.assertEqual(tool["schema"]["name"], "followup_recommend")
        self.assertEqual(tool["schema"]["parameters"]["required"], ["options"])

    def test_a_classifier_loaded_after_this_plugin_is_still_seen(self):
        # Plugins register in dependency order and followup-chips loads before nerve,
        # so the probe has to run per session, not once at registration.
        ctx = FakeCtx()
        plugin.register(ctx)
        rule = ctx.sections[0][1]
        self.assertNotIn("followup_recommend", rule({"platform": "local"}))
        ctx.plugins.add("nerve")
        self.assertIn("followup_recommend", rule({"platform": "local"}))

    def test_the_rule_mentions_the_classifier_only_when_one_is_loaded(self):
        without = FakeCtx()
        plugin.register(without)
        rule = without.sections[0][1]
        self.assertNotIn("followup_recommend", rule({"platform": "local"}))
        with_ranker = FakeCtx(plugins=["nerve"])
        plugin.register(with_ranker)
        rule = with_ranker.sections[0][1]
        self.assertIn("followup_recommend", rule({"platform": "local"}))
        self.assertNotIn("followup_recommend", rule({"platform": "telegram"}))

    def test_the_owner_can_turn_recommendations_off(self):
        ctx = FakeCtx(settings={"auto_recommend": False}, plugins=["nerve"])
        plugin.register(ctx)
        self.assertNotIn("followup_recommend", ctx.sections[0][1]({"platform": "local"}))
        ctx.settings["auto_recommend"] = True
        self.assertIn("followup_recommend", ctx.sections[0][1]({"platform": "local"}))

    def test_a_classifier_plugin_answers_through_the_tool(self):
        ctx = FakeCtx(plugins=["nerve"])
        answers = {
            "answers": {
                "q1": {"probabilities": {"take it now": 0.81, "later": 0.1, "skip": 0.09}},
                "q2": {"probabilities": {"take it now": 0.31, "later": 0.6, "skip": 0.09}},
            },
            "ok": True,
        }
        import json

        ctx.dispatch_tool = lambda name, args, **kw: json.dumps(answers)
        plugin.register(ctx)
        out = ctx.tools["followup_recommend"]["handler"]({"options": ["A", "B"], "context": "x"})
        self.assertIn('rec="1"', out)

    # -- the accent setting travels in the directive -----------------------

    def test_accent_on_adds_nothing_to_a_reply(self):
        ctx = FakeCtx()
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        self.assertIsNone(hook(response_text='::followups{q1="A"}', platform="local"))
        self.assertIsNone(hook(response_text=OFFER, platform="local"))

    def test_accent_off_stamps_every_directive_it_sees(self):
        ctx = FakeCtx(settings={"accent_recommended": False})
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        self.assertEqual(
            hook(response_text='::followups{rec="1" q1="A"}', platform="local"),
            '::followups{accent="0" rec="1" q1="A"}',
        )

    def test_accent_off_still_leaves_prose_alone(self):
        ctx = FakeCtx(settings={"accent_recommended": False})
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        self.assertIsNone(hook(response_text="Just an answer, no chips.", platform="local"))
        self.assertIsNone(hook(response_text=OFFER, platform="local"), "auto_offers is off")

    def test_accent_off_and_auto_offers_stamp_the_converted_chips(self):
        ctx = FakeCtx(settings={"accent_recommended": False, "auto_offers": True})
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        out = hook(response_text=OFFER, platform="local")
        self.assertIn('::followups{accent="0" ', out)
        self.assertIn('q1="Open the PR"', out)

    def test_a_broken_setting_store_keeps_the_defaults(self):
        ctx = FakeCtx()

        def boom(key, default=None):
            raise RuntimeError("config unreadable")

        ctx.get_config = boom
        plugin.register(ctx)
        self.assertIsNone(ctx.hooks["transform_llm_output"](response_text='::followups{q1="A"}', platform="local"))


    def test_without_a_classifier_everything_else_still_works(self):
        """'Optional' is a promise: no nerve means no tags, and nothing else changes."""
        ctx = FakeCtx()  # neither nerve nor jev is loaded
        plugin.register(ctx)
        rule = ctx.sections[0][1]
        local = rule({"platform": "local"})
        self.assertIn("::followups", local)
        self.assertNotIn("followup_recommend", local)
        converted = plugin.offer_hook(response_text=OFFER, platform="local", auto_offers=True)
        self.assertIsNotNone(converted)
        self.assertIn("::followups", converted)
        self.assertIn("leave rec out", ctx.tools["followup_recommend"]["handler"]({"options": ["A", "B"]}))

    def test_the_classifier_is_not_declared_as_a_required_plugin(self):
        # requires_plugins is advisory in Hermes, but an unmet one logs a warning that a
        # required plugin is missing, which reads as a broken install to anyone who
        # skipped the classifier on purpose. The probe is runtime, so the manifest stays quiet.
        for line in (ROOT / "plugin.yaml").read_text(encoding="utf-8").splitlines():
            if line.startswith("requires_plugins"):
                self.assertNotIn("nerve", line)


    def test_carry_over_marks_the_reply_and_adds_a_block_when_it_has_none(self):
        ctx = FakeCtx({"carry_over": True})
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        self.assertEqual(
            hook(response_text='::followups{q1="A"}', platform="local"),
            '::followups{carry="1" q1="A"}',
        )
        self.assertEqual(
            hook(response_text="Nothing to offer.", platform="local"),
            'Nothing to offer.\n\n::followups{carry="1"}',
        )

    def test_carry_over_is_off_by_default(self):
        ctx = FakeCtx()
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        self.assertIsNone(hook(response_text="Nothing to offer.", platform="local"))

    def test_carry_over_never_reaches_another_surface(self):
        ctx = FakeCtx({"carry_over": True})
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        self.assertIsNone(hook(response_text="Nothing to offer.", platform="telegram"))

    def test_carry_and_offer_conversion_compose(self):
        # The converted directive is the one that gets marked, so reply 1 in a
        # queued session carries over too.
        ctx = FakeCtx({"carry_over": True, "auto_offers": True})
        plugin.register(ctx)
        hook = ctx.hooks["transform_llm_output"]
        out = hook(response_text=OFFER, platform="local")
        self.assertEqual(out, 'Branch is pushed.\n\n::followups{carry="1" q1="Open the PR"}')

    def test_carry_over_also_ships_with_the_accent_off(self):
        # Two independent jobs on one hook: turning the accent off must not stop
        # the carry stamp, and the accent stamp must survive it.
        ctx = FakeCtx({"carry_over": True, "accent_recommended": False})
        plugin.register(ctx)
        out = ctx.hooks["transform_llm_output"](response_text='::followups{rec="1" q1="A"}', platform="local")
        self.assertIn('accent="0"', out)
        self.assertIn('carry="1"', out)


if __name__ == "__main__":
    unittest.main()
