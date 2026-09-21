import logging
from django.db import transaction
from apps.hr.models import Employee, Candidate, Offer
from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher
from apps.hr.onboarding_documents import (
    clear_employee_onboarding_uploads,
    get_employee_for_offer,
    should_reset_onboarding_docs_for_offer,
)
from apps.hr.payroll_api.department_structure_service import apply_department_from_offer

logger = logging.getLogger(__name__)

def convert_hired_candidate_to_employee(candidate):
    """
    Proper HR lifecycle: Offer → Hired → Employee → Active
    Converts a candidate who has accepted an offer into an official Employee record.
    """
    logger.info(f"[Conversion] Starting conversion for candidate: {candidate.name} ({candidate.id})")
    
    if candidate.status != 'hired':
        logger.warning(f"[Conversion] Candidate {candidate.id} status is {candidate.status}, expected 'hired'. Proceeding anyway as requested.")

    # Find the accepted offer
    offer = Offer.objects.filter(candidate=candidate, status='accepted').first()
    if not offer:
        # Fallback to any sent offer if no accepted one exists (safety check)
        offer = Offer.objects.filter(candidate=candidate, status='sent').first()
        if not offer:
            logger.error(f"[Conversion] No accepted or sent offer found for candidate {candidate.id}")
            return None, "No valid offer found for conversion."

    try:
        with transaction.atomic():
            # Step 3: Prefer employee already linked to this candidate/offer — avoid email-only collisions.
            employee = get_employee_for_offer(offer)
            if not employee and candidate.email:
                from apps.shared.email_normalization import email_iexact_filter
                employee = Employee.objects.filter(**email_iexact_filter(candidate.email)).first()

            if employee:
                logger.info(f"[Conversion] Reusing existing employee record for {candidate.email}")
                if should_reset_onboarding_docs_for_offer(employee, candidate, offer):
                    clear_employee_onboarding_uploads(employee)
            else:
                logger.info(f"[Conversion] Creating new employee record for {candidate.name}")
                employee = Employee(
                    name=candidate.name,
                    email=candidate.email,
                    phone=candidate.phone,
                    hospital=candidate.job_opening.hospital,
                )

            # Assign Details from Offer/Candidate
            employee.job_title = offer.job_title
            employee.salary = offer.ctc
            employee.joining_date = offer.joining_date
            apply_department_from_offer(employee, offer)

            # Step 4: Update Status
            employee.status = 'pending_onboarding'
            employee.onboarding_status = 'pending_documents'
            
            # Step 5: Link All Entities
            employee.candidate = candidate
            employee.offer = offer
            
            employee.save()
            from apps.hr.designation_utils import apply_designation_from_hire_sources

            apply_designation_from_hire_sources(employee, offer=offer)
            logger.info(f"[Conversion] Employee {employee.employee_id} saved successfully.")

            # Update Offer Status if not already accepted (token-accept path marks accepted before convert)
            if offer.status != 'accepted':
                offer.status = 'accepted'
                offer.save(update_fields=['status', 'updated_at'])

            # Welcome email runs only after successful commit; dispatch dedupes per Offer.
            trigger_onboarding(employee, offer)

            employee_id = employee.id

            def _offer_accepted_notification():
                from apps.hr.employee_portal_notifications import notify_offer_accepted
                from apps.hr.models import Employee

                emp = Employee.objects.filter(pk=employee_id).first()
                if emp:
                    notify_offer_accepted(emp)

            transaction.on_commit(_offer_accepted_notification)

            return employee, None

    except Exception as e:
        logger.error(f"[Conversion] Failed to convert candidate {candidate.id}: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return None, str(e)

def trigger_onboarding(employee, offer):
    """
    Queue welcome email and onboarding document link after the surrounding transaction commits.
    """
    logger.info(f"[Onboarding] Scheduling onboarding welcome for employee: {employee.name}")
    transaction.on_commit(
        lambda: EmailEventDispatcher.offer_accepted(employee, offer=offer, on_commit=False)
    )
