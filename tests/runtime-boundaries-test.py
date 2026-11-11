"""Fixed environment and credential boundaries for the expanded server bundle."""
import importlib.util
from pathlib import Path
import unittest
import types

path = Path(__file__).resolve().parents[1] / 'infra/staging/deploy-helper.py'
spec = importlib.util.spec_from_file_location('runtime_helper', path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class RuntimeBoundaries(unittest.TestCase):
    def setUp(self):
        self.public = {'NEXT_PUBLIC_SUPABASE_URL': 'https://abcdefghijklmnopqrst.supabase.co'}
        self.url = 'postgresql://dartflow_app:synthetic@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=verify-full'
        self.base = 'DARTFLOW_DATABASE_URL="' + self.url + '"\n'

    def test_legacy_bundle_and_separate_server_credentials(self):
        self.assertEqual(helper.runtime_values(self.base, self.public)['DARTFLOW_DATABASE_URL'], self.url)
        value = self.base + 'DARTFLOW_ENV=staging\nDARTFLOW_MAIL_MAX_MODE=test\nDARTFLOW_MAIL_TEST_RECIPIENTS=owner@example.invalid\nDARTFLOW_INTEGRATIONS_ENCRYPTION_KEY=' + 'A' * 43 + '=\n'
        self.assertEqual(helper.runtime_values(value, self.public)['DARTFLOW_MAIL_MAX_MODE'], 'test')

    def test_environment_escape_unknown_duplicate_and_ambiguous_values_are_refused(self):
        for suffix in ['DARTFLOW_ENV=production\n', 'DARTFLOW_MAIL_MAX_MODE=live\n',
                       'NODE_OPTIONS=--require=/tmp/code\n', 'DARTFLOW_MAIL_MAX_MODE=test\nDARTFLOW_MAIL_MAX_MODE=log\n',
                       'SUPABASE_MANAGEMENT_TOKEN="value\\nNODE_OPTIONS=x"\n',
                       'DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY=short\n',
                       'DARTFLOW_MAIL_TEST_RECIPIENTS=not-an-email\n',
                       'DARTFLOW_TURN_URLS=https://other.invalid\n']:
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                helper.runtime_values(self.base + suffix, self.public)

    def test_reply_to_boundary_is_optional_and_keeps_sender_and_test_recipient_separate(self):
        self.assertNotIn('DARTFLOW_MAIL_ALLOWED_REPLY_TO', helper.runtime_values(self.base, self.public))
        settings = ('DARTFLOW_MAIL_ALLOWED_FROM=noreply@dartflow.nl\n'
                    'DARTFLOW_MAIL_ALLOWED_REPLY_TO=support@dartflow.nl\n'
                    'DARTFLOW_MAIL_TEST_RECIPIENTS=info@dgwebservices.nl\n')
        parsed = helper.runtime_values(self.base + settings, self.public)
        self.assertEqual(parsed['DARTFLOW_MAIL_ALLOWED_FROM'], 'noreply@dartflow.nl')
        self.assertEqual(parsed['DARTFLOW_MAIL_ALLOWED_REPLY_TO'], 'support@dartflow.nl')
        self.assertEqual(parsed['DARTFLOW_MAIL_TEST_RECIPIENTS'], 'info@dgwebservices.nl')
        self.assertNotIn('support@dartflow.nl', parsed['DARTFLOW_MAIL_ALLOWED_FROM'])
        self.assertNotIn('support@dartflow.nl', parsed['DARTFLOW_MAIL_TEST_RECIPIENTS'])

    def test_reply_to_mailboxes_refuse_headers_empty_entries_and_duplicate_environment_keys(self):
        for value in ['', 'not-an-email', '<support@dartflow.nl>', 'Support<support@dartflow.nl>',
                      'support@dartflow.nl,', ',support@dartflow.nl', 'support@dartflow.nl,,other@example.invalid',
                      'support@dartflow.nl\rBcc:other@example.invalid', 'support@dartflow.nl;Bcc:other@example.invalid']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                helper.runtime_values(self.base + 'DARTFLOW_MAIL_ALLOWED_REPLY_TO=' + value + '\n', self.public)
        with self.assertRaises(ValueError):
            helper.runtime_values(self.base + 'DARTFLOW_MAIL_ALLOWED_REPLY_TO=support@dartflow.nl\n'
                                  'DARTFLOW_MAIL_ALLOWED_REPLY_TO=other@example.invalid\n', self.public)

    def test_rendered_production_keeps_its_own_environment_and_mail_ceiling(self):
        renderer_path = path.parent / 'render-deployer.py'
        renderer_spec = importlib.util.spec_from_file_location('runtime_renderer', renderer_path)
        renderer = importlib.util.module_from_spec(renderer_spec)
        renderer_spec.loader.exec_module(renderer)
        module = types.ModuleType('production_runtime')
        module.__file__ = str(path)
        exec(compile(renderer.fixed_source(path.read_text(), 'production'), str(path), 'exec'), module.__dict__)
        self.assertEqual(module.runtime_values(self.base + 'DARTFLOW_ENV=production\nDARTFLOW_MAIL_MAX_MODE=live\n', self.public)['DARTFLOW_ENV'], 'production')
        separate = module.runtime_values(self.base + 'DARTFLOW_ENV=production\nDARTFLOW_MAIL_MAX_MODE=live\n'
                                         'DARTFLOW_MAIL_ALLOWED_FROM=noreply@dartflow.nl\n'
                                         'DARTFLOW_MAIL_ALLOWED_REPLY_TO=support@dartflow.nl\n'
                                         'DARTFLOW_MAIL_TEST_RECIPIENTS=info@dgwebservices.nl\n', self.public)
        self.assertEqual(separate['DARTFLOW_MAIL_ALLOWED_FROM'], 'noreply@dartflow.nl')
        self.assertEqual(separate['DARTFLOW_MAIL_ALLOWED_REPLY_TO'], 'support@dartflow.nl')
        self.assertEqual(separate['DARTFLOW_MAIL_TEST_RECIPIENTS'], 'info@dgwebservices.nl')
        with self.assertRaises(ValueError):
            module.runtime_values(self.base + 'DARTFLOW_ENV=staging\n', self.public)


if __name__ == '__main__':
    unittest.main()
