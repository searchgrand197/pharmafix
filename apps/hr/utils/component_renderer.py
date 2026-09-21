def replace_variables(text, context):
    if not text:
        return ""

    for key, value in context.items():
        text = text.replace("{{" + key + "}}", str(value))

    return text

def build_text_style(data, default_size="", default_color=""):
    parts = []
    font_size = (data.get("font_size") or default_size or "").strip()
    text_color = (data.get("text_color") or default_color or "").strip()

    if font_size:
        parts.append(f"font-size:{font_size};")
    if text_color:
        parts.append(f"color:{text_color};")

    return " ".join(parts)

def render_header(data, context):
    company_name = replace_variables(data.get("company_name", ""), context)
    company_name_html = company_name.replace("\n", "<br>")
    logo_url = replace_variables(data.get("logo_url", ""), context)
    date = replace_variables(data.get("date", ""), context)
    text_style = build_text_style(data)

    logo_html = f"<img src='{logo_url}' style='height:60px; object-fit:contain;' />" if logo_url else ""
    date_html = f"<div style='text-size:12px; color:#666; margin-top:5px;'>Date: {date}</div>" if date else ""

    return f"""
    <table width="100%" border="0" style="margin-bottom:20px;">
        <tr>
            <td valign="top">
                {logo_html}
                <div style='margin-top:5px; {text_style}'>
                    <strong>{company_name_html}</strong>
                </div>
            </td>
            <td valign="top" align="right" style="font-size:12px; color:#666;">
                {date_html}
            </td>
        </tr>
    </table>
    """

def render_title(data):
    text = data.get("text", "")
    text_style = build_text_style(data, default_size="24px", default_color="#2E2A5E")

    return f"""
    <div style='text-align:center; font-weight:bold; margin:30px 0; {text_style}'>
        {text}
    </div>
    """

def render_paragraph(data, context):
    text = replace_variables(data.get("text", ""), context)
    text_html = text.replace("\n", "<br>")
    text_style = build_text_style(data)

    return f"""
    <div style='margin-bottom:15px; line-height:1.6; {text_style}'>
        {text_html}
    </div>
    """

def render_salary_table(data, context):
    title = data.get("title", "")
    columns = data.get("columns", [])
    rows_data = data.get("rows", [])
    text_style = build_text_style(data)

    header_html = "".join([f"<th style='background-color:#f8f9fa; border:1px solid #dee2e6; padding:8px; text-align:left;'>{col}</th>" for col in columns])

    rows_html = ""
    for row in rows_data:
        row_html = ""
        for cell in row:
            value = replace_variables(cell, context)
            row_html += f"<td style='border:1px solid #dee2e6; padding:8px;'>{value}</td>"

        rows_html += f"<tr>{row_html}</tr>"

    title_html = f"<div style='font-weight:bold; margin-bottom:8px; color:#2E2A5E;'>{title}</div>" if title else ""

    return f"""
    <div style='margin-bottom:20px; {text_style}'>
        {title_html}
        <table border='0' cellspacing='0' cellpadding='0' width='100%' style='border-collapse:collapse;'>
            <tr>{header_html}</tr>
            {rows_html}
        </table>
    </div>
    """

def render_terms_block(data, context):
    content = replace_variables(data.get("content", ""), context)
    content_html = content.replace("\n", "<br>")
    text_style = build_text_style(data)

    return f"""
    <div style='margin-bottom:20px; padding:15px; background-color:#f8f9fa; border-left:4px solid #2E2A5E; font-size:12px; {text_style}'>
        {content_html}
    </div>
    """

def render_signature(data, context):
    company_name = replace_variables(data.get("company_name", ""), context)
    hr_name = replace_variables(data.get("hr_name", ""), context)
    designation = replace_variables(data.get("designation", ""), context)
    candidate_name = replace_variables(data.get("candidate_name", ""), context)
    signature_url = replace_variables(data.get("signature_url", ""), context)
    text_style = build_text_style(data)

    signature_img = f"<img src='{signature_url}' style='height:45px; object-fit:contain; margin-bottom:5px;' />" if signature_url else "<div style='height:40px;'></div>"

    return f"""
    <table width="100%" border="0" style="margin-top:25px; {text_style}">
        <tr>
            <td width="50%" valign="bottom">
                <p style="margin-bottom:8px; font-size:12px;">For <strong>{company_name}</strong></p>
                {signature_img}
                <div style="border-top:1px solid #333; width:180px; margin-bottom:4px;"></div>
                <p style="font-size:12px;"><strong>{hr_name}</strong><br><span style="color:#666; font-size:11px;">{designation}</span></p>
            </td>
            <td width="50%" valign="bottom" align="right">
                <p style="text-align:right; margin-bottom:8px; font-style:italic; color:#999; font-size:10px;">Accepted By Candidate</p>
                <div style="height:40px;"></div>
                <div style="border-top:1px solid #333; width:180px; margin-bottom:4px; margin-left:auto;"></div>
                <p style="text-align:right; font-size:12px;"><strong>{candidate_name}</strong></p>
            </td>
        </tr>
    </table>
    """

def render_section_card(data, context):
    title = data.get("title", "")
    items = data.get("items", [])
    text_style = build_text_style(data)

    rows = ""
    for item in items:
        label = item.get("label")
        value = replace_variables(item.get("value"), context)

        rows += f"<p style='margin:4px 0;'><strong>{label}:</strong> {value}</p>"

    return f"""
    <div style='border:1px solid #eee; padding:15px; margin-bottom:15px; border-radius:8px; background-color:#fff; box-shadow:0 2px 4px rgba(0,0,0,0.02); {text_style}'>
        <div style='font-weight:bold; margin-bottom:10px; border-bottom:1px solid #eee; pb:5px; color:#2E2A5E;'>{title}</div>
        {rows}
    </div>
    """

def render_table(data, context):
    title = data.get("title", "")
    columns = data.get("columns", [])
    rows_data = data.get("rows", [])
    text_style = build_text_style(data)

    header_html = "".join([f"<th>{col}</th>" for col in columns])

    rows_html = ""
    for row in rows_data:
        row_html = ""
        for cell in row:
            value = replace_variables(cell, context)
            row_html += f"<td>{value}</td>"

        rows_html += f"<tr>{row_html}</tr>"

    return f"""
    <div style='margin-bottom:10px; {text_style}'>
        <div style='font-weight:bold; margin-bottom:5px;'>{title}</div>
        <table border='1' cellspacing='0' cellpadding='5' width='100%'>
            <tr>{header_html}</tr>
            {rows_html}
        </table>
    </div>
    """

def render_image(data, context):
    url = replace_variables(data.get("url", ""), context)
    align = data.get("align", "center")
    width = data.get("width", "180px")
    height = data.get("height", "80px")
    x = data.get("x", "0px")
    y = data.get("y", "0px")
    
    return f"""
    <div style='text-align:{align}; margin: 10px 0;'>
        <img src='{url}' style='width:{width}; height:{height}; object-fit:contain; display:inline-block; margin-left:{x}; margin-top:{y};' />
    </div>
    """

def render_bullet_points(data, context):
    title = data.get("title", "")
    items = data.get("items", [])
    text_style = build_text_style(data)
    
    li_html = ""
    for item in items:
        value = replace_variables(item, context)
        li_html += f"<li>{value}</li>"
        
    title_html = f"<div style='font-weight:bold; margin-bottom:5px;'>{title}</div>" if title else ""
    
    return f"""
    <div style='margin-bottom:10px; {text_style}'>
        {title_html}
        <ul style='margin-top:0;'>
            {li_html}
        </ul>
    </div>
    """

def render_signature_footer(data, context):
    signatory_name = replace_variables(data.get("signatory_name", "HR Manager"), context)
    signatory_title = replace_variables(data.get("signatory_title", ""), context)
    company_name = replace_variables(data.get("company_name", ""), context)
    candidate_name = replace_variables(data.get("candidate_name", "{{candidate_name}}"), context)
    text_style = build_text_style(data)
    
    return f"""
    <table width="100%" style="margin-top:25px; {text_style}" border="0">
        <tr>
            <td width="50%" valign="top">
                <p style="font-size:12px;">Sincerely,</p>
                <div style="height:40px;"></div>
                <div style="border-top:1px solid #333; width:180px; margin-bottom:4px;"></div>
                <p style="font-size:12px;"><strong>{signatory_name}</strong></p>
                <p style="font-size:11px; color:#666;">{signatory_title}</p>
                <p style="font-size:11px; color:#666;">{company_name}</p>
            </td>
            <td width="50%" valign="top">
                <p style="text-align: left; font-size:12px;">Accepted By:</p>
                <div style="height:40px;"></div>
                <div style="border-top:1px solid #333; width:180px; margin-bottom:4px;"></div>
                <p style="text-align: left; font-size:12px;"><strong>{candidate_name}</strong></p>
                <p style="text-align: left; font-size:11px; color:#666;">Date: _______________</p>
            </td>
        </tr>
    </table>
    """

def wrap_html(content):
    return f"""
    <html>
    <head>
        <style>
            body {{
                font-family: Arial;
                font-size: 12px;
                padding: 20px;
            }}
        </style>
    </head>
    <body>
        {content}
    </body>
    </html>
    """

def render_offer_template(template_json, context):
    """
    template_json: JSON from ComponentOfferTemplate
    context: dictionary with actual data
    """

    html = ""

    blocks = template_json.get("blocks", [])

    for block in blocks:
        block_type = block.get("type")
        data = block.get("data", {})

        if block_type == "header":
            html += render_header(data, context)

        elif block_type == "title":
            html += render_title(data)

        elif block_type == "paragraph":
            html += render_paragraph(data, context)

        elif block_type == "section_card":
            html += render_section_card(data, context)

        elif block_type == "salary_table":
            html += render_salary_table(data, context)

        elif block_type == "terms_block":
            html += render_terms_block(data, context)

        elif block_type == "signature":
            html += render_signature(data, context)

        elif block_type == "table":
            html += render_table(data, context)
            
        elif block_type == "image":
            html += render_image(data, context)
            
        elif block_type == "bullet_points":
            html += render_bullet_points(data, context)
            
        elif block_type == "signature_footer":
            html += render_signature_footer(data, context)

    return wrap_html(html)

def test_render():
    from apps.hr.models import ComponentOfferTemplate
    
    template = ComponentOfferTemplate.objects.first()
    
    if not template:
        print("No ComponentOfferTemplate found.")
        return

    context = {
        "company_name": "Curevice Pvt Ltd",
        "candidate_name": "Ankit",
        "job_title": "Software Engineer",
        "job_location": "Delhi",
        "joining_date": "10 May 2026",
        "ctc": "6,00,000"
    }

    html = render_offer_template(template.design_json, context)

    print(html)
