from django.core.management.base import BaseCommand
from apps.hr.models import ComponentOfferTemplate

class Command(BaseCommand):
    help = 'Seeds a TCS Style Professional Offer Letter into the ComponentOfferTemplate model.'

    def handle(self, *args, **kwargs):
        name = "TCS Style Professional Offer Letter"
        description = "Prebuilt corporate offer letter template similar to large enterprise HR systems"

        # Check if the template already exists
        if ComponentOfferTemplate.objects.filter(name=name).exists():
            template = ComponentOfferTemplate.objects.get(name=name)
            self.stdout.write(self.style.WARNING(f'Template already exists! ID: {template.id}'))
            self.stdout.write(self.style.SUCCESS('HR can now use or modify this template'))
            return

        design_json = {
            "blocks": [
                {
                    "type": "header",
                    "data": {
                        "company_name": "Your Company Name",
                        "tagline": "Confidential Offer Letter"
                    }
                },
                {
                    "type": "title",
                    "data": {
                        "text": "Letter of Employment"
                    }
                },
                {
                    "type": "section_card",
                    "data": {
                        "title": "🎉 Congratulations",
                        "items": [
                            {
                                "label": "",
                                "value": "We are pleased to offer you the position and welcome you to our organization."
                            }
                        ]
                    }
                },
                {
                    "type": "section_card",
                    "data": {
                        "title": "Candidate Information",
                        "items": [
                            {"label": "Full Name", "value": "{{candidate_name}}"},
                            {"label": "Email", "value": "{{candidate_email}}"},
                            {"label": "Position", "value": "{{job_title}}"},
                            {"label": "Location", "value": "{{job_location}}"}
                        ]
                    }
                },
                {
                    "type": "table",
                    "data": {
                        "title": "Compensation Breakdown (Annual)",
                        "columns": ["Component", "Amount"],
                        "rows": [
                            ["Base Salary", "{{basic_salary}}"],
                            ["HRA", "{{hra}}"],
                            ["Bonus", "{{bonus}}"],
                            ["Total CTC", "{{ctc}}"]
                        ]
                    }
                },
                {
                    "type": "section_card",
                    "data": {
                        "title": "Employment Details",
                        "items": [
                            {"label": "Joining Date", "value": "{{joining_date}}"},
                            {"label": "Work Mode", "value": "{{work_shift}}"},
                            {"label": "Reporting Manager", "value": "{{hr_name}}"}
                        ]
                    }
                },
                {
                    "type": "section_card",
                    "data": {
                        "title": "Terms & Conditions",
                        "items": [
                            {
                                "label": "",
                                "value": "This offer is subject to background verification and company policies."
                            }
                        ]
                    }
                }
            ]
        }

        template = ComponentOfferTemplate.objects.create(
            name=name,
            description=description,
            is_default=True,
            design_json=design_json
        )

        self.stdout.write(self.style.SUCCESS(f'Template created successfully! ID: {template.id}'))
        self.stdout.write(self.style.SUCCESS('HR can now use or modify this template'))
