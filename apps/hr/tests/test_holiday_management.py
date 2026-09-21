from unittest.mock import patch
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hr.attendance_engine import recalculate_daily_attendance
from apps.hr.holiday_suggestions import resolve_india_fy
from apps.hr.models import (
    DailyAttendance,
    Employee,
    LeaveBalance,
    LeaveType,
    OrganizationHoliday,
)
from apps.shared.models import Hospital

User = get_user_model()


def _nager_rows_for_years(years):
    """Minimal Nager-shaped rows spanning FY boundaries."""
    rows = {
        2026: [
            {
                'date': '2026-01-26',
                'name': 'Republic Day',
                'local_name': 'Republic Day',
                'types': ['Public'],
                'source': 'nager',
            },
            {
                'date': '2026-08-15',
                'name': 'Independence Day',
                'local_name': 'Independence Day',
                'types': ['Public'],
                'source': 'nager',
            },
            {
                'date': '2026-10-02',
                'name': 'Mahatma Gandhi Jayanti',
                'local_name': 'Mahatma Gandhi Jayanti',
                'types': ['Public'],
                'source': 'nager',
            },
        ],
        2027: [
            {
                'date': '2027-01-26',
                'name': 'Republic Day',
                'local_name': 'Republic Day',
                'types': ['Public'],
                'source': 'nager',
            },
            {
                'date': '2027-08-15',
                'name': 'Independence Day',
                'local_name': 'Independence Day',
                'types': ['Public'],
                'source': 'nager',
            },
        ],
    }
    result = []
    for year in years:
        result.extend(rows.get(year, []))
    return result


def _fake_fetch_nager(year):
    return _nager_rows_for_years([year])


class HolidayManagementTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Holiday Hospital', slug='holiday-hospital')
        self.other_hospital = Hospital.objects.create(name='Other Hospital', slug='other-holiday-hosp')
        self.hr_user = User.objects.create_user(
            email='hr.holiday@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.hr_user_without_hospital = User.objects.create_user(
            email='hr.nohospital@test.local',
            password='test-pass-123',
            is_staff=True,
        )
        self.employee_user = User.objects.create_user(
            email='emp.holiday@test.local',
            password='test-pass-123',
            hospital=self.hospital,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Holiday Employee',
            email='emp.holiday@test.local',
            status='active',
            department='Admin',
            job_title='Clerk',
        )
        self.leave_type = LeaveType.objects.create(hospital=self.hospital, name='Casual Leave')
        LeaveBalance.objects.create(
            employee=self.employee,
            leave_type=self.leave_type,
            total_days=Decimal('10.00'),
            used_days=Decimal('0.00'),
            remaining_days=Decimal('10.00'),
        )
        self.client = APIClient()
        self.future = timezone.localdate() + timedelta(days=14)

    def _auth_hr(self):
        self.client.force_authenticate(user=self.hr_user)

    def _auth_hr_without_hospital(self):
        self.client.force_authenticate(user=self.hr_user_without_hospital)

    def _auth_employee(self):
        self.client.force_authenticate(user=self.employee_user)

    def test_hr_create_and_list_holiday(self):
        self._auth_hr()
        res = self.client.post('/api/v1/hr/organization-holidays/', {
            'scope': 'organization',
            'name': 'Foundation Day',
            'date': self.future.isoformat(),
            'description': 'Org holiday',
            'active': True,
            'is_paid_day': True,
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['scope'], 'organization')
        list_res = self.client.get('/api/v1/hr/organization-holidays/', {'month': self.future.strftime('%Y-%m')})
        self.assertEqual(list_res.status_code, 200)
        names = {row['name'] for row in list_res.data.get('results', list_res.data)}
        self.assertIn('Foundation Day', names)

    def test_hr_without_bound_hospital_can_create_organization_holiday_when_hospital_selected(self):
        self._auth_hr_without_hospital()
        res = self.client.post('/api/v1/hr/organization-holidays/', {
            'scope': 'organization',
            'hospital': str(self.hospital.id),
            'name': 'Selected Hospital Day',
            'date': self.future.isoformat(),
            'description': 'Org holiday with explicit hospital',
            'active': True,
            'is_paid_day': True,
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(str(res.data['hospital']), str(self.hospital.id))

    def test_hr_create_organization_holiday_returns_clear_error_when_hospital_context_missing(self):
        self._auth_hr_without_hospital()
        with patch('apps.hr.hospital_context.resolve_hr_hospital_id', return_value=None):
            res = self.client.post('/api/v1/hr/organization-holidays/', {
                'scope': 'organization',
                'name': 'Needs Hospital',
                'date': self.future.isoformat(),
                'description': 'Org holiday without hospital context',
                'active': True,
                'is_paid_day': True,
            }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(
            res.data['errors']['hospital'][0],
            'Hospital context is required for organization holidays. Link your account to a hospital or choose one before saving.',
        )

    def test_employee_cannot_mutate_hr_holidays(self):
        self._auth_employee()
        res = self.client.post('/api/v1/hr/organization-holidays/', {
            'scope': 'national',
            'name': 'Blocked',
            'date': self.future.isoformat(),
        }, format='json')
        self.assertIn(res.status_code, {403, 401})

    def test_delete_only_future_holidays(self):
        past = timezone.localdate() - timedelta(days=3)
        holiday = OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_ORGANIZATION,
            hospital=self.hospital,
            name='Past Holiday',
            date=past,
        )
        self._auth_hr()
        res = self.client.delete(f'/api/v1/hr/organization-holidays/{holiday.id}/')
        self.assertEqual(res.status_code, 400)
        self.assertTrue(OrganizationHoliday.objects.filter(pk=holiday.id).exists())

    def test_toggle_active_endpoint(self):
        holiday = OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_NATIONAL,
            name='Republic Day',
            date=self.future,
            active=True,
        )
        self._auth_hr()
        res = self.client.post(f'/api/v1/hr/organization-holidays/{holiday.id}/toggle-active/')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['active'])

    def test_attendance_marked_holiday_on_active_holiday(self):
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_ORGANIZATION,
            hospital=self.hospital,
            name='Org Off',
            date=self.future,
            active=True,
        )
        recalculate_daily_attendance(self.employee, self.future)
        row = DailyAttendance.objects.get(employee=self.employee, date=self.future)
        self.assertEqual(row.attendance_status, 'holiday')

    def test_leave_blocked_on_holiday_date(self):
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_NATIONAL,
            name='National Off',
            date=self.future,
            active=True,
        )
        self._auth_employee()
        res = self.client.post('/api/v1/employee-portal/leaves/', {
            'leave_type': str(self.leave_type.id),
            'start_date': self.future.isoformat(),
            'end_date': self.future.isoformat(),
            'reason': 'Need break',
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('holiday', str(res.data).lower())

    def test_employee_holidays_include_festival_and_organization(self):
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_FESTIVAL,
            name='Diwali',
            date=self.future,
            active=True,
        )
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_ORGANIZATION,
            hospital=self.hospital,
            name='Hospital Day',
            date=self.future + timedelta(days=2),
            active=True,
        )
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_ORGANIZATION,
            hospital=self.other_hospital,
            name='Other Org Day',
            date=self.future + timedelta(days=4),
            active=True,
        )
        self._auth_employee()
        res = self.client.get('/api/v1/employee-portal/holidays/', {'upcoming': 'true'})
        self.assertEqual(res.status_code, 200)
        names = {row['name'] for row in res.data['results']}
        self.assertIn('Diwali', names)
        self.assertIn('Hospital Day', names)
        self.assertNotIn('Other Org Day', names)

    def test_resolve_india_fy_april_to_march(self):
        label, start, end, years = resolve_india_fy(today=date(2026, 7, 14))
        self.assertEqual(label, '2026-27')
        self.assertEqual(start, date(2026, 4, 1))
        self.assertEqual(end, date(2027, 3, 31))
        self.assertEqual(years, [2026, 2027])

        label_early, start_early, end_early, years_early = resolve_india_fy(today=date(2026, 2, 1))
        self.assertEqual(label_early, '2025-26')
        self.assertEqual(start_early, date(2025, 4, 1))
        self.assertEqual(end_early, date(2026, 3, 31))
        self.assertEqual(years_early, [2025, 2026])

    @patch('apps.hr.holiday_suggestions.fetch_nager_public_holidays', side_effect=_fake_fetch_nager)
    def test_suggestions_filters_to_fy_and_marks_already_created(self, _mock_fetch):
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_ORGANIZATION,
            hospital=self.hospital,
            name='Independence Day',
            date=date(2026, 8, 15),
            active=True,
            is_paid_day=True,
        )
        self._auth_hr()
        res = self.client.get('/api/v1/hr/organization-holidays/suggestions/', {'fy': '2026-27'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['fy'], '2026-27')
        self.assertEqual(res.data['start'], '2026-04-01')
        self.assertEqual(res.data['end'], '2027-03-31')
        self.assertIsNone(res.data['source_error'])

        by_date = {row['date']: row for row in res.data['days']}
        # Jan 26 2026 is before FY start — excluded
        self.assertNotIn('2026-01-26', by_date)
        # Aug 15 2026 and Jan 26 2027 are inside FY
        self.assertIn('2026-08-15', by_date)
        self.assertIn('2027-01-26', by_date)
        # Aug 15 2027 is after FY end — excluded
        self.assertNotIn('2027-08-15', by_date)

        independence = by_date['2026-08-15']
        self.assertTrue(independence['already_created'])
        self.assertEqual(len(independence['existing']), 1)
        self.assertTrue(any(s['name'] == 'Independence Day' for s in independence['suggestions']))

        republic_2027 = by_date['2027-01-26']
        self.assertFalse(republic_2027['already_created'])
        self.assertEqual(republic_2027['existing'], [])

    @patch('apps.hr.holiday_suggestions.fetch_nager_public_holidays', side_effect=_fake_fetch_nager)
    def test_suggestions_default_fy_from_today(self, _mock_fetch):
        self._auth_hr()
        with patch('apps.hr.holiday_suggestions.timezone.localdate', return_value=date(2026, 7, 14)):
            res = self.client.get('/api/v1/hr/organization-holidays/suggestions/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['fy'], '2026-27')

    def test_suggestions_invalid_fy(self):
        self._auth_hr()
        res = self.client.get('/api/v1/hr/organization-holidays/suggestions/', {'fy': '2026-28'})
        self.assertEqual(res.status_code, 400)

    def test_employee_cannot_access_suggestions(self):
        self._auth_employee()
        res = self.client.get('/api/v1/hr/organization-holidays/suggestions/', {'fy': '2026-27'})
        self.assertIn(res.status_code, {403, 401})

    @patch(
        'apps.hr.holiday_suggestions.fetch_nager_public_holidays',
        side_effect=RuntimeError('nager down'),
    )
    def test_suggestions_falls_back_to_india_catalog_when_nager_fails(self, _mock_fetch):
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_NATIONAL,
            name='Custom Saved',
            date=date(2026, 9, 1),
            active=True,
        )
        self._auth_hr()
        res = self.client.get('/api/v1/hr/organization-holidays/suggestions/', {'fy': '2026-27'})
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data['source_error'])
        self.assertEqual(res.data['source'], 'india_catalog')
        by_date = {row['date']: row for row in res.data['days']}
        self.assertIn('2026-09-01', by_date)
        self.assertTrue(by_date['2026-09-01']['already_created'])
        # Catalog still provides Independence Day suggestion
        self.assertIn('2026-08-15', by_date)
        names = {s['name'] for s in by_date['2026-08-15']['suggestions']}
        self.assertIn('Independence Day', names)

    @patch('apps.hr.holiday_suggestions.fetch_nager_public_holidays', return_value=[])
    def test_suggestions_use_catalog_when_nager_returns_empty(self, _mock_fetch):
        self._auth_hr()
        res = self.client.get('/api/v1/hr/organization-holidays/suggestions/', {'fy': '2026-27'})
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data['source_error'])
        self.assertEqual(res.data['source'], 'india_catalog')
        by_date = {row['date']: row for row in res.data['days']}
        self.assertIn('2026-08-15', by_date)
        self.assertTrue(by_date['2026-08-15']['suggestions'])
