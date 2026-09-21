#!/usr/bin/env python
import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
django.setup()

from apps.hr.models import Offer

# Get the latest offer
offer = Offer.objects.order_by('-created_at').first()
if offer:
    print(f"Offer ID: {offer.id}")
    print(f"Candidate Name: {offer.candidate_name}")
    print(f"Candidate Email: {offer.candidate_email}")
    print(f"Job Title: {offer.job_title}")
    print(f"Status: {offer.status}")
    print(f"PDF: {offer.pdf}")
    print(f"PDF exists: {offer.pdf and os.path.exists(offer.pdf.path) if offer.pdf else False}")
    
    # Test email sending
    print("\n=== Testing Email Send ===")
    try:
        from apps.hr.email_utils import send_offer_email
        result = send_offer_email(offer)
        print(f"Email send result: {result}")
    except Exception as e:
        print(f"Email send error: {e}")
        import traceback
        traceback.print_exc()
else:
    print("No offers found")
