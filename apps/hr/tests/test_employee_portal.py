from datetime import datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from django.core.files.uploadedfile import SimpleUploadedFile

from apps.hr.leave_services import UNLIMITED_DAYS
from apps.hr.models import (
    AttendanceRegularization,
    DailyAttendance,
    Department,
    DocumentType,
    Employee,
    EmployeeDocumentRequirement,
    EmployeePortalNotification,
    LeaveBalance,
    LeavePolicy,
    LeavePolicyLine,
    LeaveRequest,
    LeaveType,
    OrganizationHoliday,
)
from apps.shared.models import Hospital

User = get_user_model()


class EmployeePortalTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Portal Hospital', slug='portal-hospital')
        self.employee_user = User.objects.create_user(
            email='employee.portal@test.local',
            password='test-pass-123',
            hospital=self.hospital,
        )
        self.other_user = User.objects.create_user(
            email='other.portal@test.local',
            password='test-pass-123',
            hospital=self.hospital,
        )
        self.hr_user = User.objects.create_user(
            email='hr.portal@test.local',
            password='test-pass-123',
            is_staff=True,
            hospital=self.hospital,
        )
        self.employee = Employee.objects.create(
            hospital=self.hospital,
            name='Portal Employee',
            email='employee.portal@test.local',
            status='active',
            department='Nursing',
            job_title='Staff Nurse',
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

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    def test_dashboard_scoped_to_own_employee(self):
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/employee-portal/dashboard/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['employee']['id'], str(self.employee.id))
        self.assertEqual(res.data['employee']['name'], 'Portal Employee')

    def test_no_profile_returns_404(self):
        self._auth(self.other_user)
        res = self.client.get('/api/v1/employee-portal/dashboard/')
        self.assertEqual(res.status_code, 404)

    def test_apply_leave_creates_pending_request(self):
        self._auth(self.employee_user)
        start = timezone.localdate() + timedelta(days=7)
        end = start + timedelta(days=1)
        res = self.client.post('/api/v1/employee-portal/leaves/', {
            'leave_type': str(self.leave_type.id),
            'start_date': start.isoformat(),
            'end_date': end.isoformat(),
            'reason': 'Family event',
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], LeaveRequest.STATUS_PENDING)
        self.assertTrue(
            LeaveRequest.objects.filter(employee=self.employee, status=LeaveRequest.STATUS_PENDING).exists()
        )

    def test_overlap_pending_leave_rejected(self):
        self._auth(self.employee_user)
        start = timezone.localdate() + timedelta(days=10)
        end = start + timedelta(days=2)
        LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type,
            start_date=start,
            end_date=end,
            number_of_days=Decimal('3.00'),
            status=LeaveRequest.STATUS_PENDING,
        )
        res = self.client.post('/api/v1/employee-portal/leaves/', {
            'leave_type': str(self.leave_type.id),
            'start_date': (start + timedelta(days=1)).isoformat(),
            'end_date': (start + timedelta(days=1)).isoformat(),
            'reason': 'Overlap test',
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_inactive_employee_cannot_apply_leave(self):
        self.employee.status = 'inactive'
        self.employee.save(update_fields=['status'])
        self._auth(self.employee_user)
        start = timezone.localdate() + timedelta(days=14)
        res = self.client.post('/api/v1/employee-portal/leaves/', {
            'leave_type': str(self.leave_type.id),
            'start_date': start.isoformat(),
            'end_date': start.isoformat(),
            'reason': 'Should fail',
        }, format='json')
        self.assertEqual(res.status_code, 403)

    def test_hr_approve_visible_in_employee_portal(self):
        start = timezone.localdate() + timedelta(days=20)
        leave = LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type,
            start_date=start,
            end_date=start,
            number_of_days=Decimal('1.00'),
            status=LeaveRequest.STATUS_PENDING,
            applied_by=self.employee_user,
        )
        self.client.force_authenticate(user=self.hr_user)
        approve = self.client.post(f'/api/v1/hr/leave-requests/{leave.id}/approve/', {'remarks': 'OK'}, format='json')
        self.assertEqual(approve.status_code, 200)

        self.client.force_authenticate(user=self.employee_user)
        res = self.client.get('/api/v1/employee-portal/leaves/')
        self.assertEqual(res.status_code, 200)
        statuses = [row['status'] for row in res.data['results']]
        self.assertIn(LeaveRequest.STATUS_APPROVED, statuses)

    def test_hr_reject_visible_in_employee_portal(self):
        start = timezone.localdate() + timedelta(days=25)
        leave = LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type,
            start_date=start,
            end_date=start,
            number_of_days=Decimal('1.00'),
            status=LeaveRequest.STATUS_PENDING,
            applied_by=self.employee_user,
        )
        self.client.force_authenticate(user=self.hr_user)
        reject = self.client.post(f'/api/v1/hr/leave-requests/{leave.id}/reject/', {'remarks': 'Denied'}, format='json')
        self.assertEqual(reject.status_code, 200)

        self.client.force_authenticate(user=self.employee_user)
        res = self.client.get('/api/v1/employee-portal/leaves/', {'status': LeaveRequest.STATUS_REJECTED})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(any(row['id'] == str(leave.id) for row in res.data['results']))

    def test_employee_cannot_access_hr_employee_directory(self):
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/hr/employees/')
        self.assertIn(res.status_code, {403, 401})

    def test_attendance_endpoint_returns_own_data_only(self):
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/employee-portal/attendance/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['employee']['id'], str(self.employee.id))

    def test_cancel_pending_leave(self):
        start = timezone.localdate() + timedelta(days=30)
        leave = LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type,
            start_date=start,
            end_date=start,
            number_of_days=Decimal('1.00'),
            status=LeaveRequest.STATUS_PENDING,
        )
        self._auth(self.employee_user)
        res = self.client.post(f'/api/v1/employee-portal/leaves/{leave.id}/cancel/', {}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], LeaveRequest.STATUS_CANCELLED)

    def test_leave_types_unlimited_balance_omits_sentinel_totals(self):
        lwp = LeaveType.objects.create(
            hospital=self.hospital,
            name='Leave Without Pay',
            code='LWP',
            is_paid=False,
            is_active=True,
        )
        LeaveBalance.objects.create(
            employee=self.employee,
            leave_type=lwp,
            total_days=UNLIMITED_DAYS,
            used_days=Decimal('2.00'),
            remaining_days=UNLIMITED_DAYS,
            is_unlimited=True,
        )
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/employee-portal/leave-types/')
        self.assertEqual(res.status_code, 200)
        by_id = {row['id']: row for row in res.data['leave_types']}
        paid = by_id[str(self.leave_type.id)]['balance']
        unlimited = by_id[str(lwp.id)]['balance']
        self.assertEqual(paid['total_days'], '10.00')
        self.assertEqual(paid['remaining_days'], '10.00')
        self.assertIsNone(unlimited['total_days'])
        self.assertIsNone(unlimited['remaining_days'])
        self.assertTrue(unlimited['is_unlimited'])
        self.assertEqual(unlimited['used_days'], '2.00')

    def test_hr_approval_updates_employee_leave_balance(self):
        start = timezone.localdate() + timedelta(days=40)
        end = start + timedelta(days=1)
        leave = LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type,
            start_date=start,
            end_date=end,
            number_of_days=Decimal('2.00'),
            status=LeaveRequest.STATUS_PENDING,
            applied_by=self.employee_user,
        )
        self.client.force_authenticate(user=self.hr_user)
        approve = self.client.post(
            f'/api/v1/hr/leave-requests/{leave.id}/approve/',
            {'remarks': 'Approved'},
            format='json',
        )
        self.assertEqual(approve.status_code, 200)

        balance = LeaveBalance.objects.get(employee=self.employee, leave_type=self.leave_type)
        self.assertEqual(balance.used_days, Decimal('2.00'))
        self.assertEqual(balance.remaining_days, Decimal('8.00'))

        self.client.force_authenticate(user=self.employee_user)
        types_res = self.client.get('/api/v1/employee-portal/leave-types/')
        self.assertEqual(types_res.status_code, 200)
        row = next(r for r in types_res.data['leave_types'] if r['id'] == str(self.leave_type.id))
        self.assertEqual(row['balance']['remaining_days'], '8.00')
        self.assertEqual(row['balance']['used_days'], '2.00')

    def test_employee_cannot_cancel_other_employees_leave(self):
        other = Employee.objects.create(
            hospital=self.hospital,
            name='Other Employee',
            email='other.emp@test.local',
            status='active',
        )
        start = timezone.localdate() + timedelta(days=45)
        leave = LeaveRequest.objects.create(
            employee=other,
            leave_type=self.leave_type,
            start_date=start,
            end_date=start,
            number_of_days=Decimal('1.00'),
            status=LeaveRequest.STATUS_PENDING,
        )
        self._auth(self.employee_user)
        res = self.client.post(f'/api/v1/employee-portal/leaves/{leave.id}/cancel/', {}, format='json')
        self.assertEqual(res.status_code, 404)

    def test_employee_leaves_list_scoped_to_self(self):
        other = Employee.objects.create(
            hospital=self.hospital,
            name='Other Employee',
            email='other.emp2@test.local',
            status='active',
        )
        start = timezone.localdate() + timedelta(days=50)
        LeaveRequest.objects.create(
            employee=other,
            leave_type=self.leave_type,
            start_date=start,
            end_date=start,
            number_of_days=Decimal('1.00'),
            status=LeaveRequest.STATUS_APPROVED,
        )
        own = LeaveRequest.objects.create(
            employee=self.employee,
            leave_type=self.leave_type,
            start_date=start + timedelta(days=5),
            end_date=start + timedelta(days=5),
            number_of_days=Decimal('1.00'),
            status=LeaveRequest.STATUS_PENDING,
        )
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/employee-portal/leaves/')
        self.assertEqual(res.status_code, 200)
        ids = {row['id'] for row in res.data['results']}
        self.assertIn(str(own.id), ids)
        self.assertEqual(len(ids), 1)

    def test_employee_cannot_access_hr_leave_requests(self):
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/hr/leave-requests/')
        self.assertIn(res.status_code, {403, 401})

    def test_leave_types_respect_policy_assignment(self):
        restricted = LeaveType.objects.create(
            hospital=self.hospital,
            name='Maternity Leave',
            code='MAT',
            is_active=True,
        )
        department = Department.objects.create(hospital=self.hospital, name='Nursing')
        self.employee.department_ref = department
        self.employee.save(update_fields=['department_ref', 'updated_at'])
        policy = LeavePolicy.objects.create(
            hospital=self.hospital,
            name='Nursing only',
            assignment_type=LeavePolicy.ASSIGNMENT_DEPARTMENT,
            is_active=True,
        )
        policy.departments.set([department])
        LeavePolicyLine.objects.create(
            policy=policy,
            leave_type=self.leave_type,
            allocated_days=Decimal('10.00'),
            is_unlimited=False,
        )
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/employee-portal/leave-types/')
        self.assertEqual(res.status_code, 200)
        type_ids = {row['id'] for row in res.data['leave_types']}
        self.assertIn(str(self.leave_type.id), type_ids)
        self.assertNotIn(str(restricted.id), type_ids)

    def test_employee_documents_list_via_portal(self):
        doc_type = DocumentType.objects.create(
            hospital=self.hospital,
            name='PAN Card',
            verification_mode='upload',
            mandatory=True,
        )
        requirement = EmployeeDocumentRequirement.objects.create(
            employee=self.employee,
            document_type=doc_type,
            mandatory=True,
            status='pending',
        )
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/employee-portal/documents/')
        self.assertEqual(res.status_code, 200)
        doc_ids = {row['id'] for row in res.data['documents']}
        self.assertIn(str(requirement.id), doc_ids)
        self.assertIn('progress', res.data)
        self.assertEqual(res.data['employee']['id'], str(self.employee.id))

    def test_employee_cannot_access_hr_documents_list(self):
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/hr/documents/')
        self.assertIn(res.status_code, {403, 401})

    def test_employee_upload_document_via_portal(self):
        doc_type = DocumentType.objects.create(
            hospital=self.hospital,
            name='Degree Certificate',
            verification_mode='upload',
        )
        requirement = EmployeeDocumentRequirement.objects.create(
            employee=self.employee,
            document_type=doc_type,
            mandatory=True,
            status='pending',
        )
        pdf_bytes = b'%PDF-1.4 minimal test content for upload'
        upload = SimpleUploadedFile('degree.pdf', pdf_bytes, content_type='application/pdf')
        self._auth(self.employee_user)
        res = self.client.post(
            f'/api/v1/employee-portal/documents/{requirement.id}/upload/',
            {'file': upload},
            format='multipart',
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data.get('success'))
        requirement.refresh_from_db()
        self.assertEqual(requirement.status, 'uploaded')
        self.assertTrue(requirement.uploaded_file)

    def test_hr_approve_visible_in_employee_documents_portal(self):
        doc_type = DocumentType.objects.create(
            hospital=self.hospital,
            name='Bank Details',
            verification_mode='upload',
        )
        requirement = EmployeeDocumentRequirement.objects.create(
            employee=self.employee,
            document_type=doc_type,
            mandatory=True,
            status='uploaded',
            uploaded_at=timezone.now(),
        )
        requirement.uploaded_file.save(
            'bank.pdf',
            SimpleUploadedFile('bank.pdf', b'%PDF-1.4 bank', content_type='application/pdf'),
            save=True,
        )
        self.client.force_authenticate(user=self.hr_user)
        approve = self.client.post(f'/api/v1/hr/documents/{requirement.id}/approve/', {}, format='json')
        self.assertEqual(approve.status_code, 200)

        self.client.force_authenticate(user=self.employee_user)
        res = self.client.get('/api/v1/employee-portal/documents/')
        self.assertEqual(res.status_code, 200)
        row = next(r for r in res.data['documents'] if r['id'] == str(requirement.id))
        self.assertEqual(row['workflow_status'], 'VERIFIED')

    def test_employee_cannot_upload_other_employees_document(self):
        other = Employee.objects.create(
            hospital=self.hospital,
            name='Other Employee',
            email='other.doc@test.local',
            status='active',
        )
        doc_type = DocumentType.objects.create(
            hospital=self.hospital,
            name='Passport',
            verification_mode='upload',
        )
        other_req = EmployeeDocumentRequirement.objects.create(
            employee=other,
            document_type=doc_type,
            mandatory=True,
            status='pending',
        )
        upload = SimpleUploadedFile('passport.pdf', b'%PDF-1.4 passport', content_type='application/pdf')
        self._auth(self.employee_user)
        res = self.client.post(
            f'/api/v1/employee-portal/documents/{other_req.id}/upload/',
            {'file': upload},
            format='multipart',
        )
        self.assertEqual(res.status_code, 404)

    def test_employee_document_update_request(self):
        doc_type = DocumentType.objects.create(
            hospital=self.hospital,
            name='Address Proof',
            verification_mode='upload',
        )
        requirement = EmployeeDocumentRequirement.objects.create(
            employee=self.employee,
            document_type=doc_type,
            mandatory=True,
            status='verified',
            verified_at=timezone.now(),
        )
        self._auth(self.employee_user)
        res = self.client.post(
            f'/api/v1/employee-portal/documents/{requirement.id}/request-update/',
            {'reason': 'Address changed'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data.get('success'))

    @patch('apps.hr.regularization_notifications._send')
    def test_employee_submit_regularization_emails_hr(self, mock_send):
        mock_send.return_value = True
        att_date = timezone.localdate() - timedelta(days=1)
        self._auth(self.employee_user)
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post(
                '/api/v1/employee-portal/regularizations/',
                {
                    'date': att_date.isoformat(),
                    'requested_check_in': f'{att_date.isoformat()}T09:30:00',
                    'reason': 'Missed morning punch',
                },
                format='json',
            )
        self.assertEqual(res.status_code, 201)
        self.assertGreaterEqual(mock_send.call_count, 1)
        hr_call = mock_send.call_args_list[0]
        self.assertIn('Attendance correction requested', hr_call.args[0])
        self.assertIn(self.hr_user.email, hr_call.args[2])

    def test_employee_submit_regularization_creates_pending(self):
        att_date = timezone.localdate() - timedelta(days=1)
        self._auth(self.employee_user)
        res = self.client.post(
            '/api/v1/employee-portal/regularizations/',
            {
                'date': att_date.isoformat(),
                'requested_check_in': f'{att_date.isoformat()}T09:30:00',
                'requested_check_out': f'{att_date.isoformat()}T18:00:00',
                'reason': 'Forgot to punch out after shift',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], 'pending')
        row = AttendanceRegularization.objects.get(pk=res.data['id'])
        self.assertEqual(row.employee_id, self.employee.id)
        self.assertEqual(row.reason, 'Forgot to punch out after shift')

    def test_employee_submit_regularization_with_wall_clock_times(self):
        att_date = timezone.localdate() - timedelta(days=1)
        self._auth(self.employee_user)
        res = self.client.post(
            '/api/v1/employee-portal/regularizations/',
            {
                'date': att_date.isoformat(),
                'requested_check_in_time': '08:30',
                'requested_check_out_time': '18:30',
                'reason': 'Wall clock punch correction',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        row = AttendanceRegularization.objects.get(pk=res.data['id'])
        self.assertEqual(timezone.localtime(row.requested_check_in).strftime('%H:%M'), '08:30')
        self.assertEqual(timezone.localtime(row.requested_check_out).strftime('%H:%M'), '18:30')

    def test_employee_list_regularizations_scoped_to_self(self):
        att_date = timezone.localdate() - timedelta(days=2)
        AttendanceRegularization.objects.create(
            employee=self.employee,
            requested_check_in=timezone.make_aware(datetime.combine(att_date, time(9, 0))),
            reason='My missed punch',
            status='pending',
        )
        other_employee = Employee.objects.create(
            hospital=self.hospital,
            name='Other Employee',
            email='other.employee@test.local',
            status='active',
        )
        AttendanceRegularization.objects.create(
            employee=other_employee,
            reason='Not mine',
            status='pending',
        )
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/employee-portal/regularizations/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 1)
        self.assertEqual(res.data['results'][0]['reason'], 'My missed punch')

    def test_employee_cannot_submit_duplicate_pending_for_same_date(self):
        att_date = timezone.localdate() - timedelta(days=3)
        attendance = DailyAttendance.objects.create(
            employee=self.employee,
            date=att_date,
            attendance_status='incomplete',
        )
        AttendanceRegularization.objects.create(
            employee=self.employee,
            attendance=attendance,
            reason='Already pending',
            status='pending',
        )
        self._auth(self.employee_user)
        res = self.client.post(
            '/api/v1/employee-portal/regularizations/',
            {
                'date': att_date.isoformat(),
                'requested_check_in': f'{att_date.isoformat()}T10:00:00',
                'reason': 'Second request',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('date', res.data)

    def test_employee_regularization_requires_check_time(self):
        att_date = timezone.localdate() - timedelta(days=1)
        self._auth(self.employee_user)
        res = self.client.post(
            '/api/v1/employee-portal/regularizations/',
            {
                'date': att_date.isoformat(),
                'reason': 'No times provided',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)

    @patch('apps.hr.regularization_notifications._send')
    def test_hr_approve_regularization_emails_employee(self, mock_send):
        mock_send.return_value = True
        att_date = timezone.localdate() - timedelta(days=1)
        attendance = DailyAttendance.objects.create(
            employee=self.employee,
            date=att_date,
            attendance_status='incomplete',
        )
        regularization = AttendanceRegularization.objects.create(
            employee=self.employee,
            attendance=attendance,
            requested_check_in=timezone.make_aware(datetime.combine(att_date, time(9, 15))),
            requested_check_out=timezone.make_aware(datetime.combine(att_date, time(18, 30))),
            reason='Missed checkout',
            status='pending',
        )
        self._auth(self.hr_user)
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post(
                f'/api/v1/hr/attendance-regularizations/{regularization.id}/approve/',
                {'remarks': 'Approved'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        regularization.refresh_from_db()
        attendance.refresh_from_db()
        self.assertEqual(regularization.status, 'approved')
        self.assertIsNotNone(attendance.first_check_in)
        self.assertIsNotNone(attendance.last_check_out)
        self.assertGreater(float(attendance.total_work_hours or 0), 0)
        self.assertIn(attendance.attendance_status, {'present', 'late', 'half_day'})
        self.assertGreaterEqual(mock_send.call_count, 1)
        emp_call = mock_send.call_args_list[-1]
        self.assertIn('Attendance correction approved', emp_call.args[0])
        self.assertIn(self.employee_user.email, emp_call.args[2])

    @patch('apps.hr.regularization_notifications._send')
    def test_hr_reject_regularization_emails_employee(self, mock_send):
        mock_send.return_value = True
        att_date = timezone.localdate() - timedelta(days=2)
        regularization = AttendanceRegularization.objects.create(
            employee=self.employee,
            requested_check_in=timezone.make_aware(datetime.combine(att_date, time(9, 0))),
            reason='Incorrect request',
            status='pending',
        )
        self._auth(self.hr_user)
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post(
                f'/api/v1/hr/attendance-regularizations/{regularization.id}/reject/',
                {'remarks': 'Times do not match shift records'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        regularization.refresh_from_db()
        self.assertEqual(regularization.status, 'rejected')
        self.assertGreaterEqual(mock_send.call_count, 1)
        emp_call = mock_send.call_args_list[-1]
        self.assertIn('Attendance correction rejected', emp_call.args[0])
        self.assertIn(self.employee_user.email, emp_call.args[2])

    def test_employee_notifications_list_and_mark_read(self):
        EmployeePortalNotification.objects.create(
            employee=self.employee,
            category=EmployeePortalNotification.CATEGORY_LEAVE_APPROVED,
            title='Leave approved',
            message='Test leave approved',
        )
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/employee-portal/notifications/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(res.data['unread_count'], 1)
        notif_id = res.data['results'][0]['id']
        read_res = self.client.post(f'/api/v1/employee-portal/notifications/{notif_id}/read/')
        self.assertEqual(read_res.status_code, 200)
        self.assertIsNotNone(read_res.data['read_at'])

    def test_employee_cannot_read_other_notification(self):
        other = Employee.objects.create(
            hospital=self.hospital,
            name='Other',
            email='other.employee@test.local',
            status='active',
        )
        notif = EmployeePortalNotification.objects.create(
            employee=other,
            category=EmployeePortalNotification.CATEGORY_GENERAL,
            title='Private',
            message='Not yours',
        )
        self._auth(self.employee_user)
        res = self.client.post(f'/api/v1/employee-portal/notifications/{notif.id}/read/')
        self.assertEqual(res.status_code, 404)

    def test_employee_holidays_scoped_to_hospital(self):
        national = OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_NATIONAL,
            name='Republic Day',
            date=timezone.localdate() + timedelta(days=3),
            description='National holiday',
        )
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_ORGANIZATION,
            hospital=self.hospital,
            name='Hospital Foundation Day',
            date=timezone.localdate() + timedelta(days=10),
        )
        other_hospital = Hospital.objects.create(name='Other Hosp', slug='other-hosp')
        OrganizationHoliday.objects.create(
            scope=OrganizationHoliday.SCOPE_ORGANIZATION,
            hospital=other_hospital,
            name='Other hospital only',
            date=timezone.localdate() + timedelta(days=5),
        )
        self._auth(self.employee_user)
        res = self.client.get('/api/v1/employee-portal/holidays/', {'upcoming': 'true'})
        self.assertEqual(res.status_code, 200)
        names = {row['name'] for row in res.data['results']}
        self.assertIn(national.name, names)
        self.assertIn('Hospital Foundation Day', names)
        self.assertNotIn('Other hospital only', names)
