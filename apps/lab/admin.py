from django.contrib import admin, messages
from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import render
from django.urls import path, reverse

from apps.shared.models import Hospital
from .models import LabReport, LabTest, LabTestCategory, LabTestParameter, LabTestResult, LabSettings
from .template_pack import (
    dumps_pack,
    export_hospital_templates,
    export_tests_queryset,
    import_templates_to_hospital,
    loads_pack,
)


@admin.register(LabTestCategory)
class LabTestCategoryAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "hospital")
    list_filter = ("hospital",)
    search_fields = ("name",)


class LabTestParameterInline(admin.TabularInline):
    model = LabTestParameter
    extra = 1
    fields = (
        "sort_order", "section_title", "name", "code", "unit",
        "reference_range", "ref_low", "ref_high", "method", "result_type",
    )


@admin.register(LabTest)
class LabTestAdmin(admin.ModelAdmin):
    list_display = (
        "name", "code", "hospital", "category", "is_group_test",
        "sample_type", "department_label", "is_active", "param_count",
    )
    list_filter = ("hospital", "category", "is_group_test", "is_active")
    search_fields = ("name", "code", "department_label")
    inlines = [LabTestParameterInline]
    actions = ("export_selected_as_json",)
    change_list_template = "admin/lab/labtest/change_list.html"

    def param_count(self, obj):
        return obj.parameters.count()
    param_count.short_description = "Params"

    @admin.action(description="Export selected templates as JSON (share pack)")
    def export_selected_as_json(self, request, queryset):
        pack = export_tests_queryset(queryset)
        body = dumps_pack(pack)
        filename = f"lab_templates_{pack['test_count']}_tests.json"
        response = HttpResponse(body, content_type="application/json; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        self.message_user(
            request,
            f"Exported {pack['test_count']} template(s) as JSON.",
            level=messages.SUCCESS,
        )
        return response

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path(
                "export-hospital-json/",
                self.admin_site.admin_view(self.export_hospital_view),
                name="lab_labtest_export_hospital",
            ),
            path(
                "import-json/",
                self.admin_site.admin_view(self.import_json_view),
                name="lab_labtest_import_json",
            ),
        ]
        return custom + urls

    def export_hospital_view(self, request):
        hospitals = Hospital.objects.all().order_by("name")
        if request.method == "POST":
            hospital_id = request.POST.get("hospital_id")
            hospital = Hospital.objects.filter(id=hospital_id).first()
            if not hospital:
                self.message_user(request, "Select a hospital.", level=messages.ERROR)
                return HttpResponseRedirect(request.path)
            pack = export_hospital_templates(hospital)
            body = dumps_pack(pack)
            safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in (hospital.name or "hospital"))[:40]
            filename = f"lab_templates_{safe_name}.json"
            response = HttpResponse(body, content_type="application/json; charset=utf-8")
            response["Content-Disposition"] = f'attachment; filename="{filename}"'
            return response

        context = {
            **self.admin_site.each_context(request),
            "title": "Export lab templates (JSON)",
            "hospitals": hospitals,
            "opts": self.model._meta,
        }
        return render(request, "admin/lab/labtest/export_hospital.html", context)

    def import_json_view(self, request):
        hospitals = Hospital.objects.all().order_by("name")
        if request.method == "POST":
            hospital_id = request.POST.get("hospital_id")
            hospital = Hospital.objects.filter(id=hospital_id).first()
            upload = request.FILES.get("pack_file")
            overwrite = request.POST.get("overwrite") == "on"
            replace_parameters = request.POST.get("replace_parameters") == "on"

            if not hospital:
                self.message_user(request, "Select a target hospital.", level=messages.ERROR)
                return HttpResponseRedirect(request.path)
            if not upload:
                self.message_user(request, "Upload a JSON pack file.", level=messages.ERROR)
                return HttpResponseRedirect(request.path)

            try:
                pack = loads_pack(upload.read())
                stats = import_templates_to_hospital(
                    hospital,
                    pack,
                    overwrite=overwrite,
                    replace_parameters=replace_parameters,
                )
            except Exception as exc:
                self.message_user(request, f"Import failed: {exc}", level=messages.ERROR)
                return HttpResponseRedirect(request.path)

            self.message_user(
                request,
                (
                    f"Imported into {hospital.name}: "
                    f"{stats['created']} created, {stats['updated']} updated, "
                    f"{stats['skipped']} skipped, {stats['parameters_written']} parameters, "
                    f"{stats['categories_created']} categories created."
                ),
                level=messages.SUCCESS,
            )
            return HttpResponseRedirect(reverse("admin:lab_labtest_changelist"))

        context = {
            **self.admin_site.each_context(request),
            "title": "Import lab templates (JSON)",
            "hospitals": hospitals,
            "opts": self.model._meta,
        }
        return render(request, "admin/lab/labtest/import_json.html", context)


@admin.register(LabTestParameter)
class LabTestParameterAdmin(admin.ModelAdmin):
    list_display = ("id", "test", "name", "unit", "reference_range", "sort_order")
    search_fields = ("name", "test__name")
    list_filter = ("test__hospital",)


@admin.register(LabReport)
class LabReportAdmin(admin.ModelAdmin):
    list_display = ("id", "lab_no", "patient", "hospital", "status", "created_at")
    list_filter = ("hospital", "status")
    search_fields = ("lab_no", "id", "visit_id")


@admin.register(LabTestResult)
class LabTestResultAdmin(admin.ModelAdmin):
    list_display = ("id", "report", "test", "parameter", "result_value", "flag", "created_at")


@admin.register(LabSettings)
class LabSettingsAdmin(admin.ModelAdmin):
    list_display = ("id", "hospital", "lab_name", "phone", "watermark_enabled", "updated_at")
    search_fields = ("lab_name",)
    list_filter = ("watermark_enabled", "hospital")
