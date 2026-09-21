from xhtml2pdf import pisa
from io import BytesIO

def generate_pdf_from_html(html):
    result = BytesIO()
    pisa_status = pisa.CreatePDF(html, dest=result)

    if pisa_status.err:
        return None

    return result.getvalue()
