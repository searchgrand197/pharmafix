from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.hr.employee_portal import resolve_employee_for_user
from apps.hr.models import Employee
from apps.hr.payroll_api.compensation_level_service import (
    CompensationLevelError,
    EmployeeCompensationAssignmentError,
    EmployeeCompensationOverrideError,
    assign_compensation_level_to_employee,
    bulk_assign_compensation_level,
    compensation_assignment_history,
    compensation_override_history,
    save_compensation_level,
    save_employee_compensation_override,
    set_default_compensation_level,
)
from apps.hr.payroll_api.assignment_service import (
    SalaryStructureAssignmentError,
    assign_salary_structure,
    assignment_history,
    copy_structure_fields,
)
from apps.hr.payroll_api.department_structure_service import (
    DepartmentSalaryStructureError,
    bulk_assign_department_structure,
    copy_department_structure_fields,
    save_department_salary_structure,
)
from apps.hr.payroll_api.serializers import (
    CompensationLevelAssignSerializer,
    CompensationLevelSaveSerializer,
    CompensationLevelSerializer,
    DepartmentSalaryStructureAssignSerializer,
    DepartmentSalaryStructureOptionSerializer,
    DepartmentSalaryStructureSaveSerializer,
    DepartmentSalaryStructureSerializer,
    EmployeeCompensationAssignmentCreateSerializer,
    EmployeeCompensationAssignmentSerializer,
    EmployeeCompensationOverrideCreateSerializer,
    EmployeeCompensationOverrideSerializer,
    PayrollGenerateSerializer,
    SalaryStructureAssignSerializer,
    SalaryStructureOptionSerializer,
    SalaryStructureSerializer,
)
from apps.hr.permissions import IsEmployeePortalUser, IsHRStaffUser
from apps.hr.serializers import PayrollRunSerializer, PayslipSerializer


def _scoped_employees(user):
    qs = Employee.objects.all()
    if getattr(user, 'hospital_id', None):
        qs = qs.filter(hospital_id=user.hospital_id)
    return qs


def _scoped_salary_structures(user):
    from apps.hr.payroll_models import SalaryStructure

    qs = SalaryStructure.objects.select_related(
        'employee',
        'source_department_structure',
        'source_department_structure__department',
    ).all()
    if getattr(user, 'hospital_id', None):
        qs = qs.filter(employee__hospital_id=user.hospital_id)
    return qs


def _scoped_department_salary_structures(user):
    from apps.hr.payroll_models import DepartmentSalaryStructure

    qs = DepartmentSalaryStructure.objects.select_related('department').all()
    if getattr(user, 'hospital_id', None):
        qs = qs.filter(department__hospital_id=user.hospital_id)
    return qs


def _scoped_compensation_levels(user):
    from apps.hr.payroll_models import CompensationLevel

    qs = CompensationLevel.objects.select_related('designation', 'hospital').all()
    if getattr(user, 'hospital_id', None):
        qs = qs.filter(hospital_id=user.hospital_id)
    return qs


def _scoped_compensation_assignments(user):
    from apps.hr.payroll_models import EmployeeCompensationAssignment

    qs = EmployeeCompensationAssignment.objects.select_related(
        'employee',
        'compensation_level',
        'compensation_level__designation',
    ).all()
    if getattr(user, 'hospital_id', None):
        qs = qs.filter(employee__hospital_id=user.hospital_id)
    return qs


def _scoped_compensation_overrides(user):
    from apps.hr.payroll_models import EmployeeCompensationOverride

    qs = EmployeeCompensationOverride.objects.select_related('employee', 'approved_by').all()
    if getattr(user, 'hospital_id', None):
        qs = qs.filter(employee__hospital_id=user.hospital_id)
    return qs


def _scoped_payroll_runs(user):
    from apps.hr.payroll_models import PayrollRun

    qs = PayrollRun.objects.select_related(
        'employee',
        'salary_structure',
        'employee_compensation_assignment',
        'employee_compensation_assignment__compensation_level',
    ).prefetch_related('payslip')
    if getattr(user, 'hospital_id', None):
        qs = qs.filter(employee__hospital_id=user.hospital_id)
    return qs


def _get_scoped_payroll_run(user, pk):
    return get_object_or_404(_scoped_payroll_runs(user), pk=pk)


class SalaryStructureListView(APIView):
    """GET /api/payroll/structures/ — list salary structures (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        qs = _scoped_salary_structures(request.user)
        employee_id = (request.query_params.get('employee') or '').strip()
        job_opening = (request.query_params.get('job_opening') or '').strip()
        active_only = (request.query_params.get('active') or '').strip().lower()
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if job_opening:
            qs = qs.filter(employee__candidate__job_opening_id=job_opening)
        if active_only in {'1', 'true', 'yes'}:
            qs = qs.filter(is_active=True)
        qs = qs.order_by('-effective_from', '-created_at')
        return Response({
            'results': SalaryStructureSerializer(qs, many=True, context={'request': request}).data,
        })


def _structure_option_payload(structure) -> dict:
    gross_hint = structure.basic_salary + structure.hra
    return {
        'id': structure.id,
        'label': (
            f'{structure.employee.name} ({structure.employee.employee_id}) — '
            f'Basic {structure.basic_salary} + HRA {structure.hra} (≈{gross_hint})'
        ),
        'employee_name': structure.employee.name,
        'employee_code': structure.employee.employee_id,
        'basic_salary': structure.basic_salary,
        'hra': structure.hra,
        'allowances': structure.allowances or {},
        'deductions': structure.deductions or {},
        'overtime_rate': structure.overtime_rate,
        'effective_from': structure.effective_from,
        'is_active': structure.is_active,
    }


class SalaryStructureOptionsView(APIView):
    """GET /api/payroll/structures/options/ — selectable salary structures (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        qs = _scoped_salary_structures(request.user).select_related('employee')
        active_only = (request.query_params.get('active') or '').strip().lower()
        if active_only in {'1', 'true', 'yes'}:
            qs = qs.filter(is_active=True)
        qs = qs.order_by('-effective_from', 'employee__name')[:200]
        options = [_structure_option_payload(row) for row in qs]
        return Response({
            'results': SalaryStructureOptionSerializer(options, many=True).data,
        })


class SalaryStructureHistoryView(APIView):
    """GET /api/payroll/structures/history/?employee={id} — assignment history (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        employee_id = (request.query_params.get('employee') or '').strip()
        if not employee_id:
            return Response({'error': 'employee query parameter is required.'}, status=400)

        employee = get_object_or_404(_scoped_employees(request.user), pk=employee_id)
        history = assignment_history(employee)
        return Response({
            'employee': str(employee.id),
            'employee_name': employee.name,
            'employee_code': employee.employee_id,
            'results': SalaryStructureSerializer(history, many=True, context={'request': request}).data,
        })


def _department_structure_option_payload(structure) -> dict:
    label_name = structure.name or structure.department.name
    gross_hint = structure.basic_salary + structure.hra
    return {
        'id': structure.id,
        'label': (
            f'{structure.department.name} — {label_name} — '
            f'Basic {structure.basic_salary} + HRA {structure.hra} (≈{gross_hint})'
        ),
        'department_name': structure.department.name,
        'name': structure.name,
        'basic_salary': structure.basic_salary,
        'hra': structure.hra,
        'allowances': structure.allowances or {},
        'deductions': structure.deductions or {},
        'overtime_rate': structure.overtime_rate,
        'effective_from': structure.effective_from,
        'is_active': structure.is_active,
    }


class DepartmentSalaryStructureListView(APIView):
    """GET/POST /api/payroll/department-structures/ — department salary templates (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        qs = _scoped_department_salary_structures(request.user)
        department_id = (request.query_params.get('department') or '').strip()
        active_only = (request.query_params.get('active') or '').strip().lower()
        if department_id:
            qs = qs.filter(department_id=department_id)
        if active_only in {'1', 'true', 'yes'}:
            qs = qs.filter(is_active=True)
        qs = qs.order_by('-effective_from', '-created_at')
        return Response({
            'results': DepartmentSalaryStructureSerializer(qs, many=True, context={'request': request}).data,
        })

    def post(self, request):
        serializer = DepartmentSalaryStructureSaveSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        department = data['department']
        if getattr(request.user, 'hospital_id', None) and department.hospital_id != request.user.hospital_id:
            return Response({'error': 'Department not found in your hospital scope.'}, status=404)

        try:
            from apps.hr.attendance_compliance import extract_compliance_payload

            structure = save_department_salary_structure(
                department=department,
                designation=data.get('designation'),
                name=data.get('name') or '',
                effective_from=data['effective_from'],
                basic_salary=data['basic_salary'],
                hra=data.get('hra', 0),
                allowances=data.get('allowances') or {},
                deductions=data.get('deductions') or {},
                overtime_rate=data.get('overtime_rate', 0),
                effective_to=data.get('effective_to'),
                notes=data.get('notes') or '',
                deactivate_previous=data.get('deactivate_previous', True),
                compliance_fields=extract_compliance_payload(data),
            )
        except DepartmentSalaryStructureError as exc:
            return Response({'error': exc.message, 'code': exc.code}, status=status.HTTP_400_BAD_REQUEST)

        assignment_result = None
        if data.get('assign_to_employees', True):
            assignment_result = bulk_assign_department_structure(
                department_structure=structure,
                effective_from=data['effective_from'],
                notes=data.get('notes') or '',
                skip_employees_with_structure=True,
            )

        return Response({
            'structure': DepartmentSalaryStructureSerializer(structure, context={'request': request}).data,
            'employee_assignment': assignment_result,
        }, status=status.HTTP_201_CREATED)


class DepartmentSalaryStructureOptionsView(APIView):
    """GET /api/payroll/department-structures/options/ — selectable department templates."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        qs = _scoped_department_salary_structures(request.user).select_related('department')
        department_id = (request.query_params.get('department') or '').strip()
        active_only = (request.query_params.get('active') or '').strip().lower()
        if department_id:
            qs = qs.filter(department_id=department_id)
        if active_only in {'1', 'true', 'yes'}:
            qs = qs.filter(is_active=True)
        qs = qs.order_by('-effective_from', 'department__name')[:200]
        options = [_department_structure_option_payload(row) for row in qs]
        return Response({
            'results': DepartmentSalaryStructureOptionSerializer(options, many=True).data,
        })


class DepartmentSalaryStructureAssignView(APIView):
    """POST /api/payroll/department-structures/{id}/assign-employees/ — bulk assign to department employees."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def post(self, request, pk):
        structure = get_object_or_404(_scoped_department_salary_structures(request.user), pk=pk)
        serializer = DepartmentSalaryStructureAssignSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        result = bulk_assign_department_structure(
            department_structure=structure,
            effective_from=data.get('effective_from'),
            notes=data.get('notes') or '',
            skip_employees_with_structure=data.get('skip_employees_with_structure', True),
        )
        return Response(result, status=status.HTTP_200_OK)


class CompensationLevelListView(APIView):
    """GET/POST /api/payroll/compensation-levels/ — pay-grade templates (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        qs = _scoped_compensation_levels(request.user)
        designation_id = (request.query_params.get('designation') or '').strip()
        active_only = (request.query_params.get('active') or '').strip().lower()
        default_only = (request.query_params.get('default') or '').strip().lower()
        if designation_id:
            qs = qs.filter(designation_id=designation_id)
        if active_only in {'1', 'true', 'yes'}:
            qs = qs.filter(is_active=True)
        if default_only in {'1', 'true', 'yes'}:
            qs = qs.filter(is_default_for_designation=True)
        qs = qs.order_by('designation__name', 'rank', '-effective_from', '-created_at')
        return Response({
            'results': CompensationLevelSerializer(qs, many=True, context={'request': request}).data,
        })

    def post(self, request):
        serializer = CompensationLevelSaveSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        designation = data.get('designation')
        if (
            designation is not None
            and getattr(request.user, 'hospital_id', None)
            and designation.hospital_id != request.user.hospital_id
        ):
            return Response({'error': 'Designation not found in your hospital scope.'}, status=404)
        hospital = designation.hospital if designation is not None else getattr(request.user, 'hospital', None)
        if hospital is None:
            return Response({'error': 'Hospital scope could not be resolved.'}, status=400)

        try:
            from apps.hr.attendance_compliance import extract_compliance_payload

            level = save_compensation_level(
                hospital=hospital,
                designation=designation,
                code=data['code'],
                name=data.get('name') or '',
                rank=data.get('rank', 0),
                basic=data['basic'],
                hra=data.get('hra', 0),
                medical=data.get('medical', 0),
                special_allowance=data.get('special_allowance', 0),
                allowances=data.get('allowances') or {},
                deductions=data.get('deductions') or {},
                overtime_rate=data.get('overtime_rate', 0),
                effective_from=data['effective_from'],
                effective_to=data.get('effective_to'),
                notes=data.get('notes') or '',
                is_default_for_designation=data.get('is_default_for_designation', False),
                deactivate_previous=data.get('deactivate_previous', True),
                compliance_fields=extract_compliance_payload(data),
            )
        except CompensationLevelError as exc:
            return Response({'error': exc.message, 'code': exc.code}, status=status.HTTP_400_BAD_REQUEST)

        assignment_result = None
        if data.get('assign_to_employees', False):
            assignment_result = bulk_assign_compensation_level(
                level=level,
                effective_from=data['effective_from'],
                skip_employees_with_assignment=True,
            )

        return Response({
            'level': CompensationLevelSerializer(level, context={'request': request}).data,
            'employee_assignment': assignment_result,
        }, status=status.HTTP_201_CREATED)


class CompensationLevelDetailView(APIView):
    """GET/PATCH /api/payroll/compensation-levels/{id}/ — read or version pay levels."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request, pk):
        level = get_object_or_404(_scoped_compensation_levels(request.user), pk=pk)
        return Response(
            CompensationLevelSerializer(level, context={'request': request}).data,
        )

    def patch(self, request, pk):
        existing = get_object_or_404(_scoped_compensation_levels(request.user), pk=pk)

        # "Set default" flips a flag on the existing row — do not create a new version.
        payload_keys = {str(key) for key in request.data.keys()}
        default_only_keys = {'is_default_for_designation', 'basic', 'effective_from'}
        wants_default = request.data.get('is_default_for_designation') in (True, 'true', 'True', 1, '1')
        if wants_default and payload_keys <= default_only_keys:
            try:
                level = set_default_compensation_level(existing)
            except CompensationLevelError as exc:
                return Response(
                    {'error': exc.message, 'code': exc.code},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                CompensationLevelSerializer(level, context={'request': request}).data,
            )

        serializer = CompensationLevelSaveSerializer(data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        designation = data.get('designation', existing.designation)
        if (
            designation is not None
            and getattr(request.user, 'hospital_id', None)
            and designation.hospital_id != request.user.hospital_id
        ):
            return Response({'error': 'Designation not found in your hospital scope.'}, status=404)

        try:
            from apps.hr.attendance_compliance import compliance_fields_dict, extract_compliance_payload

            compliance_fields = compliance_fields_dict(existing)
            compliance_fields.update(extract_compliance_payload(data))
            level = save_compensation_level(
                hospital=existing.hospital,
                designation=designation,
                code=data.get('code', existing.code),
                name=data.get('name', existing.name),
                rank=data.get('rank', existing.rank),
                basic=data.get('basic', existing.basic),
                hra=data.get('hra', existing.hra),
                medical=data.get('medical', existing.medical),
                special_allowance=data.get('special_allowance', existing.special_allowance),
                allowances=data.get('allowances', existing.allowances),
                deductions=data.get('deductions', existing.deductions),
                overtime_rate=data.get('overtime_rate', existing.overtime_rate),
                effective_from=data.get('effective_from', existing.effective_from),
                effective_to=data.get('effective_to', existing.effective_to),
                notes=data.get('notes', existing.notes),
                is_default_for_designation=data.get(
                    'is_default_for_designation',
                    existing.is_default_for_designation,
                ),
                deactivate_previous=data.get('deactivate_previous', True),
                compliance_fields=compliance_fields,
            )
        except CompensationLevelError as exc:
            return Response({'error': exc.message, 'code': exc.code}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            CompensationLevelSerializer(level, context={'request': request}).data,
        )


class CompensationLevelAssignView(APIView):
    """POST /api/payroll/compensation-levels/{id}/assign-employees/ — bulk assign by level."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def post(self, request, pk):
        level = get_object_or_404(_scoped_compensation_levels(request.user), pk=pk)
        serializer = CompensationLevelAssignSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        result = bulk_assign_compensation_level(
            level=level,
            effective_from=data.get('effective_from'),
            skip_employees_with_assignment=data.get('skip_employees_with_assignment', True),
        )
        return Response(result, status=status.HTTP_200_OK)


class EmployeeCompensationAssignmentListView(APIView):
    """GET/POST /api/payroll/compensation-assignments/ — employee pay-grade assignment history."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        employee_id = (request.query_params.get('employee') or '').strip()
        active_only = (request.query_params.get('active') or '').strip().lower()
        if employee_id:
            employee = get_object_or_404(_scoped_employees(request.user), pk=employee_id)
            history = compensation_assignment_history(employee)
            qs = history
        else:
            qs = _scoped_compensation_assignments(request.user)
        if active_only in {'1', 'true', 'yes'}:
            qs = qs.filter(is_active=True)
        qs = qs.order_by('-effective_from', '-created_at')
        return Response({
            'results': EmployeeCompensationAssignmentSerializer(qs, many=True, context={'request': request}).data,
        })

    def post(self, request):
        serializer = EmployeeCompensationAssignmentCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        employee = data['employee']
        if not _scoped_employees(request.user).filter(pk=employee.pk).exists():
            return Response({'error': 'Employee not found in your hospital scope.'}, status=404)

        level = get_object_or_404(
            _scoped_compensation_levels(request.user),
            pk=data['compensation_level'],
        )
        try:
            assignment, _legacy, skip_reason = assign_compensation_level_to_employee(
                employee=employee,
                level=level,
                effective_from=data['effective_from'],
            )
        except EmployeeCompensationAssignmentError as exc:
            return Response({'error': exc.message, 'code': exc.code}, status=status.HTTP_400_BAD_REQUEST)

        if assignment is None:
            return Response({'error': skip_reason or 'Assignment skipped.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'assignment': EmployeeCompensationAssignmentSerializer(
                assignment,
                context={'request': request},
            ).data,
        }, status=status.HTTP_201_CREATED)


class EmployeeCompensationOverrideListView(APIView):
    """GET/POST /api/payroll/compensation-overrides/ — employee pay override history."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        employee_id = (request.query_params.get('employee') or '').strip()
        active_only = (request.query_params.get('active') or '').strip().lower()
        if employee_id:
            employee = get_object_or_404(_scoped_employees(request.user), pk=employee_id)
            qs = compensation_override_history(employee)
        else:
            qs = _scoped_compensation_overrides(request.user)
        if active_only in {'1', 'true', 'yes'}:
            qs = qs.filter(is_active=True)
        qs = qs.order_by('-effective_from', '-created_at')
        return Response({
            'results': EmployeeCompensationOverrideSerializer(qs, many=True, context={'request': request}).data,
        })

    def post(self, request):
        serializer = EmployeeCompensationOverrideCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        employee = data['employee']
        if not _scoped_employees(request.user).filter(pk=employee.pk).exists():
            return Response({'error': 'Employee not found in your hospital scope.'}, status=404)

        try:
            override = save_employee_compensation_override(
                employee=employee,
                effective_from=data['effective_from'],
                effective_to=data.get('effective_to'),
                basic=data.get('basic'),
                hra=data.get('hra'),
                medical=data.get('medical'),
                special_allowance=data.get('special_allowance'),
                allowances=data.get('allowances'),
                deductions=data.get('deductions'),
                overtime_rate=data.get('overtime_rate'),
                reason=data.get('reason') or '',
                approved_by=request.user,
                deactivate_previous=data.get('deactivate_previous', True),
            )
        except EmployeeCompensationOverrideError as exc:
            return Response({'error': exc.message, 'code': exc.code}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            EmployeeCompensationOverrideSerializer(
                override,
                context={'request': request},
            ).data,
            status=status.HTTP_201_CREATED,
        )


class SalaryStructureAssignView(APIView):
    """POST /api/payroll/structures/assign/ — assign structure to employee (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def post(self, request):
        serializer = SalaryStructureAssignSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        employee = data['employee']
        scoped = _scoped_employees(request.user)
        if not scoped.filter(pk=employee.pk).exists():
            return Response({'error': 'Employee not found in your hospital scope.'}, status=404)

        source_structure = data.get('source_structure')
        source_department_structure = data.get('source_department_structure')
        from apps.hr.attendance_compliance import extract_compliance_payload

        if source_structure is not None:
            if getattr(request.user, 'hospital_id', None) and source_structure.employee.hospital_id != request.user.hospital_id:
                return Response({'error': 'Source structure is outside your hospital scope.'}, status=404)
            copied = copy_structure_fields(source_structure)
            basic_salary = copied['basic_salary']
            hra = copied['hra']
            allowances = copied['allowances']
            deductions = copied['deductions']
            overtime_rate = copied['overtime_rate']
            compliance_fields = extract_compliance_payload(copied)
        elif source_department_structure is not None:
            if (
                getattr(request.user, 'hospital_id', None)
                and source_department_structure.department.hospital_id != request.user.hospital_id
            ):
                return Response({'error': 'Department structure is outside your hospital scope.'}, status=404)
            copied = copy_department_structure_fields(source_department_structure)
            basic_salary = copied['basic_salary']
            hra = copied['hra']
            allowances = copied['allowances']
            deductions = copied['deductions']
            overtime_rate = copied['overtime_rate']
            compliance_fields = extract_compliance_payload(copied)
        else:
            basic_salary = data['basic_salary']
            hra = data.get('hra', 0)
            allowances = data.get('allowances') or {}
            deductions = data.get('deductions') or {}
            overtime_rate = data.get('overtime_rate', 0)
            compliance_fields = extract_compliance_payload(data)

        try:
            structure = assign_salary_structure(
                employee=employee,
                effective_from=data['effective_from'],
                basic_salary=basic_salary,
                hra=hra,
                allowances=allowances,
                deductions=deductions,
                overtime_rate=overtime_rate,
                effective_to=data.get('effective_to'),
                notes=data.get('notes') or '',
                source_structure=source_structure,
                source_department_structure=source_department_structure,
                deactivate_previous=data.get('deactivate_previous', True),
                compliance_fields=compliance_fields,
            )
        except SalaryStructureAssignmentError as exc:
            return Response({'error': exc.message, 'code': exc.code}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            SalaryStructureSerializer(structure, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class EmployeeDepartmentStructurePreviewView(APIView):
    """GET /api/payroll/structures/department-preview/?employee={id} — active dept template for employee."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        from apps.hr.payroll_api.department_structure_service import (
            get_active_department_structure,
            resolve_employee_department,
        )

        employee_id = (request.query_params.get('employee') or '').strip()
        if not employee_id:
            return Response({'error': 'employee query parameter is required.'}, status=400)

        employee = get_object_or_404(_scoped_employees(request.user), pk=employee_id)
        department = resolve_employee_department(employee)
        if department is None:
            return Response({
                'employee': str(employee.id),
                'department': None,
                'structure': None,
            })

        structure = get_active_department_structure(department)
        return Response({
            'employee': str(employee.id),
            'department': {'id': str(department.id), 'name': department.name},
            'structure': (
                DepartmentSalaryStructureSerializer(structure, context={'request': request}).data
                if structure else None
            ),
        })


class EmployeeCompensationPreviewView(APIView):
    """GET /api/payroll/compensation/preview/?employee={id}&month=YYYY-MM — effective pay source."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        from apps.hr.payroll_structure_resolver import resolve_compensation

        employee_id = (request.query_params.get('employee') or '').strip()
        if not employee_id:
            return Response({'error': 'employee query parameter is required.'}, status=400)

        employee = get_object_or_404(_scoped_employees(request.user), pk=employee_id)
        month = (request.query_params.get('month') or '').strip()
        if not month:
            from django.utils import timezone

            month = timezone.localdate().strftime('%Y-%m')

        resolved = resolve_compensation(employee, month)
        if resolved is None:
            return Response({
                'employee': str(employee.id),
                'employee_name': employee.name,
                'employee_code': employee.employee_id,
                'month': month,
                'compensation': None,
            })

        return Response({
            'employee': str(employee.id),
            'employee_name': employee.name,
            'employee_code': employee.employee_id,
            'month': month,
            'source': {
                'compensation_level_id': (
                    str(resolved.source_compensation_level.id)
                    if resolved.source_compensation_level
                    else None
                ),
                'compensation_assignment_id': (
                    str(resolved.source_compensation_assignment.id)
                    if resolved.source_compensation_assignment
                    else None
                ),
                'compensation_override_id': (
                    str(resolved.source_compensation_override.id)
                    if resolved.source_compensation_override
                    else None
                ),
                'department_override_id': (
                    str(resolved.source_department_override.id)
                    if resolved.source_department_override
                    else None
                ),
                'used_legacy_fallback': resolved.used_legacy_fallback,
            },
            'compensation': {
                'basic_salary': str(resolved.basic_salary),
                'hra': str(resolved.hra),
                'allowances': resolved.allowances or {},
                'deductions': resolved.deductions or {},
                'overtime_rate': str(resolved.overtime_rate),
            },
        })


class PayrollGenerateView(APIView):
    """POST /api/payroll/run/ — trigger monthly payroll generation (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def post(self, request):
        serializer = PayrollGenerateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        month = serializer.validated_data['month']
        from apps.hr.attendance_finalization_service import (
            AttendanceFinalizationError,
            finalize_attendance_month,
            is_attendance_month_finalized,
        )
        from apps.hr.hospital_context import resolve_hr_hospital
        from apps.hr.payroll_calculator import PayrollCalculatorError, generate_monthly_payroll

        hospital = resolve_hr_hospital(request)
        if hospital is None:
            return Response(
                {'error': 'Hospital scope could not be resolved.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        attendance_auto_finalized = False
        attendance_finalization = None
        if not is_attendance_month_finalized(hospital, month):
            try:
                _record, report = finalize_attendance_month(
                    hospital=hospital,
                    month=month,
                    finalized_by=request.user,
                )
            except AttendanceFinalizationError as exc:
                return Response(
                    {'error': exc.message, 'code': exc.code},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            attendance_auto_finalized = True
            attendance_finalization = {
                'rows_finalized': report.rows_finalized,
                'employees_touched': report.employees_touched,
                'warnings': report.warnings,
            }

        employees = _scoped_employees(request.user).filter(status='active').order_by('employee_id')
        try:
            result = generate_monthly_payroll(
                month,
                calculated_by=request.user,
                employee_queryset=employees,
            )
        except PayrollCalculatorError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        response_body = {
            'month': result.month,
            'attendance_auto_finalized': attendance_auto_finalized,
            'created_count': len(result.created),
            'recalculated_count': len(result.recalculated),
            'created': PayrollRunSerializer(
                result.created,
                many=True,
                context={'request': request},
            ).data,
            'recalculated': PayrollRunSerializer(
                result.recalculated,
                many=True,
                context={'request': request},
            ).data,
            'skipped': result.skipped,
            'errors': result.errors,
        }
        if attendance_finalization is not None:
            response_body['attendance_finalization'] = attendance_finalization

        return Response(
            response_body,
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class PayrollRunListView(APIView):
    """GET /api/payroll/runs/ — list payroll runs (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request):
        qs = _scoped_payroll_runs(request.user)
        month = (request.query_params.get('month') or '').strip()
        run_status = (request.query_params.get('status') or '').strip().upper()
        employee_id = (request.query_params.get('employee') or '').strip()
        job_opening = (request.query_params.get('job_opening') or '').strip()
        if month:
            qs = qs.filter(month=month)
        if run_status:
            qs = qs.filter(status=run_status)
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if job_opening:
            qs = qs.filter(employee__candidate__job_opening_id=job_opening)
        qs = qs.order_by('-month', '-created_at')
        return Response({
            'results': PayrollRunSerializer(qs, many=True, context={'request': request}).data,
        })


class PayrollRunDetailView(APIView):
    """GET /api/payroll/run/{id}/ — payroll run details (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def get(self, request, pk):
        payroll_run = _get_scoped_payroll_run(request.user, pk)
        return Response(PayrollRunSerializer(payroll_run, context={'request': request}).data)


class PayrollRunApproveView(APIView):
    """POST /api/payroll/run/{id}/approve/ — approve payroll (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def post(self, request, pk):
        from apps.hr.payroll_approval import (
            PayrollApprovalService,
            PayrollStateError,
            PayrollValidationError,
        )
        from apps.hr.payroll_models import PayrollRun

        payroll_run = _get_scoped_payroll_run(request.user, pk)
        service = PayrollApprovalService()
        try:
            if payroll_run.status in {PayrollRun.STATUS_DRAFT, PayrollRun.STATUS_CALCULATED}:
                payroll_run = service.submit_for_review(payroll_run, performed_by=request.user)
            payroll_run = service.approve_payroll(payroll_run, hr_user=request.user)
        except PayrollValidationError as exc:
            return Response({
                'error': str(exc),
                'validation_errors': exc.errors,
                'validation_warnings': exc.warnings,
            }, status=status.HTTP_400_BAD_REQUEST)
        except PayrollStateError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PayrollRunSerializer(payroll_run, context={'request': request}).data)


class PayrollRunLockView(APIView):
    """POST /api/payroll/run/{id}/lock/ — lock payroll (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def post(self, request, pk):
        from apps.hr.payroll_approval import PayrollApprovalService, PayrollStateError

        payroll_run = _get_scoped_payroll_run(request.user, pk)
        try:
            payroll_run = PayrollApprovalService().lock_payroll(
                payroll_run,
                performed_by=request.user,
            )
        except PayrollStateError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PayrollRunSerializer(payroll_run, context={'request': request}).data)


class PayrollRunRecalculateView(APIView):
    """POST /api/payroll/run/{id}/recalculate/ — refresh totals from current attendance (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def post(self, request, pk):
        from apps.hr.payroll_approval import PayrollApprovalError, PayrollApprovalService, PayrollStateError

        payroll_run = _get_scoped_payroll_run(request.user, pk)
        try:
            payroll_run = PayrollApprovalService().recalculate(payroll_run, performed_by=request.user)
        except PayrollStateError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except PayrollApprovalError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PayrollRunSerializer(payroll_run, context={'request': request}).data)


class PayrollRunPublishView(APIView):
    """POST /api/payroll/run/{id}/publish/ — publish locked payroll to employee portal (HR only)."""

    permission_classes = [permissions.IsAuthenticated, IsHRStaffUser]

    def post(self, request, pk):
        from apps.hr.payroll_approval import PayrollApprovalError, PayrollApprovalService, PayrollStateError

        payroll_run = _get_scoped_payroll_run(request.user, pk)
        try:
            payroll_run = PayrollApprovalService().publish_payroll(payroll_run, performed_by=request.user)
        except PayrollStateError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except PayrollApprovalError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PayrollRunSerializer(payroll_run, context={'request': request}).data)


class PayrollPayslipListView(APIView):
    """GET /api/payroll/payslips/ — employee's own published payslips."""

    permission_classes = [permissions.IsAuthenticated, IsEmployeePortalUser]

    def get(self, request):
        from apps.hr.employee_portal import get_employee_for_request
        from apps.hr.payslip_portal import published_payslips_for_employee
        from rest_framework.exceptions import NotFound, PermissionDenied

        try:
            employee = get_employee_for_request(request, require_active=True)
        except NotFound as exc:
            return Response({'error': str(exc.detail)}, status=status.HTTP_404_NOT_FOUND)
        except PermissionDenied as exc:
            return Response({'error': str(exc.detail)}, status=status.HTTP_403_FORBIDDEN)

        month = (request.query_params.get('month') or '').strip()
        qs = published_payslips_for_employee(employee, month=month or None)

        return Response({
            'results': PayslipSerializer(qs, many=True, context={'request': request}).data,
        })
