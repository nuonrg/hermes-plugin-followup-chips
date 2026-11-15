"""Options that exclude each other: the attribute, the parser, and the rule the decision implies."""

from __future__ import annotations

import unittest

import offers
import recommend


class ParseTest(unittest.TestCase):
    def test_a_string_of_groups(self):
        self.assertEqual(offers.parse_alternates("1,3|2,4", 4), [[1, 3], [2, 4]])

    def test_nested_lists_from_a_tool_call(self):
        self.assertEqual(offers.parse_alternates([[1, 3], [2, 4]], 4), [[1, 3], [2, 4]])

    def test_a_group_of_one_means_nothing(self):
        self.assertEqual(offers.parse_alternates("1|2,3", 3), [[2, 3]])

    def test_numbers_out_of_range_are_dropped(self):
        self.assertEqual(offers.parse_alternates("1,9", 3), [])
        self.assertEqual(offers.parse_alternates("0,1,2", 3), [[1, 2]])

    def test_members_come_back_sorted_and_distinct(self):
        self.assertEqual(offers.parse_alternates("3,1,3", 3), [[1, 3]])

    def test_the_same_group_twice_is_kept_once(self):
        self.assertEqual(offers.parse_alternates("1,2|2,1", 3), [[1, 2]])

    def test_junk_is_ignored(self):
        self.assertEqual(offers.parse_alternates(None, 3), [])
        self.assertEqual(offers.parse_alternates("", 3), [])
        self.assertEqual(offers.parse_alternates("x,y", 3), [])

    def test_the_attribute_text(self):
        self.assertEqual(offers.alternate_attribute([[3, 1], [2, 3]], 3), "1,3|2,3")
        self.assertEqual(offers.alternate_attribute([], 3), "")


class MergeTest(unittest.TestCase):
    def test_the_policy_group_is_added(self):
        self.assertEqual(offers.merge_alternates("1,2", [[3, 1]], 3), [[1, 2], [1, 3]])

    def test_an_existing_group_is_not_duplicated(self):
        self.assertEqual(offers.merge_alternates("1,3", [[3, 1]], 3), [[1, 3]])

    def test_it_is_idempotent(self):
        once = offers.merge_alternates("1,2", [[3, 1]], 3)
        self.assertEqual(offers.merge_alternates(once, [[3, 1]], 3), once)


class StampTest(unittest.TestCase):
    def test_a_directive_without_groups_gains_them(self):
        text = '::followups{q1="Push it" q2="Leave as it is"}'
        self.assertIn('alt="1,2"', offers.stamp_alternates(text, [[1, 2]], 2))

    def test_the_models_own_groups_survive(self):
        text = '::followups{alt="1,2" q1="A" q2="B" q3="Leave it"}'
        out = offers.stamp_alternates(text, [[3, 1], [3, 2]], 3)
        self.assertIn('alt="1,2|1,3|2,3"', out)

    def test_a_second_pass_changes_nothing(self):
        text = '::followups{q1="A" q2="Leave it"}'
        once = offers.stamp_alternates(text, [[1, 2]], 2)
        self.assertEqual(offers.stamp_alternates(once, [[1, 2]], 2), once)

    def test_prose_and_other_directives_are_left_alone(self):
        self.assertEqual(offers.stamp_alternates("No chips here.", [[1, 2]], 2), "No chips here.")

    def test_the_options_are_read_back_in_order(self):
        text = '::followups{q2="Second" q1="First"}'
        self.assertEqual(offers.directive_options(text), ["First", "Second"])


class ImpliedTest(unittest.TestCase):
    def test_a_deferral_is_opposed_to_every_action(self):
        groups = recommend.alternate_groups(["Ship it", "Tag it", "Leave as it is"])
        self.assertEqual(groups, [[1, 3], [2, 3]])

    def test_actions_alone_are_compatible(self):
        self.assertEqual(recommend.alternate_groups(["Ship it", "Tag it"]), [])

    def test_two_deferrals_also_exclude_each_other(self):
        groups = recommend.alternate_groups(["Ship it", "Do nothing", "Wait for review"])
        self.assertIn([1, 2], groups)
        self.assertIn([1, 3], groups)
        self.assertIn([2, 3], groups)

    def test_the_phrasings_a_model_uses(self):
        for label in ("Leave as it is", "leave it for tomorrow", "Not now", "Status quo", "No change"):
            self.assertEqual(
                recommend.alternate_groups(["Ship it", label]),
                [[1, 2]],
                label,
            )


if __name__ == "__main__":
    unittest.main()
