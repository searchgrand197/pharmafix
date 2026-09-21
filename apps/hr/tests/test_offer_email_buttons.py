from django.test import SimpleTestCase

from apps.hr.email_utils import _render_offer_action_buttons


class OfferEmailButtonTests(SimpleTestCase):
    def test_buttons_use_stacked_table_layout(self):
        html = _render_offer_action_buttons(
            'https://example.com/offer/accept/token/',
            'https://example.com/offer/reject/token/',
        )
        self.assertIn('Accept Offer', html)
        self.assertIn('Decline Offer', html)
        self.assertIn('role="presentation"', html)
        self.assertIn('display: block', html)
        self.assertIn('max-width: 320px', html)
        self.assertNotIn('margin-right: 12px', html)
        self.assertNotIn('display: inline-block', html)

    def test_button_urls_are_embedded(self):
        accept = 'https://hr.test/offer/accept/abc/'
        reject = 'https://hr.test/offer/reject/abc/'
        html = _render_offer_action_buttons(accept, reject)
        self.assertIn(f'href="{accept}"', html)
        self.assertIn(f'href="{reject}"', html)
