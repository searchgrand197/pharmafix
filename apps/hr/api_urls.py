from django.urls import path
from rest_framework.routers import DefaultRouter
from apps.hr.attendance_finalization_views import (
    AttendanceFinalizeMonthStatusView,
    AttendanceFinalizeMonthView,
    AttendanceUnfinalizeMonthView,
)
from apps.hr.biometric.views_api import (
    BiometricDeviceViewSet,
    BiometricRejectedPunchViewSet,
    BiometricSyncLogViewSet,
    BiometricUnlinkedUserViewSet,
)
from apps.hr.journey_center_views import JourneyCenterCountsView
from apps.hr.payroll_month_readiness_views import PayrollMonthReadinessView
from apps.hr.views import (
    EmployeeViewSet, DepartmentViewSet, DesignationViewSet, RoleViewSet, AttendanceViewSet,
    LeaveTypeViewSet, LeavePolicyViewSet, LeaveBalanceViewSet, LeaveRequestViewSet, LeaveViewSet, SalaryViewSet, JobOpeningViewSet,
    CandidateViewSet, InterviewViewSet, PerformanceReviewViewSet,
    OfferViewSet, ComponentOfferTemplateViewSet, OfferBuilderV2ViewSet, OfferLetterSettingsViewSet,
    EmployeeDocumentViewSet, OnboardingDashboardViewSet, EmployeeJoiningViewSet,
    HRDashboardViewSet, DocumentTypeViewSet,
    ShiftViewSet, EmployeeShiftViewSet, AttendancePunchViewSet, AttendanceControlViewSet,
    AttendanceTestSeederViewSet,
    EmployeePortalViewSet,
    PayrollRunViewSet,
    DailyAttendanceViewSet, AttendanceRegularizationViewSet, HospitalContextViewSet,
    OrganizationHolidayViewSet,
)

router = DefaultRouter()
router.register(r'hr/employees', EmployeeViewSet, basename='hr-employee')
router.register(r'hr/departments', DepartmentViewSet, basename='hr-department')
router.register(r'hr/designations', DesignationViewSet, basename='hr-designation')
router.register(r'hr/roles', RoleViewSet, basename='hr-role')
router.register(r'hr/hospitals', HospitalContextViewSet, basename='hr-hospital')
router.register(r'hr/attendance', AttendanceViewSet, basename='hr-attendance')
router.register(r'hr/attendance-punches', AttendancePunchViewSet, basename='hr-attendance-punch')
router.register(r'hr/attendance-control', AttendanceControlViewSet, basename='hr-attendance-control')
router.register(r'hr/attendance-test-seeder', AttendanceTestSeederViewSet, basename='hr-attendance-test-seeder')
router.register(r'hr/biometric-devices', BiometricDeviceViewSet, basename='hr-biometric-device')
router.register(r'hr/biometric-unlinked-users', BiometricUnlinkedUserViewSet, basename='hr-biometric-unlinked-user')
router.register(r'hr/biometric-rejected-punches', BiometricRejectedPunchViewSet, basename='hr-biometric-rejected-punch')
router.register(r'hr/biometric-sync-logs', BiometricSyncLogViewSet, basename='hr-biometric-sync-log')
router.register(r'hr/daily-attendance', DailyAttendanceViewSet, basename='hr-daily-attendance')
router.register(r'hr/attendance-regularizations', AttendanceRegularizationViewSet, basename='hr-attendance-regularization')
router.register(r'hr/shifts', ShiftViewSet, basename='hr-shift')
router.register(r'hr/employee-shifts', EmployeeShiftViewSet, basename='hr-employee-shift')
router.register(r'hr/leave-types', LeaveTypeViewSet, basename='hr-leave-type')
router.register(r'hr/leave-policies', LeavePolicyViewSet, basename='hr-leave-policy')
router.register(r'hr/leave-balances', LeaveBalanceViewSet, basename='hr-leave-balance')
router.register(r'hr/leave-requests', LeaveRequestViewSet, basename='hr-leave-request')
router.register(r'hr/leaves', LeaveViewSet, basename='hr-leave')
router.register(r'hr/salary', SalaryViewSet, basename='hr-salary')
router.register(r'hr/job-openings', JobOpeningViewSet, basename='hr-job-opening')
router.register(r'hr/candidates', CandidateViewSet, basename='hr-candidate')
router.register(r'hr/interviews', InterviewViewSet, basename='hr-interview')
router.register(r'hr/performance', PerformanceReviewViewSet, basename='hr-performance')
router.register(r'hr/component-templates', ComponentOfferTemplateViewSet, basename='hr-component-template')
router.register(r'hr/offers', OfferViewSet, basename='hr-offer')
router.register(r'hr/offer-builder-v2', OfferBuilderV2ViewSet, basename='hr-offer-builder-v2')
router.register(r'hr/offer-letter-settings', OfferLetterSettingsViewSet, basename='hr-offer-letter-settings')
router.register(r'hr/organization-settings', OfferLetterSettingsViewSet, basename='hr-organization-settings')
router.register(r'hr/documents', EmployeeDocumentViewSet, basename='hr-document')
router.register(r'hr/document-types', DocumentTypeViewSet, basename='hr-document-type')
router.register(r'hr/onboarding-dashboard', OnboardingDashboardViewSet, basename='hr-onboarding-dashboard')
router.register(r'hr/joining', EmployeeJoiningViewSet, basename='hr-joining')
router.register(r'hr/dashboard', HRDashboardViewSet, basename='hr-dashboard')
router.register(r'employee-portal', EmployeePortalViewSet, basename='employee-portal')
router.register(r'hr/payroll-runs', PayrollRunViewSet, basename='hr-payroll-run')
router.register(r'hr/organization-holidays', OrganizationHolidayViewSet, basename='hr-organization-holiday')

urlpatterns = [
    path('hr/attendance/finalize-month/', AttendanceFinalizeMonthView.as_view(), name='hr-attendance-finalize-month'),
    path('hr/attendance/unfinalize-month/', AttendanceUnfinalizeMonthView.as_view(), name='hr-attendance-unfinalize-month'),
    path(
        'hr/attendance/finalize-month/status/',
        AttendanceFinalizeMonthStatusView.as_view(),
        name='hr-attendance-finalize-month-status',
    ),
    path(
        'hr/journey-center/counts/',
        JourneyCenterCountsView.as_view(),
        name='hr-journey-center-counts',
    ),
    path(
        'hr/payroll-month-readiness/',
        PayrollMonthReadinessView.as_view(),
        name='hr-payroll-month-readiness',
    ),
    *router.urls,
]
