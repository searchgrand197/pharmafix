"""HR API for attendance month finalization."""
from __future__ import annotations

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.hr.attendance_finalization_service import (
    AttendanceFinalizationError,
    finalize_attendance_month,
    get_attendance_month_finalization,
    is_attendance_month_finalized,
    unfinalize_attendance_month,
)
from apps.hr.hospital_context import resolve_hr_hospital
from apps.hr.permissions import IsHRStaffUser


def _resolve_hospital(request):
    return resolve_hr_hospital(request)


class AttendanceFinalizeMonthView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def post(self, request):
        month = (request.data.get('month') or '').strip()
        if not month or len(month) != 7:
            return Response({'error': 'month is required in YYYY-MM format.'}, status=400)

        hospital = _resolve_hospital(request)
        if hospital is None:
            return Response({'error': 'Hospital scope could not be resolved.'}, status=400)

        block_on_hr_review = str(request.data.get('block_on_hr_review', 'false')).lower() in {'1', 'true', 'yes'}
        try:
            record, report = finalize_attendance_month(
                hospital=hospital,
                month=month,
                finalized_by=request.user,
                block_on_hr_review=block_on_hr_review,
            )
        except AttendanceFinalizationError as exc:
            return Response({'error': exc.message, 'code': exc.code}, status=400)

        return Response({
            'id': str(record.id),
            'month': record.month,
            'hospital_id': str(record.hospital_id),
            'finalized_at': record.finalized_at,
            'summary': record.summary,
            'rows_finalized': report.rows_finalized,
            'employees_touched': report.employees_touched,
            'warnings': report.warnings,
        }, status=201)


class AttendanceUnfinalizeMonthView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def post(self, request):
        month = (request.data.get('month') or '').strip()
        if not month:
            return Response({'error': 'month is required.'}, status=400)

        hospital = _resolve_hospital(request)
        if hospital is None:
            return Response({'error': 'Hospital scope could not be resolved.'}, status=400)

        try:
            cleared = unfinalize_attendance_month(hospital=hospital, month=month)
        except AttendanceFinalizationError as exc:
            return Response({'error': exc.message, 'code': exc.code}, status=400)

        return Response({'month': month, 'rows_cleared': cleared})


class AttendanceFinalizeMonthStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        month = (request.query_params.get('month') or '').strip()
        if not month:
            return Response({'error': 'month query parameter is required.'}, status=400)

        hospital = _resolve_hospital(request)
        if hospital is None:
            return Response({'error': 'Hospital scope could not be resolved.'}, status=400)

        record = get_attendance_month_finalization(hospital, month)
        return Response({
            'month': month,
            'hospital_id': str(hospital.id),
            'finalized': record is not None,
            'finalized_at': record.finalized_at if record else None,
            'summary': record.summary if record else {},
        })
