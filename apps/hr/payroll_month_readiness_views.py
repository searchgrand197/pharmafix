"""API for payroll month readiness (HR dashboard tasks)."""
from __future__ import annotations

from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.hr.attendance_finalization_views import _resolve_hospital
from apps.hr.payroll_month_readiness import (
    compute_payroll_month_readiness,
    default_payroll_month,
)
from apps.hr.permissions import IsHRStaffUser


class PayrollMonthReadinessView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        month = (request.query_params.get('month') or '').strip() or default_payroll_month()
        if len(month) != 7 or month[4] != '-':
            return Response({'error': 'month must be in YYYY-MM format.'}, status=400)

        hospital = _resolve_hospital(request)
        if hospital is None:
            return Response({'error': 'Hospital scope could not be resolved.'}, status=400)

        readiness = compute_payroll_month_readiness(hospital, month)
        return Response(readiness.as_dict())
