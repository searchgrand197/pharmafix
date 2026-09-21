# Payslip generation output fields

from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0068_payroll_foundation'),
    ]

    operations = [
        migrations.RenameField(
            model_name='payslip',
            old_name='generated_pdf',
            new_name='pdf_file',
        ),
        migrations.AddField(
            model_name='payslip',
            name='gross_salary',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Total earnings before deductions (includes overtime).',
                max_digits=12,
            ),
        ),
        migrations.AddField(
            model_name='payslip',
            name='net_salary',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                help_text='Net payable salary after all deductions.',
                max_digits=12,
            ),
        ),
        migrations.AddField(
            model_name='payslip',
            name='generated_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
    ]
