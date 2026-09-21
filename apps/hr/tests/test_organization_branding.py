from django.test import TestCase



from apps.hr.models import OfferLetterSettings

from apps.hr.organization_branding import (

    BRANDING_TEMPLATE_KEYS,

    append_branded_signature,

    build_branding_context,

    build_email_branding_context,

    get_payslip_branding,

    render_email_footer_plain,

    resolve_hospital_id,

)

from apps.shared.models import Hospital





class OrganizationBrandingTests(TestCase):

    def setUp(self):

        self.hospital_a = Hospital.objects.create(name='Hospital A', slug='hospital-a')

        self.hospital_b = Hospital.objects.create(name='Email Test', slug='email-test')

        OfferLetterSettings.objects.create(

            hospital=self.hospital_a,

            organization_name='Acme Health',

            hr_name='Jane HR',

            hr_email='hr@acme.test',

        )

        OfferLetterSettings.objects.update_or_create(

            hospital_id=None,

            defaults={

                'organization_name': 'INTVICE TECHNOLOGIES',

                'organization_address': 'BIWANI BYPASS, JIND',

                'organization_location': 'JIND, 126112',

                'hr_name': 'NAVEEN KUMAR',

                'hr_designation': 'HR MANAGER',

            },

        )



    def test_build_branding_context_keys(self):

        ctx = build_branding_context(hospital_id=self.hospital_a.id)

        for key in BRANDING_TEMPLATE_KEYS:

            self.assertIn(key, ctx)

        self.assertEqual(ctx['company_name'], 'Acme Health')

        self.assertEqual(ctx['hr_name'], 'Jane HR')



    def test_hospital_scoping_for_offers(self):

        OfferLetterSettings.objects.create(

            hospital=self.hospital_b,

            organization_name='Other Org',

        )

        ctx_a = build_branding_context(hospital_id=self.hospital_a.id)

        ctx_b = build_branding_context(hospital_id=self.hospital_b.id)

        self.assertEqual(ctx_a['company_name'], 'Acme Health')

        self.assertEqual(ctx_b['company_name'], 'Other Org')



    def test_email_branding_uses_global_org_settings_only(self):

        ctx = build_email_branding_context()

        self.assertEqual(ctx['hr_name'], 'NAVEEN KUMAR')

        self.assertEqual(ctx['hr_designation'], 'HR MANAGER')

        self.assertEqual(ctx['company_name'], 'INTVICE TECHNOLOGIES')

        self.assertNotIn('Email Test', ctx['company_name'])



    def test_email_footer_format(self):

        ctx = build_email_branding_context()

        plain = render_email_footer_plain(ctx)

        self.assertIn('NAVEEN KUMAR', plain)

        self.assertIn('HR MANAGER', plain)

        self.assertIn('INTVICE TECHNOLOGIES', plain)

        self.assertIn('BIWANI BYPASS, JIND', plain)

        self.assertIn('JIND, 126112', plain)

        self.assertNotIn('Email Test', plain)



    def test_append_branded_signature_ignores_job_hospital(self):

        from apps.hr.models import Department, JobOpening



        OfferLetterSettings.objects.create(hospital=self.hospital_b)

        dept = Department.objects.create(name='Eng', hospital=self.hospital_b)

        job = JobOpening.objects.create(

            title='Dev',

            department=dept,

            hospital=self.hospital_b,

            status='open',

        )

        plain, html = append_branded_signature(

            'Hello candidate.',

            '<p>Hello candidate.</p>',

            job=job,

            hospital_id=self.hospital_b.id,

        )

        self.assertIn('NAVEEN KUMAR', plain)

        self.assertIn('INTVICE TECHNOLOGIES', plain)

        self.assertNotIn('Email Test', plain)

        self.assertNotIn('Jane HR', plain)



    def test_payslip_branding_uses_global_when_hospital_shell_empty(self):
        from apps.hr.models import Employee

        employee = Employee.objects.create(
            name='Payroll Staff',
            employee_id='EMP-PAY-1',
            hospital=self.hospital_b,
        )
        OfferLetterSettings.objects.get_or_create(hospital=self.hospital_b)

        ctx = get_payslip_branding(employee=employee)
        self.assertEqual(ctx['company_name'], 'INTVICE TECHNOLOGIES')
        self.assertNotEqual(ctx['company_name'], 'Email Test')

    def test_resolve_hospital_from_job(self):

        from apps.hr.models import Department, JobOpening



        dept = Department.objects.create(name='Eng', hospital=self.hospital_a)

        job = JobOpening.objects.create(

            title='Dev',

            department=dept,

            hospital=self.hospital_a,

            status='open',

        )

        self.assertEqual(resolve_hospital_id(job=job), self.hospital_a.id)


