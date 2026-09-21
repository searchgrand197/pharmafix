from django.test import TestCase

from apps.shared.email_normalization import normalize_email_address


class NormalizeEmailTests(TestCase):
    def test_lowercase_full_address(self):
        self.assertEqual(normalize_email_address('  Ajay@gmail.com '), 'ajay@gmail.com')

    def test_empty(self):
        self.assertEqual(normalize_email_address(None), '')
        self.assertEqual(normalize_email_address(''), '')
