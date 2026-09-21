from django.contrib import admin

from .models import (
    DoctorDailyAvailability,
    DoctorPortalPreference,
    DoctorProfile,
    DoctorWeeklySchedule,
    HospitalCustomRxSalt,
    Specialty,
)


@admin.register(Specialty)
class SpecialtyAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "code", "hospital", "department", "is_active")
    list_filter = ("hospital", "is_active")
    search_fields = ("name", "code")


@admin.register(DoctorProfile)
class DoctorProfileAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "doctor_code", "hospital", "user", "is_active", "is_deleted")
    list_filter = ("hospital", "doctor_type", "is_active", "is_deleted")
    search_fields = ("name", "doctor_code", "mobile_number")


@admin.register(DoctorWeeklySchedule)
class DoctorWeeklyScheduleAdmin(admin.ModelAdmin):
    list_display = ("id", "doctor", "day_of_week", "start_time", "end_time", "is_available", "hospital")


@admin.register(DoctorDailyAvailability)
class DoctorDailyAvailabilityAdmin(admin.ModelAdmin):
    list_display = ("id", "doctor", "date", "is_available", "hospital")


@admin.register(DoctorPortalPreference)
class DoctorPortalPreferenceAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "hospital")


@admin.register(HospitalCustomRxSalt)
class HospitalCustomRxSaltAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "hospital", "use_count", "last_used_at", "created_by")
    list_filter = ("hospital",)
    search_fields = ("name", "normalized_name")
