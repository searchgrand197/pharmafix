from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0066_employee_portal_provisioning'),
    ]

    operations = [
        migrations.AlterField(
            model_name='employeedocumentauditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('uploaded', 'Uploaded'),
                    ('approved', 'Approved'),
                    ('rejected', 'Rejected'),
                    ('reupload_requested', 'Re-upload Requested'),
                    ('physically_verified', 'Physically Verified'),
                    ('override_approved', 'Override Approved'),
                    ('employee_created', 'Employee Created'),
                    ('employee_activated', 'Employee Activated'),
                    ('portal_account_created', 'Portal Account Created'),
                    ('portal_provisioned', 'Portal Provisioned'),
                    ('welcome_email_sent', 'Welcome Email Sent'),
                    ('password_changed', 'Password Changed'),
                    ('final_reject', 'Final Reject'),
                    ('undo', 'Undo'),
                ],
                max_length=30,
            ),
        ),
    ]
