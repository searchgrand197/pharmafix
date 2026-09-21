from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.hr.models import Employee
from apps.shared.models import Hospital

User = get_user_model()


class HRApiSecurityTests(TestCase):
    def setUp(self):
        self.hospital_a = Hospital.objects.create(name='Hospital A', slug='hospital-a')
        self.hospital_b = Hospital.objects.create(name='Hospital B', slug='hospital-b')
        self.employee_user = User.objects.create_user(
            email='emp.security@test.local',
            password='test-pass-123',
            hospital=self.hospital_a,
        )
        self.hr_user = User.objects.create_user(
            email='hr.security@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital_a,
        )
        self.other_hr = User.objects.create_user(
            email='hr.other@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital_b,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital_a,
            name='Security Employee',
            email='emp.security@test.local',
            status='active',
            department='Ops',
            job_title='Associate',
        )
        self.other_employee = Employee.objects.create(
            hospital=self.hospital_b,
            name='Other Hospital Employee',
            email='other.emp@test.local',
            status='active',
            department='Ops',
            job_title='Associate',
        )
        self.client = APIClient()

    def test_employee_blocked_from_hr_employees_list(self):
        self.client.force_authenticate(user=self.employee_user)
        res = self.client.get('/api/v1/hr/employees/')
        self.assertEqual(res.status_code, 403)

    def test_employee_blocked_from_hr_leave_requests(self):
        self.client.force_authenticate(user=self.employee_user)
        res = self.client.get('/api/v1/hr/leave-requests/')
        self.assertEqual(res.status_code, 403)

    def test_employee_blocked_from_hr_daily_attendance(self):
        self.client.force_authenticate(user=self.employee_user)
        res = self.client.get('/api/v1/hr/daily-attendance/')
        self.assertEqual(res.status_code, 403)

    def test_hr_can_access_employee_directory(self):
        self.client.force_authenticate(user=self.hr_user)
        res = self.client.get('/api/v1/hr/employees/')
        self.assertEqual(res.status_code, 200)

    def test_unauthenticated_hr_api_blocked(self):
        res = self.client.get('/api/v1/hr/employees/')
        self.assertIn(res.status_code, {401, 403})

    def test_hr_blocked_from_employee_portal(self):
        self.client.force_authenticate(user=self.hr_user)
        res = self.client.get('/api/v1/employee-portal/dashboard/')
        self.assertEqual(res.status_code, 403)

    def test_employee_portal_scoped_to_own_profile(self):
        self.client.force_authenticate(user=self.employee_user)
        res = self.client.get('/api/v1/employee-portal/profile/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['id'], str(self.employee.id))

    def test_cross_hospital_hr_cannot_retrieve_foreign_employee(self):
        self.client.force_authenticate(user=self.other_hr)
        res = self.client.get(f'/api/v1/hr/employees/{self.employee.id}/')
        self.assertEqual(res.status_code, 404)

    def test_offer_builder_requires_hr_auth(self):
        res = self.client.get('/api/v1/hr/offer-builder-v2/')
        self.assertIn(res.status_code, {401, 403})
        self.client.force_authenticate(user=self.employee_user)
        res = self.client.get('/api/v1/hr/offer-builder-v2/')
        self.assertEqual(res.status_code, 403)
