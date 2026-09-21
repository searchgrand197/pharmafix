from django.contrib import admin

from .models import OPDPaymentSlipSequence, OPDVisit, OPDVisitSequence, OPDVisitStatusHistory


@admin.register(OPDVisitSequence)
class OPDVisitSequenceAdmin(admin.ModelAdmin):
    list_display = ("id", "hospital", "year", "last_seq", "created_at", "updated_at")


@admin.register(OPDPaymentSlipSequence)
class OPDPaymentSlipSequenceAdmin(admin.ModelAdmin):
    list_display = ("id", "hospital", "year", "last_seq", "created_at", "updated_at")


@admin.register(OPDVisit)
class OPDVisitAdmin(admin.ModelAdmin):
    list_display = ("id", "visit_date", "queue_number", "opd_no", "opd_payment_slip_no", "patient", "status", "hospital", "is_deleted")
    list_filter = ("hospital", "status", "visit_date", "is_deleted")
    search_fields = ("opd_no", "opd_payment_slip_no", "id")


@admin.register(OPDVisitStatusHistory)
class OPDVisitStatusHistoryAdmin(admin.ModelAdmin):
    list_display = ("id", "visit", "from_status", "to_status", "created_at")
