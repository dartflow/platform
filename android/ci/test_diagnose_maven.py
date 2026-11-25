"""Offline diagnostic boundaries; no network requests or Android/device claims."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import diagnose_maven as diagnostic


class PublicPomDiagnostic(unittest.TestCase):
    def test_only_three_fixed_canonical_public_targets(self):
        self.assertEqual(len(set(diagnostic.URLS)), 3)
        self.assertTrue(all(url.startswith("https://repo.maven.apache.org/maven2/") and url.endswith(".pom") for url in diagnostic.URLS))
        with self.assertRaises(ValueError):
            diagnostic.probe("https://example.test/private", runner=lambda *a, **k: self.fail("No request allowed"))

    def test_request_bounds_and_tls_do_not_inherit_credentials(self):
        def run(args, **options):
            self.assertEqual(args[:2], ["curl", "--disable"])
            for option, value in (("--connect-timeout", "5"), ("--max-time", "12"), ("--max-filesize", "65536"), ("--retry", "0"), ("--proto", "=https")):
                self.assertEqual(args[args.index(option) + 1], value)
            self.assertNotIn("--insecure", args); self.assertNotIn("--location", args)
            self.assertEqual(options["timeout"], 15)
            self.assertEqual(set(options["env"]), {"PATH", "LANG", "LC_ALL"})
            Path(args[args.index("--dump-header") + 1]).write_bytes(b"HTTP/2 200\r\nContent-Type: text/xml\r\nSet-Cookie: private-value\r\n")
            return subprocess.CompletedProcess(args, 0, "200", "private-stderr")
        result = diagnostic.probe(diagnostic.URLS[0], runner=run)
        self.assertEqual(result["httpStatus"], 200)
        self.assertEqual(result["headers"], {"content-type": "text/xml"})
        self.assertNotIn("private", json.dumps(result))

    def test_headers_are_allowlisted_printable_bounded_and_exclude_secrets(self):
        raw = b"HTTP/2 404\r\nDate: Fri, 20 Nov 2026 04:00:00 GMT\r\nAge: 2\r\nX-Cache: HIT\r\nAuthorization: secret\r\nSet-Cookie: secret\r\nX-Secret: secret\r\nServer: bad\x00value\r\nVia: " + b"x" * 257 + b"\r\n"
        headers, oversized = diagnostic.safe_headers(raw)
        self.assertFalse(oversized)
        self.assertEqual(set(headers), {"date", "age", "x-cache"})
        self.assertNotIn("secret", json.dumps(headers))
        self.assertEqual(diagnostic.safe_headers(b"x" * 65537), ({}, True))
        def oversized(args, **options):
            Path(args[args.index("--dump-header") + 1]).write_bytes(b"x" * 131072)
            return subprocess.CompletedProcess(args, 0, "200", "")
        result = diagnostic.probe(diagnostic.URLS[0], runner=oversized)
        self.assertEqual(result["headers"], {})
        self.assertTrue(result["headersOmittedAsOversized"])

    def test_timeout_is_one_attempt_and_does_not_echo_exception(self):
        calls = []
        def run(args, **options):
            calls.append(args)
            raise subprocess.TimeoutExpired("private-command", 15, stderr="private-provider-response")
        result = diagnostic.probe(diagnostic.URLS[0], runner=run)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["errorCategory"], "timeout")
        self.assertNotIn("private", json.dumps(result))

    def test_context_only_reports_valid_public_run_attempt_and_sha(self):
        self.assertEqual(diagnostic.context({"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2", "GITHUB_SHA": "a" * 40, "TOKEN": "secret"}), {"runId": "123", "attempt": "2", "sha": "a" * 40})
        self.assertEqual(diagnostic.context({"GITHUB_RUN_ID": "::secret", "GITHUB_RUN_ATTEMPT": "1\nsecret", "GITHUB_SHA": "private"}), {"runId": None, "attempt": None, "sha": None})

    def test_main_observes_each_target_once_without_retrying_or_printing_environment(self):
        output = io.StringIO()
        with patch.dict(diagnostic.os.environ, {"UNRELATED_SECRET": "private-value"}), patch.object(diagnostic, "probe", side_effect=lambda url: {"url": url, "httpStatus": None}) as probe, contextlib.redirect_stdout(output):
            diagnostic.main()
        self.assertEqual([call.args[0] for call in probe.call_args_list], list(diagnostic.URLS))
        report = json.loads(output.getvalue())
        self.assertEqual(len(report["requests"]), 3)
        self.assertIn("no retry, recovery or test-pass claim", report["purpose"])
        self.assertNotIn("private-value", output.getvalue())


if __name__ == "__main__":
    unittest.main()
