"""Offline synthetic reports only; never fabricate a runtime/device pass."""
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
import verify_native_tests as check


class NativeTestReports(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def report(self, count=3, cases=None, **counters):
        root = ET.Element("testsuite", {"tests": str(count), "failures": "0", "errors": "0", "skipped": "0", **{k: str(v) for k, v in counters.items()}})
        for owner, name in cases if cases is not None else [("fixture.Tests", "case" + str(i)) for i in range(count)]:
            ET.SubElement(root, "testcase", {"classname": owner, "name": name})
        path = self.root / ("TEST-" + str(len(list(self.root.glob('*.xml')))) + ".xml")
        ET.ElementTree(root).write(path)
        return path

    def test_current_player_counts_remain_exact_and_oche_baseline_is_unchanged(self):
        self.assertEqual((check.APPS["player"]["unit"], check.APPS["player"]["ui"]), (163, 97))
        self.assertEqual((check.APPS["oche"]["unit"], check.APPS["oche"]["ui"]), (34, 16))

    def test_actual_unique_cases_pass(self):
        self.assertEqual(check.summarize([self.report()], 3), {"tests": 3, "failures": 0, "errors": 0, "skipped": 0})

    def test_counter_without_actual_cases_fails(self):
        with self.assertRaises(ValueError):
            check.summarize([self.report(cases=[])], 3)

    def test_duplicate_actual_methods_fail(self):
        with self.assertRaises(ValueError):
            check.summarize([self.report(cases=[("fixture.Tests", "same")] * 3)], 3)

    def test_all_nonzero_failure_or_skip_counters_fail(self):
        for key in ("failures", "errors", "skipped"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                check.summarize([self.report(**{key: 1})], 3)

    def test_hidden_actual_failure_or_skip_fails(self):
        for tag in ("failure", "error", "skipped", "ignored"):
            path = self.report()
            root = ET.parse(path).getroot()
            ET.SubElement(root.find("testcase"), tag)
            ET.ElementTree(root).write(path)
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                check.summarize([path], 3)

    def test_empty_and_wrong_exact_count_fail(self):
        for files, count in (([], 3), ([self.report()], 2), ([self.report()], 4)):
            with self.assertRaises(ValueError):
                check.summarize(files, count)

    def test_ui_replaced_source_method_fails(self):
        with self.assertRaises(ValueError):
            check.summarize([self.report()], 3, {("fixture.Tests", "other" + str(i)) for i in range(3)})

    def test_ui_exact_source_cases_and_missing_source_are_checked(self):
        expected = {("fixture.Tests", "case" + str(i)) for i in range(3)}
        self.assertEqual(check.summarize([self.report()], 3, expected)["tests"], 3)
        with self.assertRaises(ValueError):
            check.summarize([self.report()], 3, set())

    def test_source_names_include_test_annotations_and_hashes(self):
        path = self.root / "app/src/androidTest/java/Fixture.kt"
        path.parent.mkdir(parents=True)
        path.write_text('package fixture\nclass Tests { @Test(timeout=1000) fun first() {}\n@Test\nfun second() {} }')
        cases, hashes = check.ui_source_cases(self.root)
        self.assertEqual(cases, {("fixture.Tests", "first"), ("fixture.Tests", "second")})
        self.assertEqual(len(hashes), 1)

    def test_every_required_unit_variant_is_checked(self):
        config = check.APPS["player"]
        for variant in config["variants"]:
            target = self.root / "player/app/build/test-results" / ("test" + variant + "DebugUnitTest")
            target.mkdir(parents=True)
            self.report(163).rename(target / "TEST-fixture.xml")
        self.assertEqual(len(check.verify("player", "unit", self.root)), 3)
        next((self.root / "player/app/build/test-results/testStagingDebugUnitTest").glob("*.xml")).unlink()
        with self.assertRaises(ValueError):
            check.verify("player", "unit", self.root)

    def test_ui_verification_requires_all_reviewed_actual_source_methods(self):
        app = self.root / "player"
        source = app / "app/src/androidTest/java/Fixture.kt"
        source.parent.mkdir(parents=True)
        source.write_text("package fixture\nclass Tests {\n" + "\n".join("@Test fun case" + str(i) + "() {}" for i in range(97)) + "\n}")
        target = app / "app/build/outputs/androidTest-results/connected/device"
        target.mkdir(parents=True)
        report = target / "TEST-fixture.xml"
        self.report(97).rename(report)
        self.assertEqual(check.verify("player", "ui", self.root)["actualUniqueMethods"], 97)
        # The old count cannot stand in for the new redesign methods.
        old = ET.parse(report)
        old.getroot().set("tests", "90")
        for case in old.getroot().findall("testcase")[90:]:
            old.getroot().remove(case)
        old.write(report)
        with self.assertRaises(ValueError):
            check.verify("player", "ui", self.root)
        self.report(97).replace(report)
        source.write_text(source.read_text().replace("case96()", "replaced()"))
        with self.assertRaises(ValueError):
            check.verify("player", "ui", self.root)


if __name__ == "__main__":
    unittest.main()
