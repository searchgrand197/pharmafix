from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.hr.models import Employee, EmployeeStatusHistory
from apps.shared.models import Hospital

User = get_user_model()


class EmployeeArchiveApiTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Archive Hospital', slug='archive-hospital')
        self.hr_user = User.objects.create_user(
            email='hr.archive@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.hr_user)
        self.active_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Active Employee',
            email='active.archive@test.local',
            status='active',
            joining_date=date(2025, 1, 1),
        )
        self.inactive_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Inactive Employee',
            email='inactive.archive@test.local',
            status='inactive',
            joining_date=date(2024, 1, 1),
            relieving_date=date(2026, 3, 15),
            exit_reason='resignation',
            exit_notes='Left for higher studies.',
            conduct_remarks='good standing',
            eligible_for_rehire=True,
        )
        self.terminated_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Terminated Employee',
            email='terminated.archive@test.local',
            status='terminated',
            joining_date=date(2023, 6, 1),
            relieving_date=date(2026, 2, 10),
            exit_reason='termination',
            exit_notes='Policy violation.',
            conduct_remarks='unsatisfactory',
            eligible_for_rehire=False,
        )

    def _rows(self, response):
        data = response.data
        if isinstance(data, dict) and 'results' in data:
            return data['results']
        return data

    def test_archive_list_returns_only_exited_employees(self):
        response = self.client.get('/api/v1/hr/employees/', {'statuses': 'inactive,terminated'})

        self.assertEqual(response.status_code, 200)
        returned_ids = {row['id'] for row in self._rows(response)}
        self.assertEqual(returned_ids, {str(self.inactive_employee.id), str(self.terminated_employee.id)})

    def test_mark_exited_records_structured_exit_details_and_history(self):
        response = self.client.post(
            f'/api/v1/hr/employees/{self.active_employee.id}/mark-exited/',
            {
                'status': 'terminated',
                'relieving_date': '2026-08-15',
                'exit_reason': 'retirement',
                'exit_notes': 'Retired after long service.',
                'conduct_remarks': 'excellent',
                'eligible_for_rehire': False,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.active_employee.refresh_from_db()
        self.assertEqual(self.active_employee.status, 'terminated')
        self.assertEqual(self.active_employee.exit_reason, 'retirement')
        self.assertEqual(self.active_employee.exit_notes, 'Retired after long service.')
        self.assertEqual(self.active_employee.conduct_remarks, 'excellent')
        self.assertFalse(self.active_employee.eligible_for_rehire)
        self.assertEqual(self.active_employee.last_working_day_confirmed_by, self.hr_user)

        history = EmployeeStatusHistory.objects.get(employee=self.active_employee)
        self.assertEqual(history.event_type, EmployeeStatusHistory.EVENT_EXIT)
        self.assertEqual(history.previous_status, 'active')
        self.assertEqual(history.new_status, 'terminated')
        self.assertEqual(history.exit_reason, 'retirement')
        self.assertEqual(history.notes, 'Retired after long service.')

    def test_restore_active_clears_exit_snapshot_and_records_history(self):
        response = self.client.post(
            f'/api/v1/hr/employees/{self.terminated_employee.id}/restore-active/',
            {'reason': 'Termination was added in error.'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.terminated_employee.refresh_from_db()
        self.assertEqual(self.terminated_employee.status, 'active')
        self.assertEqual(self.terminated_employee.exit_reason, '')
        self.assertEqual(self.terminated_employee.exit_notes, '')
        self.assertIsNone(self.terminated_employee.relieving_date)
        self.assertIsNone(self.terminated_employee.last_working_day_confirmed_by)
        self.assertIsNone(self.terminated_employee.exited_at)

        history = EmployeeStatusHistory.objects.get(employee=self.terminated_employee)
        self.assertEqual(history.event_type, EmployeeStatusHistory.EVENT_RESTORE)
        self.assertEqual(history.previous_status, 'terminated')
        self.assertEqual(history.new_status, 'active')
        self.assertEqual(history.notes, 'Termination was added in error.')
        self.assertEqual(history.exit_reason, 'termination')

    def test_status_history_endpoint_returns_entries_including_restore(self):
        EmployeeStatusHistory.objects.create(
            employee=self.inactive_employee,
            event_type=EmployeeStatusHistory.EVENT_EXIT,
            previous_status='active',
            new_status='inactive',
            exit_reason='resignation',
            notes='Left for higher studies.',
            conduct_remarks='good standing',
            relieving_date=self.inactive_employee.relieving_date,
            eligible_for_rehire=True,
            changed_by=self.hr_user,
        )

        response = self.client.get(
            f'/api/v1/hr/employees/{self.inactive_employee.id}/status-history/',
        )

        self.assertEqual(response.status_code, 200)
        rows = self._rows(response)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['event_type'], 'exit')
        self.assertEqual(rows[0]['previous_status'], 'active')
        self.assertEqual(rows[0]['new_status'], 'inactive')
