from io import BytesIO

from django.template.loader import render_to_string
from django.conf import settings
from xhtml2pdf import pisa
import os
from urllib.parse import urlparse
from django.core.files.base import ContentFile


def _link_callback(uri, _rel):
    parsed = urlparse(uri)
    path = parsed.path if parsed.scheme else uri
    media_url = getattr(settings, 'MEDIA_URL', '/media/')
    static_url = getattr(settings, 'STATIC_URL', '/static/')
    if path.startswith(media_url):
        return os.path.join(settings.MEDIA_ROOT, path.replace(media_url, '', 1))
    if path.startswith(static_url):
        return os.path.join(getattr(settings, 'STATIC_ROOT', ''), path.replace(static_url, '', 1))
    return uri


def generate_pdf_bytes_from_html(html_content: str) -> bytes | None:
    """Render HTML to PDF bytes in memory (for download / preview)."""
    try:
        dest = BytesIO()
        result = pisa.CreatePDF(
            html_content,
            dest=dest,
            encoding='utf-8',
            link_callback=_link_callback,
        )
        if result.err:
            return None
        pdf_data = dest.getvalue()
        return pdf_data if pdf_data else None
    except Exception:
        return None


def generate_offer_pdf(offer):
    """
    Generate PDF from Offer data and save to offer.pdf field using xhtml2pdf.
    
    Args:
        offer: Offer instance
        
    Returns:
        bool: True if PDF generated successfully, False otherwise
    """
    try:
        from django.utils import timezone
        
        print(f"[PDF GENERATOR] ==========================================")
        print(f"[PDF GENERATOR] Starting PDF generation for offer {offer.id}")
        print(f"[PDF GENERATOR] Offer ID: {offer.id}")
        print(f"[PDF GENERATOR] Candidate: {offer.candidate_name}")
        print(f"[PDF GENERATOR] Job Title: {offer.job_title}")
        print(f"[PDF GENERATOR] Company: {offer.company_name}")
        
        # Use edited HTML from WYSIWYG preview if available.
        if offer.edited_html:
            html_content = offer.edited_html
        else:
            html_content = render_to_string(
                'hr/offers/offer_letter.html',
                {
                    'offer': offer,
                    'MEDIA_ROOT': settings.MEDIA_ROOT
                }
            )
        
        print(f"[PDF GENERATOR] HTML template rendered successfully")
        print(f"[PDF GENERATOR] HTML length: {len(html_content)} characters")
        
        # Create filename
        filename = f'offer_{offer.id}.pdf'
        
        # Create PDF in memory
        print(f"[PDF GENERATOR] Creating PDF using xhtml2pdf...")
        pdf_bytes = pisa.CreatePDF(html_content, encoding='utf-8', link_callback=_link_callback)
        
        if pdf_bytes.err:
            print(f"[PDF GENERATOR] ERROR: PDF generation failed with error")
            print(f"[PDF GENERATOR] Error details: {pdf_bytes.err}")
            return False
        
        # Get PDF bytes from the pisa result
        pdf_data = pdf_bytes.dest.getvalue()
        
        if not pdf_data:
            print(f"[PDF GENERATOR] ERROR: No PDF data generated")
            return False
        
        print(f"[PDF GENERATOR] PDF generated successfully, size: {len(pdf_data)} bytes")
        
        # Delete existing PDF if any (try catch for Windows file locking)
        if offer.pdf:
            try:
                print(f"[PDF GENERATOR] Attempting to delete existing PDF: {offer.pdf.name}")
                offer.pdf.delete(save=False)
            except Exception as e:
                print(f"[PDF GENERATOR] WARNING: Could not delete old PDF (file locked): {e}")
        
        # Save new PDF to FileField
        print(f"[PDF GENERATOR] Saving PDF to offer.pdf field...")
        offer.pdf.save(filename, ContentFile(pdf_data), save=True)
        print(f"[PDF GENERATOR] PDF saved successfully")
        print(f"[PDF GENERATOR] PDF path: {offer.pdf.path if offer.pdf else 'No path'}")
        print(f"[PDF GENERATOR] PDF name: {offer.pdf.name if offer.pdf else 'No name'}")
        print(f"[PDF GENERATOR] ==========================================")
        
        return True
            
    except Exception as e:
        print(f"[PDF GENERATOR] ERROR generating PDF for offer {offer.id}: {e}")
        import traceback
        traceback.print_exc()
        return False
