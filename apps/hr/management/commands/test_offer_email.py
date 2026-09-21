from django.core.management.base import BaseCommand
from apps.hr.models import Candidate, Offer, OfferTemplate, JobOpening
from datetime import datetime, timedelta


class Command(BaseCommand):
    help = 'Test sending offer email with PDF to ajayrana07721@gmail.com for JOB009 candidate'

    def handle(self, *args, **options):
        self.stdout.write('=== Testing Offer Email with PDF ===')
        
        # Find JobOpening with job_code JOB009
        try:
            job = JobOpening.objects.get(job_code='JOB009')
            self.stdout.write(f'Found Job: {job.job_code} - {job.title}')
        except JobOpening.DoesNotExist:
            self.stdout.write(self.style.ERROR('Job JOB009 not found'))
            return
        
        # Find candidate for JOB009
        candidate = Candidate.objects.filter(job_opening=job).first()
        if not candidate:
            self.stdout.write(self.style.ERROR('No candidate found for JOB009'))
            return
        
        self.stdout.write(f'Found Candidate: {candidate.name} ({candidate.email})')
        
        # Check if candidate is in 'selected' status
        if candidate.status != 'selected':
            self.stdout.write(self.style.WARNING(f'Candidate status is {candidate.status}, changing to selected'))
            candidate.status = 'selected'
            candidate.save()
        
        # Get an offer template
        template = OfferTemplate.objects.first()
        if not template:
            self.stdout.write(self.style.ERROR('No offer template found'))
            return
        
        self.stdout.write(f'Using Template: {template.name}')
        
        # Check if offer already exists
        existing_offer = Offer.objects.filter(candidate=candidate).first()
        if existing_offer:
            self.stdout.write(self.style.WARNING(f'Offer already exists: {existing_offer.id}'))
            offer = existing_offer
        else:
            # Create offer
            self.stdout.write('Creating new offer...')
            offer = Offer.objects.create(
                candidate=candidate,
                job=job,
                template=template,
                
                # Candidate Snapshot
                candidate_name=candidate.name,
                candidate_email=candidate.email,
                candidate_address=candidate.address or '',
                
                # Company Snapshot
                company_name=template.company_name,
                company_address=template.company_address,
                company_email=template.company_email,
                company_phone=template.company_phone,
                
                # HR Signature Snapshot
                hr_name=template.hr_name,
                hr_designation=template.hr_designation,
                
                # Job Snapshot
                job_title=template.job_title,
                department=template.department,
                job_location=template.job_location,
                employment_type=template.employment_type,
                
                # Salary Details
                ctc=template.default_ctc,
                basic_salary=template.default_basic_salary,
                hra=template.default_hra,
                allowances=template.default_allowances,
                bonus=template.default_bonus,
                
                # Work Details
                joining_date=datetime.now().date() + timedelta(days=7),
                work_shift=template.default_work_shift,
                working_hours=template.default_working_hours,
                weekly_off=template.default_weekly_off,
                
                # Policies
                probation_period=template.default_probation_period,
                notice_period=template.default_notice_period,
                terms_conditions=template.terms_conditions,
                
                # Offer Control
                offer_expiry_date=datetime.now().date() + timedelta(days=30),
                status='created'
            )
            self.stdout.write(f'Offer created: {offer.id}')
        
        # Generate PDF
        self.stdout.write('Generating PDF...')
        try:
            from apps.hr.utils.pdf_generator import generate_offer_pdf
            pdf_result = generate_offer_pdf(offer)
            if pdf_result:
                self.stdout.write(self.style.SUCCESS('PDF generated successfully'))
                offer.refresh_from_db()
                self.stdout.write(f'PDF path: {offer.pdf.path if offer.pdf else "No path"}')
            else:
                self.stdout.write(self.style.ERROR('PDF generation failed'))
                return
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'PDF generation error: {e}'))
            import traceback
            traceback.print_exc()
            return
        
        # Override candidate email for testing
        original_email = offer.candidate_email
        test_email = "ankitshird56@gmail.com"
        print(f"Testing email to: {test_email}")
        offer.candidate_email = test_email
        self.stdout.write(f'Testing email to: {offer.candidate_email}')
        
        # Send email
        self.stdout.write('Sending email...')
        try:
            from apps.hr.email_utils import send_offer_email
            email_result = send_offer_email(offer)
            if email_result:
                offer.status = 'sent'
                offer.save()
                self.stdout.write(self.style.SUCCESS('Email sent successfully!'))
            else:
                self.stdout.write(self.style.ERROR('Email sending failed'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'Email sending error: {e}'))
            import traceback
            traceback.print_exc()
        
        # Restore original email
        offer.candidate_email = original_email
        offer.save()
        
        self.stdout.write(self.style.SUCCESS('=== Test Complete ==='))
        self.stdout.write(f'Offer ID: {offer.id}')
        self.stdout.write(f'Candidate: {candidate.name} ({candidate.email})')
        self.stdout.write(f'PDF: {offer.pdf.path if offer.pdf else "No PDF"}')
        self.stdout.write(f'Status: {offer.status}')
