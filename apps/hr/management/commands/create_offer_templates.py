from django.core.management.base import BaseCommand
from apps.hr.models import OfferTemplate


class Command(BaseCommand):
    help = 'Create default offer templates if none exist'

    def handle(self, *args, **options):
        # Check if templates already exist
        if OfferTemplate.objects.exists():
            self.stdout.write(self.style.WARNING('Offer templates already exist. Skipping creation.'))
            return

        self.stdout.write('Creating default offer templates...')

        # Template 1: Software Engineer
        template1 = OfferTemplate.objects.create(
            name="Software Engineer Offer",
            content="""Dear {candidate_name},

We are pleased to offer you the position of {job_title} at {company_name}.

Your compensation details are as follows:
CTC: ₹{ctc:,}
Basic Salary: ₹{basic_salary:,}
HRA: ₹{hra:,}
Allowances: ₹{allowances:,}
Bonus: ₹{bonus:,}

Joining Date: {joining_date}
Work Location: {job_location}
Work Shift: {work_shift}
Working Hours: {working_hours}

Probation Period: {probation_period}
Notice Period: {notice_period}

{terms_conditions}

We look forward to your contribution to our team.

Sincerely,
{hr_name}
{hr_designation}
{company_name}
""",
            company_name="IntVice Technologies",
            company_address="Tech Park, Whitefield, Bangalore - 560066, Karnataka, India",
            company_email="hr@intvice.com",
            company_phone="+91 9876543210",
            hr_name="Rajesh Kumar",
            hr_designation="HR Manager",
            job_title="Software Engineer",
            department="Engineering",
            job_location="Bangalore",
            employment_type="Full-time",
            default_ctc=600000.00,
            default_basic_salary=25000.00,
            default_hra=10000.00,
            default_allowances=5000.00,
            default_bonus=50000.00,
            default_work_shift="Day Shift (9 AM - 6 PM)",
            default_working_hours="9 hours",
            default_weekly_off="Saturday, Sunday",
            default_probation_period="6 Months",
            default_notice_period="30 Days",
            terms_conditions="This offer is subject to satisfactory completion of background verification and submission of required documents. You will be required to sign a confidentiality agreement and abide by company policies at all times."
        )

        # Template 2: HR Executive
        template2 = OfferTemplate.objects.create(
            name="HR Executive Offer",
            content="""Dear {candidate_name},

We are pleased to offer you the position of {job_title} at {company_name}.

Your compensation details are as follows:
CTC: ₹{ctc:,}
Basic Salary: ₹{basic_salary:,}
HRA: ₹{hra:,}
Allowances: ₹{allowances:,}
Bonus: ₹{bonus:,}

Joining Date: {joining_date}
Work Location: {job_location}
Work Shift: {work_shift}
Working Hours: {working_hours}

Probation Period: {probation_period}
Notice Period: {notice_period}

{terms_conditions}

We look forward to your contribution to our team.

Sincerely,
{hr_name}
{hr_designation}
{company_name}
""",
            company_name="IntVice Technologies",
            company_address="Tech Park, Whitefield, Bangalore - 560066, Karnataka, India",
            company_email="hr@intvice.com",
            company_phone="+91 9876543210",
            hr_name="Rajesh Kumar",
            hr_designation="HR Manager",
            job_title="HR Executive",
            department="Human Resources",
            job_location="Bangalore",
            employment_type="Full-time",
            default_ctc=400000.00,
            default_basic_salary=18000.00,
            default_hra=7200.00,
            default_allowances=3000.00,
            default_bonus=30000.00,
            default_work_shift="Day Shift (9 AM - 6 PM)",
            default_working_hours="9 hours",
            default_weekly_off="Saturday, Sunday",
            default_probation_period="3 Months",
            default_notice_period="15 Days",
            terms_conditions="This offer is subject to satisfactory completion of background verification and submission of required documents. You will be required to sign a confidentiality agreement and abide by company policies at all times."
        )

        # Template 3: Intern
        template3 = OfferTemplate.objects.create(
            name="Software Intern Offer",
            content="""Dear {candidate_name},

We are pleased to offer you the position of {job_title} at {company_name}.

Your compensation details are as follows:
Stipend: ₹{ctc:,}
Basic: ₹{basic_salary:,}
HRA: ₹{hra:,}
Allowances: ₹{allowances:,}

Joining Date: {joining_date}
Work Location: {job_location}
Work Shift: {work_shift}
Working Hours: {working_hours}

Internship Duration: {probation_period}
Notice Period: {notice_period}

{terms_conditions}

We look forward to your contribution to our team.

Sincerely,
{hr_name}
{hr_designation}
{company_name}
""",
            company_name="IntVice Technologies",
            company_address="Tech Park, Whitefield, Bangalore - 560066, Karnataka, India",
            company_email="hr@intvice.com",
            company_phone="+91 9876543210",
            hr_name="Rajesh Kumar",
            hr_designation="HR Manager",
            job_title="Software Intern",
            department="Engineering",
            job_location="Bangalore",
            employment_type="Internship",
            default_ctc=15000.00,
            default_basic_salary=8000.00,
            default_hra=3000.00,
            default_allowances=2000.00,
            default_bonus=0.00,
            default_work_shift="Day Shift (10 AM - 5 PM)",
            default_working_hours="6 hours",
            default_weekly_off="Saturday, Sunday",
            default_probation_period="6 Months",
            default_notice_period="7 Days",
            terms_conditions="This internship offer is subject to satisfactory completion of background verification. You will be required to sign an internship agreement and abide by company policies at all times. Performance will be evaluated at the end of the internship period."
        )

        self.stdout.write(self.style.SUCCESS(f'Successfully created 3 offer templates:'))
        self.stdout.write(f'  1. {template1.name} - {template1.job_title}')
        self.stdout.write(f'  2. {template2.name} - {template2.job_title}')
        self.stdout.write(f'  3. {template3.name} - {template3.job_title}')
