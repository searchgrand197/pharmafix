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
    print(f"Testing PDF generation for offer {offer.id}")
    
    # Test PDF generation
    try:
        from apps.hr.utils.pdf_generator import generate_offer_pdf
        result = generate_offer_pdf(offer)
        print(f"PDF generation result: {result}")
        
        # Refresh and check
        offer.refresh_from_db()
        print(f"PDF after generation: {offer.pdf}")
        print(f"PDF exists: {offer.pdf and os.path.exists(offer.pdf.path) if offer.pdf else False}")
        
    except Exception as e:
        print(f"PDF generation error: {e}")
        import traceback
        traceback.print_exc()
else:
    print("No offers found")
