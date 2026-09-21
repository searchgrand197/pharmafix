from django.contrib import admin

from .models import (
    IPDAdmission,
    IPDAdmissionSequence,
    IPDAdmissionStatusHistory,
    IPDDailyProcessLog,
    IPDTransferHistory,
    Scheme,
)


@admin.register(Scheme)
class SchemeAdmin(admin.ModelAdmin):
    list_display = ("name", "hospital", "is_active", "created_at")
    list_filter = ("hospital", "is_active")
    search_fields = ("name",)


@admin.register(IPDAdmissionSequence)
class IPDAdmissionSequenceAdmin(admin.ModelAdmin):
    list_display = ("id", "hospital", "year", "last_seq", "created_at", "updated_at")


@admin.register(IPDAdmission)
class IPDAdmissionAdmin(admin.ModelAdmin):
    list_display = ("id", "ipd_no", "patient", "admission_date", "status", "hospital", "is_deleted")
    list_filter = ("hospital", "status", "is_deleted")
    search_fields = ("ipd_no", "id")


@admin.register(IPDAdmissionStatusHistory)
class IPDAdmissionStatusHistoryAdmin(admin.ModelAdmin):
    list_display = ("id", "admission", "from_status", "to_status", "created_at")


@admin.register(IPDTransferHistory)
class IPDTransferHistoryAdmin(admin.ModelAdmin):
    list_display = ("id", "admission", "from_bed_code", "to_bed_code", "created_at")


@admin.register(IPDDailyProcessLog)
class IPDDailyProcessLogAdmin(admin.ModelAdmin):
    list_display = ("id", "admission", "log_date", "day_number", "recorded_by", "created_at")
    list_filter = ("hospital", "log_date")
    search_fields = ("admission__ipd_no", "admission__id")
