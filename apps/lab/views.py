import uuid

from django.db.models import Count
from django.db.models.deletion import ProtectedError
from django.http import HttpResponse
from rest_framework import viewsets, permissions, generics, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from apps.lab.models import LabTestCategory, LabTest, LabTestParameter, LabReport, LabTestResult, LabSettings
from apps.lab.serializers import (
    LabTestCategorySerializer,
    LabTestSerializer,
    LabTestParameterSerializer,
    LabReportSerializer,
    LabTestResultSerializer,
    LabSettingsSerializer,
)
from apps.lab.template_pack import (
    dumps_pack,
    export_hospital_templates,
    export_tests_queryset,
    import_templates_to_hospital,
    loads_pack,
)
from apps.lab.visit_id import allocate_lab_visit_id
from apps.shared.response import success_response


class LabTestCategoryViewSet(viewsets.ModelViewSet):
    queryset = LabTestCategory.objects.all()
    serializer_class = LabTestCategorySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return super().get_queryset().filter(hospital=self.request.user.hospital)

    def perform_create(self, serializer):
        serializer.save(hospital=self.request.user.hospital)


class LabTestViewSet(viewsets.ModelViewSet):
    queryset = LabTest.objects.prefetch_related("parameters").all()
    serializer_class = LabTestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset().filter(hospital=self.request.user.hospital)
        return qs.annotate(report_usage_count=Count("results__report", distinct=True))

    def perform_create(self, serializer):
        serializer.save(hospital=self.request.user.hospital)

    def _template_in_use_response(self, instance, *, report_count=None):
        count = report_count if report_count is not None else instance.results.values("report").distinct().count()
        report_word = "report" if count == 1 else "reports"
        return Response(
            {
                "success": False,
                "errors": {
                    "detail": (
                        f"This template is used on {count} lab {report_word} and cannot be deleted. "
                        "Mark it inactive to hide it from new registrations while keeping old reports intact."
                    ),
                },
            },
            status=status.HTTP_409_CONFLICT,
        )

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        report_count = getattr(instance, "report_usage_count", None)
        if report_count is None:
            report_count = instance.results.values("report").distinct().count()
        if report_count:
            return self._template_in_use_response(instance, report_count=report_count)
        try:
            self.perform_destroy(instance)
        except ProtectedError:
            return self._template_in_use_response(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def parameters(self, request, pk=None):
        test = self.get_object()
        params = test.parameters.all()
        serializer = LabTestParameterSerializer(params, many=True)
        return success_response(serializer.data)

    @action(detail=False, methods=["get"], url_path="export-pack")
    def export_pack(self, request):
        """Download all lab templates for this hospital as JSON."""
        qs = self.get_queryset()
        ids = request.query_params.get("ids")
        if ids:
            id_list = [x.strip() for x in ids.split(",") if x.strip()]
            qs = qs.filter(id__in=id_list)
        pack = export_tests_queryset(qs)
        pack["source_hospital_name"] = getattr(request.user.hospital, "name", "") or ""
        body = dumps_pack(pack)
        safe = "".join(
            c if c.isalnum() or c in "-_" else "_"
            for c in (pack.get("source_hospital_name") or "lab")
        )[:40]
        response = HttpResponse(body, content_type="application/json; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="lab_templates_{safe}.json"'
        return response

    @action(
        detail=False,
        methods=["post"],
        url_path="import-pack",
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def import_pack(self, request):
        """Import a JSON template pack into this hospital."""
        upload = request.FILES.get("pack_file")
        raw = None
        if upload:
            raw = upload.read()
        elif isinstance(request.data, dict) and request.data.get("pack"):
            import json
            raw = json.dumps(request.data["pack"]).encode("utf-8")
        if not raw:
            return Response(
                {"detail": "Upload a JSON file (pack_file) or send a pack object."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        overwrite = str(request.data.get("overwrite", "true")).lower() not in ("0", "false", "no")
        replace_parameters = str(request.data.get("replace_parameters", "true")).lower() not in ("0", "false", "no")

        try:
            pack = loads_pack(raw)
            stats = import_templates_to_hospital(
                request.user.hospital,
                pack,
                overwrite=overwrite,
                replace_parameters=replace_parameters,
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return success_response(stats)


class LabReportViewSet(viewsets.ModelViewSet):
    queryset = LabReport.objects.select_related("patient", "referred_by").prefetch_related(
        "results__test__category",
        "results__parameter",
        "results__test",
    ).order_by("-created_at")
    serializer_class = LabReportSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return super().get_queryset().filter(hospital=self.request.user.hospital)

    def perform_create(self, serializer):
        lab_no = f"LAB-{uuid.uuid4().hex[:8].upper()}"
        # Read from request (serializer pops test_ids before model create)
        test_ids = self.request.data.get("test_ids") or []
        hospital = self.request.user.hospital

        visit_id = (serializer.validated_data.get("visit_id") or "").strip()
        if not visit_id:
            visit_id = allocate_lab_visit_id(hospital)

        report = serializer.save(
            hospital=hospital,
            created_by=self.request.user,
            lab_no=lab_no,
            visit_id=visit_id,
        )

        # Expand each ordered test into per-parameter results
        for test_id in test_ids:
            try:
                test = LabTest.objects.prefetch_related("parameters").get(
                    id=test_id, hospital=hospital
                )
            except (LabTest.DoesNotExist, ValueError, TypeError):
                continue

            params = list(test.parameters.order_by("sort_order", "name"))
            if params:
                for param in params:
                    LabTestResult.objects.create(report=report, test=test, parameter=param)
            else:
                # Fallback for tests that have no parameters yet
                LabTestResult.objects.create(report=report, test=test)


class LabTestResultViewSet(viewsets.ModelViewSet):
    queryset = LabTestResult.objects.select_related("test__category", "parameter").all()
    serializer_class = LabTestResultSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return super().get_queryset().filter(report__hospital=self.request.user.hospital)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        # Allow updating result_value; flag/is_abnormal are computed in save()
        for field in ("result_value",):
            if field in request.data:
                setattr(instance, field, request.data[field])
        instance.save()
        serializer = self.get_serializer(instance)
        return success_response(serializer.data)


class LabSettingsView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/v1/lab/settings/ — hospital lab letterhead / branding."""

    serializer_class = LabSettingsSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_object(self):
        hospital = self.request.user.hospital
        obj, _ = LabSettings.objects.get_or_create(
            hospital=hospital,
            defaults={"lab_name": getattr(hospital, "name", "") or "Clinical Laboratory"},
        )
        return obj

    def retrieve(self, request, *args, **kwargs):
        ser = self.get_serializer(self.get_object())
        return success_response(ser.data)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        ser = self.get_serializer(instance, data=request.data, partial=partial)
        ser.is_valid(raise_exception=True)
        ser.save()
        return success_response(ser.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)
