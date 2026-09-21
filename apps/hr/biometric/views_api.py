"""HR REST API for biometric device management."""

from __future__ import annotations

from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.hr.biometric.device_commands import device_is_online, pending_command_count
from apps.hr.biometric.health import build_connection_status_payload
from apps.hr.biometric.serializers import (
    BiometricCreateAndLinkSerializer,
    BiometricDeviceSerializer,
    BiometricLinkSerializer,
    BiometricRejectedPunchSerializer,
    BiometricSyncLogSerializer,
    BiometricUnlinkedUserSerializer,
)
from apps.hr.biometric.sync import (
    push_employee_to_hospital_devices,
    remove_employee_from_hospital_devices,
    sync_all_eligible_employees_for_device,
)
from apps.hr.biometric.unlinked_service import (
    BiometricLinkError,
    create_employee_from_unlinked,
    link_unlinked_user_to_employee,
    reject_unlinked_user,
)
from apps.hr.biometric_models import (
    BiometricDevice,
    BiometricRejectedPunch,
    BiometricSyncLog,
    BiometricUnlinkedUser,
)
from apps.hr.models import Employee
from apps.hr.permissions import IsHRStaffUser
from apps.hr.views import HRBaseViewSet, _resolve_hr_hospital_id


class BiometricDeviceViewSet(HRBaseViewSet):
    queryset = BiometricDevice.objects.select_related('hospital').all()
    serializer_class = BiometricDeviceSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        qs = super().get_queryset()
        active = self.request.query_params.get('active')
        if active == 'true':
            qs = qs.filter(is_active=True)
        elif active == 'false':
            qs = qs.filter(is_active=False)
        return qs.order_by('-last_seen')

    @action(detail=False, methods=['get'], url_path='connection-status')
    def connection_status(self, request):
        """HR dashboard: device online/offline and sync queue for this hospital."""
        hospital_id = _resolve_hr_hospital_id(request)
        return Response(build_connection_status_payload(hospital_id=hospital_id))

    def perform_create(self, serializer):
        hospital_id = _resolve_hr_hospital_id(self.request)
        serializer.save(hospital_id=hospital_id)

    @action(detail=True, methods=['get'], url_path='status')
    def device_status(self, request, pk=None):
        device = self.get_object()
        return Response({
            'device_id': str(device.id),
            'serial_number': device.serial_number,
            'is_online': device_is_online(device),
            'last_seen': device.last_seen.isoformat() if device.last_seen else None,
            'pending_commands': pending_command_count(device),
            'hospital_id': str(device.hospital_id) if device.hospital_id else None,
        })

    @action(detail=True, methods=['post'], url_path='sync-all')
    def sync_all(self, request, pk=None):
        device = self.get_object()
        if not device.hospital_id:
            return Response(
                {'success': False, 'message': 'Assign a hospital to this device before syncing employees.'},
                status=400,
            )
        count = sync_all_eligible_employees_for_device(device)
        return Response({'success': True, 'employees_queued': count})


class BiometricUnlinkedUserViewSet(HRBaseViewSet):
    queryset = BiometricUnlinkedUser.objects.select_related(
        'device', 'linked_employee', 'hospital',
    ).all()
    serializer_class = BiometricUnlinkedUserSerializer
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        qs = super().get_queryset()
        st = self.request.query_params.get('status')
        if st:
            qs = qs.filter(status=st)
        else:
            qs = qs.filter(status=BiometricUnlinkedUser.STATUS_PENDING)
        return qs.order_by('-last_seen_at')

    @action(detail=True, methods=['post'], url_path='link')
    def link(self, request, pk=None):
        unlinked = self.get_object()
        serializer = BiometricLinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            employee = Employee.objects.get(pk=serializer.validated_data['employee_id'])
        except Employee.DoesNotExist:
            return Response({'success': False, 'message': 'Employee not found.'}, status=404)
        try:
            result = link_unlinked_user_to_employee(
                unlinked, employee, resolved_by=request.user,
            )
        except BiometricLinkError as exc:
            body = {'success': False, 'code': exc.code, 'message': exc.message}
            if exc.field_errors:
                body['field_errors'] = exc.field_errors
            return Response(body, status=400)
        return Response({'success': True, **result})

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        unlinked = self.get_object()
        try:
            result = reject_unlinked_user(unlinked, resolved_by=request.user)
        except BiometricLinkError as exc:
            body = {'success': False, 'code': exc.code, 'message': exc.message}
            if exc.field_errors:
                body['field_errors'] = exc.field_errors
            return Response(body, status=400)
        return Response({'success': True, **result})

    @action(detail=True, methods=['post'], url_path='create-and-link')
    def create_and_link(self, request, pk=None):
        unlinked = self.get_object()
        serializer = BiometricCreateAndLinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = create_employee_from_unlinked(
                unlinked,
                hr_user=request.user,
                payload=serializer.validated_data,
            )
        except BiometricLinkError as exc:
            body = {'success': False, 'code': exc.code, 'message': exc.message}
            if exc.field_errors:
                body['field_errors'] = exc.field_errors
            return Response(body, status=400)
        except Exception as exc:
            import logging
            logging.getLogger('apps.hr.biometric').exception(
                'create-and-link failed for unlinked %s', pk,
            )
            return Response(
                {'success': False, 'code': 'server_error', 'message': str(exc) or 'Create and link failed.'},
                status=500,
            )
        return Response({'success': True, **result})


class BiometricSyncLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = BiometricSyncLog.objects.select_related('device', 'employee', 'hospital').all()
    serializer_class = BiometricSyncLogSerializer
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if getattr(user, 'hospital_id', None):
            qs = qs.filter(hospital_id=user.hospital_id)
        level = self.request.query_params.get('level')
        action_name = self.request.query_params.get('action')
        if level:
            qs = qs.filter(level=level)
        if action_name:
            qs = qs.filter(action=action_name)
        return qs.order_by('-created_at')[:500]


class BiometricRejectedPunchViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = BiometricRejectedPunch.objects.select_related('device', 'employee', 'hospital').all()
    serializer_class = BiometricRejectedPunchSerializer
    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get_queryset(self):
        qs = super().get_queryset().filter(dismissed_at__isnull=True)
        user = self.request.user
        if getattr(user, 'hospital_id', None):
            qs = qs.filter(hospital_id=user.hospital_id)
        reason = (self.request.query_params.get('reason') or '').strip()
        pin = (self.request.query_params.get('pin') or '').strip()
        if reason:
            qs = qs.filter(reason=reason)
        if pin:
            qs = qs.filter(pin=pin)
        return qs.order_by('-punch_time')

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='dismiss')
    def dismiss(self, request, pk=None):
        rejected = self.get_object()
        now = timezone.now()
        rejected.dismissed_at = now
        rejected.dismissed_by = request.user
        rejected.save(update_fields=['dismissed_at', 'dismissed_by', 'updated_at'])
        return Response({
            'success': True,
            'id': str(rejected.id),
            'dismissed_at': rejected.dismissed_at.isoformat(),
        })

    @action(detail=False, methods=['post'], url_path='dismiss-all')
    def dismiss_all(self, request):
        qs = self.get_queryset()
        now = timezone.now()
        updated = qs.update(dismissed_at=now, dismissed_by=request.user)
        return Response({'success': True, 'dismissed_count': updated})
