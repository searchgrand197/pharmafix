# -*- coding: utf-8 -*-
"""
Management command: seed_full_offer_template

Adds a comprehensive, fully-editable sample offer-letter template
(named "Sample Corp Full Offer Letter") to the ComponentOfferTemplate model.
If the template already exists (by name), it will be skipped.
"""

import uuid
from django.core.management.base import BaseCommand
from apps.hr.models import ComponentOfferTemplate


class Command(BaseCommand):
    help = "Seed a complete sample offer-letter template (logo, bullets, footer, etc.)"

    TEMPLATE_NAME = "Sample Corp Full Offer Letter"
    TEMPLATE_DESCRIPTION = (
        "A realistic, fully-editable corporate offer letter containing logo, "
        "salary details, benefits bullet list, and a signature/footer section."
    )

    DESIGN_JSON = {
        "blocks": [
            # 1. Company Logo
            {
                "type": "image",
                "data": {
                    "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Tata_Consultancy_Services_Logo.svg/1280px-Tata_Consultancy_Services_Logo.svg.png",
                    "align": "center",
                    "height": "60px"
                }
            },
            # 2. Header
            {
                "type": "header",
                "data": {
                    "company_name": "{{company_name}}",
                    "tagline": "Confidential - For Addressee Only"
                }
            },
            # 3. Title
            {
                "type": "title",
                "data": {
                    "text": "Letter of Intent to Employ"
                }
            },
            # 4. Greeting / Intro
            {
                "type": "section_card",
                "data": {
                    "title": "Dear {{candidate_name}},",
                    "items": [
                        {
                            "label": "",
                            "value": (
                                "We are delighted to offer you the position of {{job_title}} at {{company_name}}. "
                                "After a thorough evaluation of your qualifications and experience, we are confident "
                                "that you will be a valuable addition to our team. This letter outlines the terms and "
                                "conditions of your employment."
                            )
                        }
                    ]
                }
            },
            # 5. Candidate / Job Information
            {
                "type": "section_card",
                "data": {
                    "title": "Appointment Details",
                    "items": [
                        {"label": "Full Name", "value": "{{candidate_name}}"},
                        {"label": "Designation", "value": "{{job_title}}"},
                        {"label": "Department", "value": "{{department}}"},
                        {"label": "Work Location", "value": "{{job_location}}"},
                        {"label": "Date of Joining", "value": "{{joining_date}}"},
                        {"label": "Employment Type", "value": "Full-Time, Permanent"},
                        {"label": "Work Mode", "value": "{{work_mode}}"}
                    ]
                }
            },
            # 6. Compensation Summary Card
            {
                "type": "section_card",
                "data": {
                    "title": "Compensation & Benefits Summary",
                    "items": [
                        {"label": "Annual CTC", "value": "INR {{ctc}}"},
                        {"label": "Basic Salary (Monthly)", "value": "INR {{base_salary}}"},
                        {"label": "HRA (Monthly)", "value": "INR {{hra}}"},
                        {"label": "Performance Bonus", "value": "INR {{bonus}} per annum"},
                        {"label": "Probation Period", "value": "6 Months"}
                    ]
                }
            },
            # 7. Detailed Salary Breakdown Table
            {
                "type": "table",
                "data": {
                    "title": "Annual Compensation Breakdown",
                    "columns": ["Component", "Monthly (INR)", "Annual (INR)"],
                    "rows": [
                        ["Basic Salary", "{{base_salary}}", "{{basic_annual}}"],
                        ["House Rent Allowance (HRA)", "{{hra}}", "{{hra_annual}}"],
                        ["Medical Allowance", "1,250", "15,000"],
                        ["Transport Allowance", "1,600", "19,200"],
                        ["Special Allowance", "As applicable", "As applicable"],
                        ["Performance Bonus", "-", "{{bonus}}"],
                        ["Provident Fund (Company)", "1,800", "21,600"],
                        ["Total CTC", "-", "{{ctc}}"]
                    ]
                }
            },
            # 8. Benefits
            {
                "type": "bullet_points",
                "data": {
                    "title": "Employee Benefits",
                    "items": [
                        "Medical & Accident Insurance (self + family)",
                        "Provident Fund (PF) as per government regulations",
                        "Gratuity as per the Payment of Gratuity Act",
                        "Paid Annual Leave: 20 days per year",
                        "Sick Leave: 12 days per year",
                        "Annual Performance Appraisal",
                        "Professional Development & Training Programs",
                        "Employee Assistance Programme (EAP)"
                    ]
                }
            },
            # 9. Terms & Conditions
            {
                "type": "section_card",
                "data": {
                    "title": "Terms & Conditions",
                    "items": [
                        {
                            "label": "Background Verification",
                            "value": "This offer is subject to successful completion of background and reference verification."
                        },
                        {
                            "label": "Notice Period",
                            "value": "60 days' notice is required by either party after the probation period."
                        },
                        {
                            "label": "Confidentiality",
                            "value": "You will be required to sign a Non-Disclosure Agreement (NDA) on your first day of joining."
                        },
                        {
                            "label": "Acceptance",
                            "value": "Please sign and return this letter within 7 working days to confirm your acceptance of this offer."
                        }
                    ]
                }
            },
            # 10. Closing Note
            {
                "type": "section_card",
                "data": {
                    "title": "",
                    "items": [
                        {
                            "label": "",
                            "value": (
                                "We look forward to welcoming you to our team. "
                                "Should you have any questions or require further clarification, please feel free to contact us at any time. "
                                "We wish you a great career ahead!"
                            )
                        }
                    ]
                }
            },
            # 11. Signature Footer
            {
                "type": "signature_footer",
                "data": {
                    "signatory_name": "{{hr_name}}",
                    "signatory_title": "Human Resources Manager",
                    "company_name": "{{company_name}}"
                }
            },
            # 12. Optional company seal / stamp at bottom
            {
                "type": "image",
                "data": {
                    "url": "https://via.placeholder.com/100x100?text=Company+Seal",
                    "align": "right",
                    "height": "80px"
                }
            }
        ]
    }

    def handle(self, *args, **options):
        if ComponentOfferTemplate.objects.filter(name=self.TEMPLATE_NAME).exists():
            self.stdout.write(
                self.style.WARNING(
                    f"Template '{self.TEMPLATE_NAME}' already exists - skipping creation."
                )
            )
            return

        tmpl = ComponentOfferTemplate.objects.create(
            name=self.TEMPLATE_NAME,
            description=self.TEMPLATE_DESCRIPTION,
            design_json=self.DESIGN_JSON,
            is_default=True,
            is_active=True,
            created_by=None,
        )

        self.stdout.write(self.style.SUCCESS(
            f"Created template '{tmpl.name}' (ID: {tmpl.id})"
        ))
        self.stdout.write("HR can now open the builder, select this template, and edit any block freely.")
