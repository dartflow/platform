"""Require actual native test cases, exact reviewed counts and zero skipped tests."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ANDROID = Path(__file__).resolve().parents[1]
APPS = {
    "player": {"directory": "player", "unit": 145, "ui": 81, "variants": ("Production", "Staging", "Development")},
    "oche": {"directory": "oche-live", "unit": 34, "ui": 16, "variants": ("Staging", "Production")},
}


def require(value, message):
    if not value:
        raise ValueError(message)


def ui_source_cases(app):
    cases = set()
    hashes = {}
    for path in sorted((app / "app/src/androidTest").rglob("*.kt")):
        text = path.read_text()
        methods = re.findall(r"@Test\b(?:\s*\([^)]*\))?[\s\S]*?\bfun\s+(\w+)\s*\(", text)
        if not methods:
            continue
        package = re.search(r"^package\s+([\w.]+)", text, re.M)
        owner = re.search(r"\bclass\s+(\w+)", text)
        require(package and owner, "UI test source has no explicit package/class")
        hashes[str(path.relative_to(app))] = hashlib.sha256(path.read_bytes()).hexdigest()
        for name in methods:
            case = (package[1] + "." + owner[1], name)
            require(case not in cases, "Duplicate UI source test method")
            cases.add(case)
    return cases, hashes


def summarize(files, expected, source_cases=None):
    require(files, "No actual JUnit XML reports found")
    counts = dict.fromkeys(("tests", "failures", "errors", "skipped"), 0)
    cases = []
    for path in files:
        root = ET.parse(path).getroot()
        require(root.tag == "testsuite", "Expected an individual JUnit testsuite report")
        for key in counts:
            value = root.get(key, "0")
            require(re.fullmatch(r"[0-9]+", value), "Invalid JUnit summary counter")
            counts[key] += int(value)
        for case in root.findall("testcase"):
            require(all(case.find(tag) is None for tag in ("failure", "error", "skipped", "ignored")), "An actual test method failed or was skipped")
            require(case.get("status", "").lower() not in ("skipped", "ignored", "notrun"), "An actual test method did not run")
            identity = (case.get("classname"), case.get("name"))
            require(all(identity), "Actual test method has no class/name")
            cases.append(identity)
    require(counts == {"tests": expected, "failures": 0, "errors": 0, "skipped": 0}, "JUnit counters differ from the exact reviewed zero-skip test count")
    require(len(cases) == expected and len(set(cases)) == expected, "Actual unique test cases differ from the declared/reviewed count")
    if source_cases is not None:
        require(len(source_cases) == expected and set(cases) == source_cases, "Executed UI methods differ from the exact checked-out test source")
    return counts


def verify(app_name, kind, android=ANDROID):
    config = APPS[app_name]
    app = android / config["directory"]
    if kind == "unit":
        return {variant: summarize(sorted((app / "app/build/test-results" / ("test" + variant + "DebugUnitTest")).glob("TEST-*.xml")), config["unit"]) for variant in config["variants"]}
    source_cases, hashes = ui_source_cases(app)
    counts = summarize(sorted((app / "app/build/outputs/androidTest-results/connected").rglob("TEST-*.xml")), config["ui"], source_cases)
    return {"counts": counts, "actualUniqueMethods": len(source_cases), "sourceFiles": hashes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", choices=APPS, required=True)
    parser.add_argument("--kind", choices=("unit", "ui"), required=True)
    parser.add_argument("--summary", type=Path)
    args = parser.parse_args()
    try:
        result = verify(args.app, args.kind)
        if args.summary:
            require(args.kind == "ui", "A flat runtime summary is only valid for UI results")
            args.summary.write_text(json.dumps(result["counts"], indent=2) + "\n")
        print(json.dumps({"app": args.app, "kind": args.kind, "verified": result}, sort_keys=True))
    except (ValueError, ET.ParseError, OSError) as error:
        raise SystemExit("Native test verification failed: " + str(error)) from None


if __name__ == "__main__":
    main()
