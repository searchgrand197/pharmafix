"""API for Journey Center aggregate counts."""
from __future__ import annotations

from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.hr.journey_center_counts import compute_journey_center_counts
from apps.hr.permissions import IsHRStaffUser


class JourneyCenterCountsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        job_opening = (request.query_params.get('job_opening') or '').strip() or None
        month = (request.query_params.get('month') or '').strip() or None
        payload = compute_journey_center_counts(
            request.user,
            job_opening_id=job_opening,
            month=month or None,
        )
        return Response(payload)
