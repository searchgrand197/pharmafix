"""
Production-ready email service for HR recruitment system.

Features:
- Centralized email sending logic
- Retry logic for transient failures
- Non-blocking execution (email failures don't block HR actions)
- Proper error logging
- Uses Django's send_mail with production-ready SSL configuration
"""

import logging
import time
from email.utils import format_datetime
from zoneinfo import ZoneInfo
from django.core.mail import EmailMultiAlternatives
from django.conf import settings
from django.template.loader import render_to_string
from django.utils import timezone

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")


def _ist_now():
    return timezone.now().astimezone(IST)


def _ist_headers():
    sent_at = _ist_now()
    return {
        "Date": format_datetime(sent_at),
        "X-Curevice-Local-Time": sent_at.strftime("%d %b %Y, %I:%M %p IST"),
        "X-Curevice-Time-Zone": "Asia/Kolkata",
    }


class EmailService:
    """Centralized email service for HR recruitment system."""
    
    MAX_RETRIES = 2
    RETRY_DELAY = 2  # seconds
    
    @classmethod
    def send_candidate_application_email(cls, candidate, job):
        """
        Send application confirmation email to candidate.
        
        Args:
            candidate: Candidate model instance
            job: JobOpening model instance
            
        Returns:
            bool: True if email sent successfully, False otherwise
        """
        subject = f"Application Received - {job.title}"

        from apps.hr.organization_branding import merge_branding_into_context, resolve_hospital_id

        hospital_id = resolve_hospital_id(job=job)
        context = merge_branding_into_context({
            'candidate_name': candidate.name,
            'job_title': job.title,
            'application_date': timezone.localtime(candidate.created_at, IST).strftime('%d %b %Y, %I:%M %p IST'),
        }, hospital_id=hospital_id)
        
        text_message = cls._render_text_template('application_confirmation.txt', context)
        html_message = cls._render_html_template('application_confirmation.html', context)
        
        return cls._send_with_retry(
            subject=subject,
            message=text_message,
            html_message=html_message,
            recipient=candidate.email,
            email_type='application_confirmation'
        )
    
    @classmethod
    def send_candidate_status_email(cls, candidate, new_status):
        """
        Send status update email to candidate.
        
        Args:
            candidate: Candidate model instance
            new_status: str ('shortlisted' or 'rejected')
            
        Returns:
            bool: True if email sent successfully, False otherwise
        """
        if new_status == 'shortlisted':
            subject = f"Interview Update - {candidate.job_opening.title}"
            template_text = 'shortlist_notification.txt'
            template_html = 'shortlist_notification.html'
        elif new_status == 'rejected':
            subject = f"Application Status - {candidate.job_opening.title}"
            template_text = 'rejection_notification.txt'
            template_html = 'rejection_notification.html'
        else:
            logger.warning(f"Unknown status for email: {new_status}")
            return False
        
        context = {
            'candidate_name': candidate.name,
            'job_title': candidate.job_opening.title,
            'application_id': candidate.application_code or '',
            'candidate_id': (
                candidate.profile.candidate_code if getattr(candidate, 'profile_id', None) and candidate.profile_id else ''
            ),
        }
        
        text_message = cls._render_text_template(template_text, context)
        html_message = cls._render_html_template(template_html, context)
        
        return cls._send_with_retry(
            subject=subject,
            message=text_message,
            html_message=html_message,
            recipient=candidate.email,
            email_type=f'status_{new_status}'
        )
    
    @classmethod
    def _send_with_retry(cls, subject, message, html_message, recipient, email_type):
        """
        Send email with retry logic for transient failures.
        
        Args:
            subject: Email subject
            message: Plain text email body
            html_message: HTML email body
            recipient: Recipient email address
            email_type: Type of email for logging
            
        Returns:
            bool: True if email sent successfully, False otherwise
        """
        for attempt in range(cls.MAX_RETRIES + 1):
            try:
                email = EmailMultiAlternatives(
                    subject=subject,
                    body=message,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    to=[recipient],
                    headers=_ist_headers(),
                )
                if html_message:
                    email.attach_alternative(html_message, "text/html")
                result = email.send(fail_silently=False)
                
                if result == 1:
                    logger.info(f"Email sent successfully: {email_type} to {recipient}")
                    return True
                else:
                    logger.warning(f"Email send returned unexpected result: {result}")
                    
            except Exception as e:
                logger.error(f"Email send attempt {attempt + 1}/{cls.MAX_RETRIES + 1} failed for {email_type}: {e}")
                
                if attempt < cls.MAX_RETRIES:
                    time.sleep(cls.RETRY_DELAY)
                else:
                    logger.error(f"All retry attempts failed for {email_type} to {recipient}")
        
        return False
    
    @classmethod
    def _render_text_template(cls, template_name, context):
        """Render plain text email template."""
        try:
            # For now, build simple text message inline
            # In production, you can create actual template files
            if 'application' in template_name:
                return f"""Dear {context['candidate_name']},

Thank you for applying for the position of {context['job_title']} at our organization.

We have received your application and will review it shortly. If your profile matches our requirements, our HR team will contact you for further rounds of the selection process.

Application Details:
- Position: {context['job_title']}
- Application Date: {context['application_date']}

We appreciate your interest in joining our team.

Best regards,
{context.get('hr_name') or 'HR Team'}
{context.get('company_name') or ''}
"""
            elif 'shortlist' in template_name:
                return f"""Dear {context['candidate_name']},

Congratulations! Your application for the position of {context['job_title']} has been shortlisted.

Our HR team will contact you soon to schedule an interview round. Please keep your documents ready and ensure your contact details are up to date.

We look forward to meeting you.

Application Details:
- Position: {context['job_title']}
- Application ID: {context['application_id']}

Best regards,
HR Team
"""
            elif 'rejection' in template_name:
                return f"""Dear {context['candidate_name']},

Thank you for your interest in the position of {context['job_title']}.

After careful consideration, we regret to inform you that your application has not been selected for further consideration at this time.

We appreciate the time you invested in applying to our organization and wish you the best in your future endeavors.

Application Details:
- Position: {context['job_title']}
- Application ID: {context['application_id']}

Best regards,
HR Team
"""
            else:
                return message
        except Exception as e:
            logger.error(f"Error rendering text template {template_name}: {e}")
            return str(context)
    
    @classmethod
    def _render_html_template(cls, template_name, context):
        """Render HTML email template."""
        try:
            # For now, build simple HTML message inline
            # In production, you can create actual template files
            if 'application' in template_name:
                return f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body {{ font-family: Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 0; }}
    .wrapper {{ max-width: 560px; margin: 32px auto; background: #fff;
                border-radius: 10px; overflow: hidden;
                box-shadow: 0 2px 10px rgba(0,0,0,.08); }}
    .header {{ background: #667eea; padding: 24px 32px; }}
    .header h1 {{ color: #fff; margin: 0; font-size: 20px; }}
    .header p  {{ color: #bfdbfe; margin: 4px 0 0; font-size: 13px; }}
    .body {{ padding: 28px 32px; }}
    .greeting {{ font-size: 15px; color: #374151; margin-bottom: 16px; }}
    .content {{ font-size: 14px; color: #374151; line-height: 1.6; margin-bottom: 20px; }}
    .info-box {{ background: #f0f9ff; border-left: 4px solid #3b82f6;
                 border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; }}
    .info-box table {{ border-collapse: collapse; width: 100%; }}
    .info-box td {{ padding: 4px 0; font-size: 14px; color: #1e293b; }}
    .info-box td:first-child {{ font-weight: 600; width: 140px; color: #64748b; }}
    .footer {{ background: #f8fafc; padding: 16px 32px; font-size: 12px; color: #94a3b8;
               border-top: 1px solid #e2e8f0; }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Application Received</h1>
      <p>HR Recruitment System</p>
    </div>
    <div class="body">
      <p class="greeting">Dear {context['candidate_name']},</p>
      <p class="content">
        Thank you for applying for the position of <strong>{context['job_title']}</strong> at our organization.
      </p>
      <p class="content">
        We have received your application and will review it shortly. If your profile matches our requirements, our HR team will contact you for further rounds of the selection process.
      </p>
      <div class="info-box">
        <table>
          <tr><td>Position</td><td>{context['job_title']}</td></tr>
          <tr><td>Application Date</td><td>{context['application_date']}</td></tr>
        </table>
      </div>
      <p class="content">
        We appreciate your interest in joining our team.
      </p>
      <p class="content">
        Best regards,<br>
        <strong>{context.get('hr_name') or 'HR Team'}</strong><br>
        {context.get('hr_designation') or ''}<br>
        {context.get('company_name') or ''}
      </p>
    </div>
    <div class="footer">
      {(context.get('company_name') or 'HR')} &mdash; automated notification &mdash; do not reply
    </div>
  </div>
</body>
</html>
"""
            elif 'shortlist' in template_name:
                return f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body {{ font-family: Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 0; }}
    .wrapper {{ max-width: 560px; margin: 32px auto; background: #fff;
                border-radius: 10px; overflow: hidden;
                box-shadow: 0 2px 10px rgba(0,0,0,.08); }}
    .header {{ background: #16a34a; padding: 24px 32px; }}
    .header h1 {{ color: #fff; margin: 0; font-size: 20px; }}
    .header p  {{ color: #dcfce7; margin: 4px 0 0; font-size: 13px; }}
    .body {{ padding: 28px 32px; }}
    .greeting {{ font-size: 15px; color: #374151; margin-bottom: 16px; }}
    .content {{ font-size: 14px; color: #374151; line-height: 1.6; margin-bottom: 20px; }}
    .footer {{ background: #f8fafc; padding: 16px 32px; font-size: 12px; color: #94a3b8;
               border-top: 1px solid #e2e8f0; }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Interview Update</h1>
      <p>HR Recruitment System</p>
    </div>
    <div class="body">
      <p class="greeting">Dear {context['candidate_name']},</p>
      <p class="content">
        Congratulations! Your application for the position of <strong>{context['job_title']}</strong> has been shortlisted.
      </p>
      <p class="content">
        Our HR team will contact you soon to schedule an interview round. Please keep your documents ready and ensure your contact details are up to date.
      </p>
      <p class="content">
        We look forward to meeting you.
      </p>
      <p class="content">
        Application Details:<br>
        - Position: {context['job_title']}<br>
        - Application ID: {context['application_id']}
      </p>
      <p class="content">
        Best regards,<br>
        HR Team
      </p>
    </div>
    <div class="footer">
      HR Recruitment System &mdash; automated notification &mdash; do not reply
    </div>
  </div>
</body>
</html>
"""
            elif 'rejection' in template_name:
                return f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body {{ font-family: Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 0; }}
    .wrapper {{ max-width: 560px; margin: 32px auto; background: #fff;
                border-radius: 10px; overflow: hidden;
                box-shadow: 0 2px 10px rgba(0,0,0,.08); }}
    .header {{ background: #dc2626; padding: 24px 32px; }}
    .header h1 {{ color: #fff; margin: 0; font-size: 20px; }}
    .header p  {{ color: #fecaca; margin: 4px 0 0; font-size: 13px; }}
    .body {{ padding: 28px 32px; }}
    .greeting {{ font-size: 15px; color: #374151; margin-bottom: 16px; }}
    .content {{ font-size: 14px; color: #374151; line-height: 1.6; margin-bottom: 20px; }}
    .footer {{ background: #f8fafc; padding: 16px 32px; font-size: 12px; color: #94a3b8;
               border-top: 1px solid #e2e8f0; }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Application Status</h1>
      <p>HR Recruitment System</p>
    </div>
    <div class="body">
      <p class="greeting">Dear {context['candidate_name']},</p>
      <p class="content">
        Thank you for your interest in the position of <strong>{context['job_title']}</strong>.
      </p>
      <p class="content">
        After careful consideration, we regret to inform you that your application has not been selected for further consideration at this time.
      </p>
      <p class="content">
        We appreciate the time you invested in applying to our organization and wish you the best in your future endeavors.
      </p>
      <p class="content">
        Application Details:<br>
        - Position: {context['job_title']}<br>
        - Application ID: {context['application_id']}
      </p>
      <p class="content">
        Best regards,<br>
        HR Team
      </p>
    </div>
    <div class="footer">
      HR Recruitment System &mdash; automated notification &mdash; do not reply
    </div>
  </div>
</body>
</html>
"""
            else:
                return message
        except Exception as e:
            logger.error(f"Error rendering HTML template {template_name}: {e}")
            return str(context)
