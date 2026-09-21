import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('hr', '0065_leaverequest_attachment'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='activated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='employee',
            name='portal_account_created_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='employee',
            name='portal_welcome_email_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='employee',
            name='user',
            field=models.OneToOneField(
                blank=True,
                help_text='Linked portal login account (provisioned on HR activation).',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='hr_employee_profile',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
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
                    ('employee_activated', 'Employee Activated'),
                    ('portal_account_created', 'Portal Account Created'),
                    ('welcome_email_sent', 'Welcome Email Sent'),
                    ('password_changed', 'Password Changed'),
                    ('final_reject', 'Final Reject'),
                    ('undo', 'Undo'),
                ],
                max_length=30,
            ),
        ),
    ]
