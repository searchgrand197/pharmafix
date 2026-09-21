"""
Email service for HR recruitment system.

This module provides centralized email sending functionality for
candidate recruitment events including:
- Application confirmation
- Shortlist notification  
- Rejection notification

Usage:
    from apps.hr.utils.email_service import send_candidate_email
    
    # Send application confirmation
    send_candidate_email(
        subject="Application Received",
        message="Your application has been received...",
        recipient_email="candidate@example.com"
    )
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from django.conf import settings

logger = logging.getLogger(__name__)


def send_candidate_email(subject, message, recipient_email, html_message=None):
    """
    Send an email to a candidate using direct SMTP with SSL verification disabled.
    
    Args:
        subject (str): Email subject line
        message (str): Plain text email body
        recipient_email (str): Candidate's email address
        html_message (str, optional): HTML version of email body
        
    Returns:
        bool: True if email sent successfully, False otherwise
        
    Example:
        >>> send_candidate_email(
        ...     subject="Application Received",
        ...     message="Dear Candidate, your application...",
        ...     recipient_email="candidate@example.com"
        ... )
        True
    """
    try:
        from_email = settings.DEFAULT_FROM_EMAIL
        
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = from_email
        msg["To"] = recipient_email
        msg["Reply-To"] = from_email
        msg["X-Priority"] = "3"
        msg["X-MSMail-Priority"] = "Normal"
        msg["Importance"] = "Normal"
        msg["X-Mailer"] = "HR Recruitment System"
        msg["Precedence"] = "bulk"
        msg.set_content(message)
        if html_message:
            msg.add_alternative(html_message, subtype="html")
        
        # SMTP configuration
        host = settings.EMAIL_HOST
        port = settings.EMAIL_PORT
        use_ssl = getattr(settings, "EMAIL_USE_SSL", False)
        use_tls = getattr(settings, "EMAIL_USE_TLS", False)
        user_smtp = settings.EMAIL_HOST_USER
        pwd_smtp = settings.EMAIL_HOST_PASSWORD
        
        if use_ssl:
            context = ssl.create_default_context()
            # Disable SSL certificate verification for self-signed certificates
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            with smtplib.SMTP_SSL(host, port, context=context) as server:
                if user_smtp and pwd_smtp:
                    server.login(user_smtp, pwd_smtp)
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port) as server:
                if use_tls:
                    server.starttls()
                if user_smtp and pwd_smtp:
                    server.login(user_smtp, pwd_smtp)
                server.send_message(msg)
        
        print(f"EMAIL SENT: {recipient_email}")
        logger.info(f"Email sent successfully to {recipient_email}")
        return True
            
    except Exception as e:
        print(f"EMAIL FAILED: {recipient_email} - Error: {e}")
        logger.error(f"Failed to send email to {recipient_email}: {e}")
        return False


def send_application_confirmation(candidate_name, job_title, recipient_email):
    """
    Send application confirmation email to candidate.
    
    Args:
        candidate_name (str): Name of the candidate
        job_title (str): Title of the job applied for
        recipient_email (str): Candidate's email address
        
    Returns:
        bool: True if email sent successfully
    """
    subject = "Application Received"
    
    message = f"""Dear {candidate_name},

Your application for {job_title} has been received successfully.
Our HR team will review your profile.

Best regards,
HR Team
"""
    
    html_message = f"""
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
      <h1>Application Received</h1>
    </div>
    <div class="body">
      <p class="greeting">Dear {candidate_name},</p>
      <p class="content">
        Your application for <strong>{job_title}</strong> has been received successfully.
        Our HR team will review your profile.
      </p>
      <p class="content">
        Best regards,<br>
        HR Team
      </p>
    </div>
    <div class="footer">
      HR Recruitment System &mdash; automated notification
    </div>
  </div>
</body>
</html>
"""
    
    return send_candidate_email(subject, message, recipient_email, html_message)


def send_shortlist_notification(candidate_name, job_title, recipient_email):
    """
    Send shortlist notification email to candidate.
    
    Args:
        candidate_name (str): Name of the candidate
        job_title (str): Title of the job
        recipient_email (str): Candidate's email address
        
    Returns:
        bool: True if email sent successfully
    """
    subject = "Shortlisted for Next Round"
    
    message = f"""Dear {candidate_name},

Congratulations! You have been shortlisted for the {job_title} role.
We will contact you with further details.

Best regards,
HR Team
"""
    
    html_message = f"""
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
      <h1>Shortlisted for Next Round</h1>
    </div>
    <div class="body">
      <p class="greeting">Dear {candidate_name},</p>
      <p class="content">
        Congratulations! You have been shortlisted for the <strong>{job_title}</strong> role.
        We will contact you with further details.
      </p>
      <p class="content">
        Best regards,<br>
        HR Team
      </p>
    </div>
    <div class="footer">
      HR Recruitment System &mdash; automated notification
    </div>
  </div>
</body>
</html>
"""
    
    return send_candidate_email(subject, message, recipient_email, html_message)


def send_rejection_notification(candidate_name, job_title, recipient_email, stage='before_interview'):
    """
    Send rejection notification email to candidate.
    
    Args:
        candidate_name (str): Name of the candidate
        job_title (str): Title of the job
        recipient_email (str): Candidate's email address
        stage (str): 'before_interview' or 'after_interview'
        
    Returns:
        bool: True if email sent successfully
    """
    if stage == 'after_interview':
        subject = "Interview Result - Application Status"
        message = f"""Dear {candidate_name},

Thank you for attending the interview for {job_title}.

After careful consideration, we regret to inform you that you have not been selected for this position.

We appreciate the time and effort you invested in the interview process and wish you the best in your future endeavors.

Best regards,
HR Team
"""
    else:
        subject = "Application Update"
        message = f"""Dear {candidate_name},

Thank you for applying for {job_title}.

After reviewing your application, we regret to inform you that we will not be proceeding further with your application at this time.

We wish you the best for your future.

Best regards,
HR Team
"""
    
    html_message = f"""
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
      <h1>{'Interview Result' if stage == 'after_interview' else 'Application Update'}</h1>
    </div>
    <div class="body">
      <p class="greeting">Dear {candidate_name},</p>
      <p class="content">
        {'Thank you for attending the interview for <strong>' + job_title + '</strong>.<br><br>After careful consideration, we regret to inform you that you have not been selected for this position.<br><br>We appreciate the time and effort you invested in the interview process and wish you the best in your future endeavors.' if stage == 'after_interview' else 'Thank you for applying for <strong>' + job_title + '</strong>.<br><br>After reviewing your application, we regret to inform you that we will not be proceeding further with your application at this time.<br><br>We wish you the best for your future.'}
      </p>
      <p class="content">
        Best regards,<br>
        HR Team
      </p>
    </div>
    <div class="footer">
      HR Recruitment System &mdash; automated notification
    </div>
  </div>
</body>
</html>
"""
    
    return send_candidate_email(subject, message, recipient_email, html_message)


def send_interview_email(candidate_name, job_title, recipient_email, interview_date, interview_type):
    """
    Send interview scheduled email to candidate.
    
    Args:
        candidate_name (str): Name of the candidate
        job_title (str): Title of the job
        recipient_email (str): Candidate's email address
        interview_date (str): Interview date and time
        interview_type (str): Type of interview (online/offline)
        
    Returns:
        bool: True if email sent successfully
    """
    subject = f"Interview Scheduled - {job_title}"
    
    from datetime import datetime
    try:
        formatted_date = datetime.strptime(interview_date, '%Y-%m-%dT%H:%M:%S').strftime('%B %d, %Y at %I:%M %p')
    except:
        formatted_date = interview_date
    
    interview_location = "Online" if interview_type == 'online' else "In-person at our office"
    
    message = f"""Dear {candidate_name},

We are pleased to inform you that your interview for the position of {job_title} has been scheduled.

Interview Details:
- Date & Time: {formatted_date}
- Type: {interview_location}

Please ensure you are available at the scheduled time. If you have any questions, feel free to contact us.

We look forward to meeting you!

Best regards,
HR Team
"""
    
    html_message = f"""
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
    .body {{ padding: 28px 32px; }}
    .greeting {{ font-size: 15px; color: #374151; margin-bottom: 16px; }}
    .content {{ font-size: 14px; color: #374151; line-height: 1.6; margin-bottom: 20px; }}
    .info-box {{ background: #f0f9ff; border-left: 4px solid #3b82f6;
                 border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; }}
    .info-row {{ display: flex; margin-bottom: 12px; }}
    .info-label {{ font-weight: 600; width: 140px; color: #64748b; }}
    .info-value {{ color: #1e293b; }}
    .footer {{ background: #f8fafc; padding: 16px 32px; font-size: 12px; color: #94a3b8;
               border-top: 1px solid #e2e8f0; }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Interview Scheduled</h1>
    </div>
    <div class="body">
      <p class="greeting">Dear {candidate_name},</p>
      <p class="content">
        We are pleased to inform you that your interview for the position of <strong>{job_title}</strong> has been scheduled.
      </p>
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Date & Time:</span>
          <span class="info-value">{formatted_date}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Type:</span>
          <span class="info-value">{interview_location}</span>
        </div>
      </div>
      <p class="content">
        Please ensure you are available at the scheduled time. If you have any questions, feel free to contact us.
      </p>
      <p class="content">
        We look forward to meeting you!
      </p>
      <p class="content">
        Best regards,<br>
        HR Team
      </p>
    </div>
    <div class="footer">
      HR Recruitment System &mdash; automated notification
    </div>
  </div>
</body>
</html>
"""
    
    return send_candidate_email(subject, message, recipient_email, html_message)


def send_selection_email(candidate_name, job_title, recipient_email):
    """
    Send selection notification email to candidate.
    
    Args:
        candidate_name (str): Name of the candidate
        job_title (str): Title of the job
        recipient_email (str): Candidate's email address
        
    Returns:
        bool: True if email sent successfully
    """
    subject = f"Congratulations! Selected for {job_title}"
    
    message = f"""Dear {candidate_name},

Congratulations! We are pleased to inform you that you have been selected for the position of {job_title}.

Our HR team will contact you shortly with the offer details and further steps.

We look forward to welcoming you to our team!

Best regards,
HR Team
"""
    
    html_message = f"""
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
    .body {{ padding: 28px 32px; }}
    .greeting {{ font-size: 15px; color: #374151; margin-bottom: 16px; }}
    .content {{ font-size: 14px; color: #374151; line-height: 1.6; margin-bottom: 20px; }}
    .highlight {{ background: #dcfce7; padding: 16px 20px; border-radius: 6px; 
                 border-left: 4px solid #16a34a; margin-bottom: 20px; }}
    .footer {{ background: #f8fafc; padding: 16px 32px; font-size: 12px; color: #94a3b8;
               border-top: 1px solid #e2e8f0; }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Congratulations!</h1>
    </div>
    <div class="body">
      <p class="greeting">Dear {candidate_name},</p>
      <p class="content">
        Congratulations! We are pleased to inform you that you have been selected for the position of <strong>{job_title}</strong>.
      </p>
      <div class="highlight">
        <strong>Next Steps:</strong><br>
        Our HR team will contact you shortly with the offer details and further steps.
      </div>
      <p class="content">
        We look forward to welcoming you to our team!
      </p>
      <p class="content">
        Best regards,<br>
        HR Team
      </p>
    </div>
    <div class="footer">
      HR Recruitment System &mdash; automated notification
    </div>
  </div>
</body>
</html>
"""
    
    return send_candidate_email(subject, message, recipient_email, html_message)
