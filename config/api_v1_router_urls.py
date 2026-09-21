"""
Single DRF router for API v1 so ``GET /api/v1/`` lists all resource links.

Per-app ``api_urls.py`` files keep ``urlpatterns = []`` for router-based apps;
add non-ViewSet paths (e.g. extra ``path()``) there if needed, and include that
app in ``config.urls`` as usual.
"""

from django.urls import include, path

from apps.dashboard.views import DoctorFinancialAnalyticsView
from apps.appointments.views import AppointmentViewSet
from apps.attendance.views import (
    AttendanceRegularizationViewSet,
    LeaveApplicationViewSet,
    MonthlyEarnedLeaveAllocationViewSet,
    StaffDailyAttendanceViewSet,
    StaffLeaveBalanceViewSet,
)
from apps.billing.views import BillingInvoiceViewSet
from apps.doctors.views import (
    DoctorDailyAvailabilityViewSet,
    DoctorPortalPreferenceView,
    DoctorProfileViewSet,
    DoctorWeeklyScheduleViewSet,
    HospitalCustomRxSaltListCreateView,
    SpecialtyViewSet,
)
from apps.followups.views import FollowUpViewSet
from apps.inventory.views import (
    MedicineBatchViewSet,
    MedicineCategoryViewSet,
    MedicineViewSet,
    StockLedgerViewSet,
    UnitViewSet,
)
from apps.ipd.scheme_views import SchemeViewSet
from apps.ipd.views import IPDAdmissionViewSet
from apps.opd.views import OPDVisitViewSet, follow_up_alerts
from apps.patients.views import PatientViewSet
from apps.expenses.views import (
    ExpenseTransactionViewSet,
    expense_parties,
    expense_party_detail,
    expense_quick_services,
)
from apps.payments.views import PaymentTransactionViewSet, payment_quick_services
from apps.roles_permissions.designation_permission_views import DesignationPermissionProfileViewSet
from apps.roles_permissions.user_permission_views import UserPermissionProfileViewSet
from apps.shared.routers import PublicApiRootRouter
from apps.staff.views import (
    DepartmentViewSet,
    DesignationViewSet,
    EmergencyContactViewSet,
    ShiftViewSet,
    StaffAvailabilityOverrideViewSet,
    StaffProfileViewSet,
    StaffShiftAssignmentViewSet,
)
from apps.settings_management.views import LeaveApproverViewSet, ReceptionPortalSettingsView
from apps.emergency.views import EmergencyCaseViewSet
from apps.tokens.views import TokenViewSet
from apps.notifications.views import NotificationViewSet
from apps.treatment.views import (
    PatientTimelineViewSet,
    PatientPlanOverviewView,
    TreatmentPlanItemViewSet,
    TreatmentPlanViewSet,
    TreatmentTaskViewSet,
    TreatmentTemplateCatalogView,
)
from apps.beds.views import FloorViewSet, BedRoomViewSet, BedViewSet, BedCleaningTaskViewSet
from apps.lab.views import LabTestCategoryViewSet, LabTestViewSet, LabReportViewSet, LabTestResultViewSet
from apps.pharmacy.views import (
    PharmacyInvoiceViewSet,
    PharmacyInvoiceItemViewSet,
    PharmacyNextInvoiceNumberView,
    PharmacyOutletSettingsView,
    PharmacyPurchaseChallanView,
    PharmacySupplierViewSet,
    PurchaseHistoryDetailView,
    PurchaseHistoryListView,
)
from apps.pharmacy.dashboard import PharmacyDashboardView

router = PublicApiRootRouter()
router.register(r"appointments", AppointmentViewSet, basename="appointments")
router.register(
    r"attendance/daily-records",
    StaffDailyAttendanceViewSet,
    basename="attendance-daily-records",
)
router.register(
    r"attendance/regularizations",
    AttendanceRegularizationViewSet,
    basename="attendance-regularizations",
)
router.register(r"attendance/leaves", LeaveApplicationViewSet, basename="attendance-leaves")
router.register(
    r"attendance/earned-leave-allocations",
    MonthlyEarnedLeaveAllocationViewSet,
    basename="attendance-earned-leave-allocations",
)
router.register(r"attendance/leave-balances", StaffLeaveBalanceViewSet, basename="attendance-leave-balances")
router.register(r"batches", MedicineBatchViewSet, basename="batches")
router.register(r"daily-availability", DoctorDailyAvailabilityViewSet, basename="daily-availability")
router.register(r"departments", DepartmentViewSet, basename="departments")
router.register(r"designations", DesignationViewSet, basename="designations")
router.register(r"doctor-profiles", DoctorProfileViewSet, basename="doctor-profiles")
router.register(r"emergency-contacts", EmergencyContactViewSet, basename="emergency-contacts")
router.register(r"emergency/cases", EmergencyCaseViewSet, basename="emergency-cases")
router.register(r"follow-ups", FollowUpViewSet, basename="follow-ups")
router.register(r"invoices", BillingInvoiceViewSet, basename="invoices")
router.register(r"ipd-admissions", IPDAdmissionViewSet, basename="ipd-admissions")
router.register(r"schemes", SchemeViewSet, basename="schemes")
router.register(r"medicines", MedicineViewSet, basename="medicines")
router.register(r"medicine-categories", MedicineCategoryViewSet, basename="medicine-categories")
router.register(r"opd-visits", OPDVisitViewSet, basename="opd-visits")
router.register(r"patients", PatientViewSet, basename="patients")
router.register(r"payments", PaymentTransactionViewSet, basename="payments")
router.register(r"expenses", ExpenseTransactionViewSet, basename="expenses")
router.register(r"shifts", ShiftViewSet, basename="shifts")
router.register(r"specialties", SpecialtyViewSet, basename="specialties")
router.register(r"staff", StaffProfileViewSet, basename="staff")
router.register(
    r"staff-shift-assignments",
    StaffShiftAssignmentViewSet,
    basename="staff-shift-assignments",
)
router.register(
    r"staff-availability-overrides",
    StaffAvailabilityOverrideViewSet,
    basename="staff-availability-overrides",
)
router.register(r"stock-ledgers", StockLedgerViewSet, basename="stock-ledgers")
router.register(r"tokens", TokenViewSet, basename="tokens")
router.register(r"units", UnitViewSet, basename="units")
router.register(
    r"designation-permission-profiles",
    DesignationPermissionProfileViewSet,
    basename="designation-permission-profiles",
)
router.register(
    r"user-permission-profiles",
    UserPermissionProfileViewSet,
    basename="user-permission-profiles",
)
router.register(r"weekly-schedules", DoctorWeeklyScheduleViewSet, basename="weekly-schedules")
router.register(r"treatment-plans", TreatmentPlanViewSet, basename="treatment-plans")
router.register(r"treatment-plan-items", TreatmentPlanItemViewSet, basename="treatment-plan-items")
router.register(r"treatment-tasks", TreatmentTaskViewSet, basename="treatment-tasks")
router.register(r"patient-timeline", PatientTimelineViewSet, basename="patient-timeline")
router.register(r"notifications", NotificationViewSet, basename="notifications")
router.register(r"settings/leave-approvers", LeaveApproverViewSet, basename="settings-leave-approvers")
router.register(r"beds/floors", FloorViewSet, basename="beds-floors")
router.register(r"beds/rooms", BedRoomViewSet, basename="beds-rooms")
router.register(r"beds/beds", BedViewSet, basename="beds-beds")
router.register(r"beds/cleaning-tasks", BedCleaningTaskViewSet, basename="beds-cleaning-tasks")
router.register(r"lab/categories", LabTestCategoryViewSet, basename="lab-categories")
router.register(r"lab/tests", LabTestViewSet, basename="lab-tests")
router.register(r"lab/reports", LabReportViewSet, basename="lab-reports")
router.register(r"lab/results", LabTestResultViewSet, basename="lab-results")
router.register(r"lab/test-results", LabTestResultViewSet, basename="lab-test-results")
router.register(r"pharmacy/invoices", PharmacyInvoiceViewSet, basename="pharmacy-invoices")
router.register(r"pharmacy/items", PharmacyInvoiceItemViewSet, basename="pharmacy-items")
router.register(r"pharmacy/suppliers", PharmacySupplierViewSet, basename="pharmacy-suppliers")

urlpatterns = [
    path("doctors/portal-preferences/", DoctorPortalPreferenceView.as_view(), name="doctors-portal-preferences"),
    path("doctors/custom-rx-salts/", HospitalCustomRxSaltListCreateView.as_view(), name="doctors-custom-rx-salts"),
    path("doctor-analytics/", DoctorFinancialAnalyticsView.as_view(), name="doctor-analytics"),
    path("follow-up-alerts/", follow_up_alerts, name="follow-up-alerts"),
    path("pharmacy/dashboard/", PharmacyDashboardView.as_view(), name="pharmacy-dashboard"),
    path("pharmacy/invoice/next-number/", PharmacyNextInvoiceNumberView.as_view(), name="pharmacy-next-invoice"),
    path("pharmacy/settings/", PharmacyOutletSettingsView.as_view(), name="pharmacy-outlet-settings"),
    path("settings/reception-portal/", ReceptionPortalSettingsView.as_view(), name="settings-reception-portal"),
    path("pharmacy/purchase-challan/", PharmacyPurchaseChallanView.as_view(), name="pharmacy-purchase-challan"),
    path("pharmacy/purchase-history/", PurchaseHistoryListView.as_view(), name="pharmacy-purchase-history"),
    path(
        "pharmacy/purchase-history/<uuid:pk>/",
        PurchaseHistoryDetailView.as_view(),
        name="pharmacy-purchase-history-detail",
    ),
    path("purchase/history/", PurchaseHistoryListView.as_view(), name="purchase-history"),
    path("purchase/history/<uuid:pk>/", PurchaseHistoryDetailView.as_view(), name="purchase-history-detail"),
    path("payments/quick-services/", payment_quick_services, name="payments-quick-services"),
    path("expenses/quick-services/", expense_quick_services, name="expenses-quick-services"),
    path("expenses/parties/", expense_parties, name="expenses-parties"),
    path("expenses/parties/<uuid:party_id>/", expense_party_detail, name="expenses-party-detail"),
    path("treatment/patient-overview/", PatientPlanOverviewView.as_view(), name="treatment-patient-overview"),
    path(
        "treatment/template-package-catalog/",
        TreatmentTemplateCatalogView.as_view(),
        name="treatment-template-package-catalog",
    ),
    path("", include(router.urls)),
]
