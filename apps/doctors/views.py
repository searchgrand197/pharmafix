from __future__ import annotations

from django.db.models import F
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.filters import SearchFilter
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.auditlogs.services import create_audit_log
from apps.doctors.models import (
    DoctorDailyAvailability,
    DoctorPortalPreference,
    DoctorProfile,
    DoctorWeeklySchedule,
    HospitalCustomRxSalt,
    Specialty,
)
from apps.doctors.serializers import (
    DoctorDailyAvailabilityCreateUpdateSerializer,
    DoctorDailyAvailabilitySerializer,
    DoctorPortalPreferenceSerializer,
    DoctorProfileCreateUpdateSerializer,
    DoctorProfileSerializer,
    DoctorWeeklyScheduleCreateUpdateSerializer,
    DoctorWeeklyScheduleSerializer,
    HospitalCustomRxSaltSerializer,
    SpecialtyCreateUpdateSerializer,
    SpecialtySerializer,
)
from apps.roles_permissions.permissions import HasRequiredPermission
from apps.shared.master_delete import build_linked_doctors, operational_doctors_for_specialty
from apps.shared.response import success_response


class HospitalScopedMixin:
    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        return qs.filter(hospital_id=user.hospital_id)


class SpecialtyViewSet(HospitalScopedMixin, viewsets.ModelViewSet):
    queryset = Specialty.objects.filter(is_deleted=False).select_related("department")
    filter_backends = (SearchFilter,)
    search_fields = ("code", "name")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]

    required_permission_map = {
        "list": "doctors.view_specialty",
        "retrieve": "doctors.view_specialty",
        "create": "doctors.create_specialty",
        "update": "doctors.update_specialty",
        "partial_update": "doctors.update_specialty",
        "destroy": "doctors.delete_specialty",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return SpecialtySerializer
        return SpecialtyCreateUpdateSerializer

    def get_required_permission(self):
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def perform_create(self, serializer):
        specialty = serializer.save(hospital_id=self.request.user.hospital_id)
        create_audit_log(
            request=self.request,
            hospital=specialty.hospital,
            module="doctors",
            action="create_specialty",
            obj=specialty,
            after={"code": specialty.code, "name": specialty.name},
        )

    def perform_update(self, serializer):
        specialty = serializer.save()
        create_audit_log(
            request=self.request,
            hospital=specialty.hospital,
            module="doctors",
            action="update_specialty",
            obj=specialty,
            after={"code": specialty.code, "name": specialty.name},
        )

    def destroy(self, request, *args, **kwargs):
        """
        Archive when no operational doctor links remain; otherwise return linked doctors.
        """
        specialty = self.get_object()

        doctors_qs = operational_doctors_for_specialty(specialty)
        linked_doctors, doctors_count = build_linked_doctors(doctors_qs)

        if doctors_count == 0:
            pk = specialty.pk
            specialty.delete()
            return success_response(
                data={"id": str(pk), "message": "Specialty deleted successfully."},
            )

        return Response(
            {
                "success": False,
                "errors": {
                    "detail": (
                        "Cannot delete this specialty while it is linked to doctor profiles. "
                        "Reassign or remove those doctor records first."
                    ),
                    "linked_doctors": linked_doctors,
                    "linked_counts": {
                        "doctors": doctors_count,
                    },
                    "truncated": {
                        "doctors": doctors_count > len(linked_doctors),
                    },
                },
            },
            status=status.HTTP_409_CONFLICT,
        )


class DoctorProfileViewSet(HospitalScopedMixin, viewsets.ModelViewSet):
    # Only show non-deleted doctors by default.
    queryset = (
        DoctorProfile.objects.filter(is_deleted=False)
        .select_related("specialty", "user")
        .prefetch_related("departments")
    )
    filter_backends = (SearchFilter,)
    search_fields = ("name", "doctor_code", "department__name", "specialty__name")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]

    required_permission_map = {
        "list": "doctors.view_doctor",
        "retrieve": "doctors.view_doctor",
        "create": "doctors.create_doctor",
        "update": "doctors.update_doctor",
        "partial_update": "doctors.update_doctor",
        "destroy": "doctors.delete_doctor",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return DoctorProfileSerializer
        return DoctorProfileCreateUpdateSerializer

    def get_required_permission(self):
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def perform_create(self, serializer):
        doctor: DoctorProfile = serializer.save(hospital_id=self.request.user.hospital_id)
        create_audit_log(
            request=self.request,
            hospital=doctor.hospital,
            module="doctors",
            action="create_doctor",
            obj=doctor,
            after={
                "name": doctor.name,
                "department_ids": [str(d_id) for d_id in doctor.departments.values_list("id", flat=True)],
            },
        )

    def perform_update(self, serializer):
        doctor: DoctorProfile = serializer.save()
        create_audit_log(
            request=self.request,
            hospital=doctor.hospital,
            module="doctors",
            action="update_doctor",
            obj=doctor,
            after={"name": doctor.name, "consultation_fee": str(doctor.consultation_fee)},
        )

    def destroy(self, request, *args, **kwargs):
        """
        Soft-delete a doctor profile and return a clear success message.
        """
        from apps.shared.response import success_response

        doctor: DoctorProfile = self.get_object()
        pk = doctor.pk
        hospital = doctor.hospital

        doctor.delete()

        create_audit_log(
            request=request,
            hospital=hospital,
            module="doctors",
            action="delete_doctor",
            obj=doctor,
            after={"id": str(pk), "name": doctor.name},
        )

        return success_response(data={"id": str(pk), "message": "Doctor deleted successfully."})


class DoctorWeeklyScheduleViewSet(HospitalScopedMixin, viewsets.ModelViewSet):
    queryset = DoctorWeeklySchedule.objects.all().select_related("doctor")
    filter_backends = (SearchFilter,)
    search_fields = ("doctor__name",)

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]

    required_permission_map = {
        "list": "doctors.view_schedule",
        "retrieve": "doctors.view_schedule",
        "create": "doctors.create_schedule",
        "update": "doctors.update_schedule",
        "partial_update": "doctors.update_schedule",
        "destroy": "doctors.delete_schedule",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return DoctorWeeklyScheduleSerializer
        return DoctorWeeklyScheduleCreateUpdateSerializer

    def get_required_permission(self):
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def perform_create(self, serializer):
        schedule: DoctorWeeklySchedule = serializer.save(hospital_id=self.request.user.hospital_id)
        create_audit_log(
            request=self.request,
            hospital=schedule.hospital,
            module="doctors",
            action="create_weekly_schedule",
            obj=schedule,
            after={"doctor_id": str(schedule.doctor_id), "day_of_week": schedule.day_of_week},
        )

    def perform_update(self, serializer):
        schedule: DoctorWeeklySchedule = serializer.save()
        create_audit_log(
            request=self.request,
            hospital=schedule.hospital,
            module="doctors",
            action="update_weekly_schedule",
            obj=schedule,
            after={"doctor_id": str(schedule.doctor_id), "is_available": schedule.is_available},
        )


class DoctorDailyAvailabilityViewSet(HospitalScopedMixin, viewsets.ModelViewSet):
    queryset = DoctorDailyAvailability.objects.all().select_related("doctor")
    filter_backends = (SearchFilter,)
    search_fields = ("doctor__name", "date")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]

    required_permission_map = {
        "list": "doctors.view_daily_availability",
        "retrieve": "doctors.view_daily_availability",
        "create": "doctors.create_daily_availability",
        "update": "doctors.update_daily_availability",
        "partial_update": "doctors.update_daily_availability",
        "destroy": "doctors.delete_daily_availability",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return DoctorDailyAvailabilitySerializer
        return DoctorDailyAvailabilityCreateUpdateSerializer

    def get_required_permission(self):
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def perform_create(self, serializer):
        availability: DoctorDailyAvailability = serializer.save(hospital_id=self.request.user.hospital_id)
        create_audit_log(
            request=self.request,
            hospital=availability.hospital,
            module="doctors",
            action="create_daily_availability",
            obj=availability,
            after={"doctor_id": str(availability.doctor_id), "date": str(availability.date)},
        )

    def perform_update(self, serializer):
        availability: DoctorDailyAvailability = serializer.save()
        create_audit_log(
            request=self.request,
            hospital=availability.hospital,
            module="doctors",
            action="update_daily_availability",
            obj=availability,
            after={"doctor_id": str(availability.doctor_id), "is_available": availability.is_available},
        )


class DoctorPortalPreferenceView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        pref, _ = DoctorPortalPreference.objects.get_or_create(
            user=request.user,
            defaults={"hospital_id": request.user.hospital_id},
        )
        data = DoctorPortalPreferenceSerializer(pref).data
        return success_response(data=data)

    def put(self, request, *args, **kwargs):
        pref, _ = DoctorPortalPreference.objects.get_or_create(
            user=request.user,
            defaults={"hospital_id": request.user.hospital_id},
        )
        serializer = DoctorPortalPreferenceSerializer(pref, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(hospital_id=request.user.hospital_id)
        return success_response(data=serializer.data)

    patch = put


class HospitalCustomRxSaltListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        hospital_id = getattr(request.user, "hospital_id", None)
        if not hospital_id:
            return Response({"detail": "Hospital not set."}, status=status.HTTP_400_BAD_REQUEST)
        qs = (
            HospitalCustomRxSalt.objects.filter(hospital_id=hospital_id)
            .order_by("-last_used_at")[:200]
        )
        data = HospitalCustomRxSaltSerializer(qs, many=True).data
        return success_response(data=data)

    def post(self, request, *args, **kwargs):
        hospital_id = getattr(request.user, "hospital_id", None)
        if not hospital_id:
            return Response({"detail": "Hospital not set."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = HospitalCustomRxSaltSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        name = serializer.validated_data["name"]
        normalized = name.lower().strip()

        obj, created = HospitalCustomRxSalt.objects.get_or_create(
            hospital_id=hospital_id,
            normalized_name=normalized,
            defaults={
                "name": name,
                "created_by": request.user,
                "last_used_at": timezone.now(),
                "use_count": 1,
            },
        )
        if not created:
            HospitalCustomRxSalt.objects.filter(pk=obj.pk).update(
                name=name,
                last_used_at=timezone.now(),
                use_count=F("use_count") + 1,
            )
            obj.refresh_from_db()

        return success_response(
            data=HospitalCustomRxSaltSerializer(obj).data,
            message="Custom medicine saved." if created else "Custom medicine updated.",
        )
