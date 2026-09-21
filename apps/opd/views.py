from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from apps.opd.models import OPDVisit, OPDPaymentSlipSequence, OPDVisitSequence, OPDVisitStatusHistory
from apps.settings_management.document_number_service import render_document_number
from apps.shared.models import Hospital
from apps.opd.serializers import OPDVisitCreateUpdateSerializer, OPDVisitSerializer
from apps.opd.services import resolve_opd_doctor_name
from apps.patients.models import Patient
from apps.roles_permissions.permissions import HasRequiredPermission
from apps.auditlogs.services import create_audit_log
from apps.settings_management.models import ReceptionPortalSettings
from apps.shared.cancel_service import apply_void_if_last, is_last_opd_visit, release_opd_number, void_opd_sequence
from apps.shared.response import success_response


class OPDVisitViewSet(viewsets.ModelViewSet):
    queryset = OPDVisit.objects.filter(voided=False)
    filter_backends = (DjangoFilterBackend, SearchFilter, OrderingFilter)
    filterset_fields = {
        "visit_date": ["exact", "gte", "lte"],
        "status": ["exact"],
        "doctor_user": ["exact"],
        "patient": ["exact"],
        "department": ["exact", "icontains"],
    }
    search_fields = (
        "patient__uhid",
        "patient__phone",
        "patient__first_name",
        "patient__last_name",
    )
    ordering_fields = ("created_at", "visit_date")
    ordering = ("-visit_date", "-created_at")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]

    required_permission_map = {
        "list": "opd.view_opd_visit",
        "retrieve": "opd.view_opd_visit",
        "create": "opd.create_opd_visit",
        "update": "opd.update_opd_visit",
        "partial_update": "opd.update_opd_visit",
        "cancel": "opd.update_opd_visit",
        "destroy": "opd.delete_opd_visit",
        "next_opd_no": "opd.view_opd_visit",
        "generate_payment_slip": "opd.view_opd_visit",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return OPDVisitSerializer
        return OPDVisitCreateUpdateSerializer

    def get_required_permission(self) -> str | None:
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            'patient', 'patient__address', 'patient__guardian', 'doctor_user', 'created_by', 'cancelled_by'
        )
        user = self.request.user
        if not user.hospital_id:
            return qs.none()
        return qs.filter(hospital_id=user.hospital_id)

    def perform_create(self, serializer):
        patient: Patient = serializer.validated_data["patient"]
        if not self.request.user.hospital_id:
            raise ValidationError({"hospital": ["User is not linked to a hospital."]})
        if patient.hospital_id != self.request.user.hospital_id:
            raise ValidationError({"patient": ["Patient does not belong to your hospital."]})
        visit_date = serializer.validated_data.get("visit_date")

        settings_obj, _ = ReceptionPortalSettings.objects.get_or_create(
            hospital_id=patient.hospital_id,
            defaults={"default_city": "Jind", "default_state": "Haryana"},
        )
        slot_fee = settings_obj.get_current_opd_slot_fee()

        # Auto-assign queue number per hospital + visit_date (global daily counter, resets each day).
        qs = OPDVisit.objects.filter(
            hospital_id=patient.hospital_id,
            visit_date=visit_date,
            is_deleted=False,
        )
        next_queue = (qs.order_by("-queue_number").values_list("queue_number", flat=True).first() or 0) + 1
        visit = serializer.save(
            hospital_id=patient.hospital_id, 
            queue_number=next_queue,
            created_by=self.request.user,
            **({"amount": slot_fee} if slot_fee is not None else {}),
        )
        visit_datetime = getattr(serializer, "_visit_datetime", None)
        if visit_datetime is not None:
            OPDVisit.objects.filter(pk=visit.pk).update(created_at=visit_datetime)
            visit.refresh_from_db()
        create_audit_log(
            request=self.request,
            hospital=visit.hospital,
            module="opd",
            action="create_visit",
            obj=visit,
            after={"patient_uhid": visit.patient.uhid, "visit_date": str(visit.visit_date), "status": visit.status},
        )
        # Store the created visit on the serializer so create() can return full data.
        serializer._created_visit = visit

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        visit = serializer._created_visit
        # Re-fetch with all relations for the full read serializer response.
        visit_full = OPDVisit.objects.select_related(
            'patient', 'patient__address', 'patient__guardian', 'doctor_user'
        ).get(pk=visit.pk)
        read_serializer = OPDVisitSerializer(visit_full, context=self.get_serializer_context())
        return success_response(read_serializer.data, status_code=status.HTTP_201_CREATED)

    @transaction.atomic
    def perform_update(self, serializer):
        visit: OPDVisit = serializer.instance
        if visit.status == OPDVisit.Status.CANCELLED:
            raise ValidationError({"detail": "Cancelled OPD slips are view-only."})

        requested_status = serializer.validated_data.get("status")
        if requested_status == OPDVisit.Status.CANCELLED:
            raise ValidationError({"detail": "Use the cancel action to cancel an OPD slip."})

        old_status = visit.status
        serializer.save()
        visit_datetime = getattr(serializer, "_visit_datetime", None)
        if visit_datetime is not None:
            OPDVisit.objects.filter(pk=visit.pk).update(created_at=visit_datetime)
            serializer.instance.refresh_from_db()
        new_status = serializer.instance.status
        if new_status != old_status:
            OPDVisitStatusHistory.objects.create(
                visit=visit,
                from_status=old_status,
                to_status=new_status,
                changed_by=self.request.user,
            )
            create_audit_log(
                request=self.request,
                hospital=visit.hospital,
                module="opd",
                action="update_status",
                obj=visit,
                before={"status": old_status},
                after={"status": new_status},
            )

    @action(detail=False, methods=["get"], url_path="next-opd-no")
    def next_opd_no(self, request):
        user = request.user
        if not user.hospital_id:
            raise ValidationError({"hospital": ["User is not linked to a hospital."]})
        hospital = Hospital.objects.filter(pk=user.hospital_id).first()
        if hospital is None:
            raise ValidationError({"hospital": ["Hospital not found."]})
        year = timezone.now().year
        last_seq = (
            OPDVisitSequence.objects.filter(hospital_id=hospital.id, year=year)
            .values_list("last_seq", flat=True)
            .first()
            or 0
        )
        opd_no = render_document_number(hospital, "opd", year, last_seq + 1)
        return success_response({"opd_no": opd_no})

    @action(detail=True, methods=["post"], url_path="cancel")
    @transaction.atomic
    def cancel(self, request, *args, **kwargs):
        visit: OPDVisit = self.get_object()

        if visit.status == OPDVisit.Status.CANCELLED:
            raise ValidationError({"detail": "This OPD slip is already cancelled."})

        reason = str(request.data.get("cancel_reason") or request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"cancel_reason": ["Cancellation reason is required."]})

        old_status = visit.status
        apply_void_if_last(
            obj=visit,
            is_last_fn=is_last_opd_visit,
            void_seq_fn=void_opd_sequence,
            release_number_fn=release_opd_number,
        )
        visit.status = OPDVisit.Status.CANCELLED
        visit.cancel_reason = reason
        visit.cancelled_by = request.user
        visit.cancelled_at = timezone.now()
        update_fields = ["status", "cancel_reason", "cancelled_by", "cancelled_at", "voided", "updated_at"]
        if str(visit.opd_no or "").startswith("VOID-"):
            update_fields.append("opd_no")
        visit.save(update_fields=update_fields)

        OPDVisitStatusHistory.objects.create(
            visit=visit,
            from_status=old_status,
            to_status=OPDVisit.Status.CANCELLED,
            changed_by=request.user,
            notes=reason,
        )
        create_audit_log(
            request=request,
            hospital=visit.hospital,
            module="opd",
            action="cancel_visit",
            obj=visit,
            before={"status": old_status},
            after={
                "status": OPDVisit.Status.CANCELLED,
                "cancel_reason": reason,
                "cancelled_by": str(request.user.id),
                "cancelled_at": visit.cancelled_at.isoformat() if visit.cancelled_at else None,
            },
        )

        visit_full = OPDVisit.objects.select_related(
            "patient", "patient__address", "patient__guardian", "doctor_user", "created_by", "cancelled_by"
        ).get(pk=visit.pk)
        data = OPDVisitSerializer(visit_full, context=self.get_serializer_context()).data
        return success_response(data=data)

    @action(detail=True, methods=["post"], url_path="payment-slip")
    @transaction.atomic
    def generate_payment_slip(self, request, pk=None):
        visit: OPDVisit = self.get_object()
        if not visit.amount:
            return Response(
                {"success": False, "detail": "No payment amount recorded for this visit."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not visit.opd_payment_slip_no:
            visit.opd_payment_slip_no = visit.generate_opd_payment_slip_no()
            visit.save(update_fields=["opd_payment_slip_no", "updated_at"])
        return success_response({
            "slip_number": visit.opd_payment_slip_no,
            "visit_id": str(visit.id),
        })

from datetime import date, timedelta
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def follow_up_alerts(request):
    """
    Returns OPD visits where follow_up_date is today or tomorrow.
    Used by the receptionist portal to show follow-up call alerts.
    """
    hospital = getattr(request.user, 'hospital', None)
    if not hospital:
        return Response([])

    today = date.today()
    tomorrow = today + timedelta(days=1)

    visits = OPDVisit.objects.filter(
        hospital=hospital,
        follow_up_date__in=[today, tomorrow],
        follow_up_completed=False,
        deleted_at__isnull=True,
    ).select_related('patient', 'doctor_user').order_by('follow_up_date')

    results = []
    for v in visits:
        patient = v.patient
        name = f"{patient.first_name} {patient.last_name}".strip() or patient.uhid
        is_today = v.follow_up_date == today
        is_tomorrow = v.follow_up_date == tomorrow
        results.append({
            'id': str(v.id),
            'patient_name': name,
            'patient_phone': getattr(patient, 'phone', ''),
            'uhid': patient.uhid,
            'follow_up_date': str(v.follow_up_date),
            'original_visit_date': str(v.visit_date),
            'is_today': is_today,
            'is_tomorrow': is_tomorrow,
            'visit_reason': v.visit_reason,
            'revisit_advice': v.revisit_advice,
            'doctor_name': resolve_opd_doctor_name(
                doctor_user=v.doctor_user,
                hospital_id=v.hospital_id,
            ),
        })

    return Response(results)
