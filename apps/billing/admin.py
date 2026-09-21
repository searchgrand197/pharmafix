from django.contrib import admin
from django.db.models import Q

from apps.billing.admin_delete import hard_delete_invoice
from apps.payments.models import PaymentTransaction, RefundLog

from .models import (
    BillingInvoice,
    DailyClosingSummary,
    IPDAdvanceInvoice,
    IPDFinalBill,
    IPDFinalBillItem,
    IPDFinalBillSequence,
    IPDRefundInvoice,
    IPDRoomInvoice,
    IPDServiceInvoice,
    InvoiceItem,
    InvoiceNumberSequence,
    OPDBillingInvoice,
    OtherBillingInvoice,
)


@admin.register(InvoiceNumberSequence)
class InvoiceNumberSequenceAdmin(admin.ModelAdmin):
    list_display = ("id", "hospital", "year", "last_seq", "created_at", "updated_at")


@admin.register(IPDFinalBillSequence)
class IPDFinalBillSequenceAdmin(admin.ModelAdmin):
    list_display = ("id", "hospital", "year", "last_seq", "created_at", "updated_at")
    list_filter = ("hospital", "year")
    search_fields = ("hospital__name",)


class InvoiceItemInline(admin.TabularInline):
    model = InvoiceItem
    extra = 0
    fields = ("description", "category", "subcategory", "quantity", "unit_price", "line_total")


def _is_payment_or_refund_related(obj) -> bool:
    if isinstance(obj, (PaymentTransaction, RefundLog)):
        return True
    model = getattr(obj, "_meta", None)
    if model is None:
        return False
    return f"{model.app_label}.{model.model_name}" in {
        "payments.paymenttransaction",
        "payments.refundlog",
    }


class BillingInvoiceHardDeleteMixin:
    """Hard-delete invoices + related payments so PROTECT FKs do not block removal."""

    def get_deleted_objects(self, objs, request):
        from django.contrib.admin.utils import NestedObjects
        from django.db import router

        deleted_objects, model_count, perms_needed, protected = super().get_deleted_objects(objs, request)
        if not protected:
            return deleted_objects, model_count, perms_needed, protected

        # Django formats protected rows as strings; re-collect to inspect real instances.
        obj_list = list(objs)
        collector = NestedObjects(using=router.db_for_write(obj_list[0].__class__))
        collector.collect(obj_list)
        remaining = [obj for obj in collector.protected if not _is_payment_or_refund_related(obj)]
        if remaining:
            return deleted_objects, model_count, perms_needed, protected
        # Payments/refunds are removed in delete_model via hard_delete_invoice.
        return deleted_objects, model_count, perms_needed, []

    def delete_model(self, request, obj):
        hard_delete_invoice(obj)

    def delete_queryset(self, request, queryset):
        for obj in queryset:
            hard_delete_invoice(obj)


class BaseBillingInvoiceAdmin(BillingInvoiceHardDeleteMixin, admin.ModelAdmin):
    inlines = [InvoiceItemInline]
    list_display = (
        "invoice_no",
        "patient",
        "encounter_type",
        "status",
        "total_amount",
        "amount_paid",
        "hospital",
        "invoice_date",
        "is_deleted",
        "voided",
    )
    list_filter = ("hospital", "status", "encounter_type", "is_deleted", "voided", "invoice_date")
    search_fields = ("invoice_no", "patient__uhid", "patient__first_name", "patient__last_name", "patient__phone", "id")
    readonly_fields = ("id",)
    date_hierarchy = "invoice_date"
    ordering = ("-invoice_date", "-created_at")


# Keep a full list for search across every bill type.
@admin.register(BillingInvoice)
class BillingInvoiceAdmin(BaseBillingInvoiceAdmin):
    pass


@admin.register(IPDAdvanceInvoice)
class IPDAdvanceInvoiceAdmin(BaseBillingInvoiceAdmin):
    def get_queryset(self, request):
        return super().get_queryset(request).filter(invoice_no__startswith="IPDADV-")


@admin.register(IPDServiceInvoice)
class IPDServiceInvoiceAdmin(BaseBillingInvoiceAdmin):
    def get_queryset(self, request):
        return super().get_queryset(request).filter(invoice_no__startswith="IPDSRV-")


@admin.register(IPDRoomInvoice)
class IPDRoomInvoiceAdmin(BaseBillingInvoiceAdmin):
    def get_queryset(self, request):
        return super().get_queryset(request).filter(invoice_no__startswith="IPDROOM-")


@admin.register(IPDRefundInvoice)
class IPDRefundInvoiceAdmin(BaseBillingInvoiceAdmin):
    def get_queryset(self, request):
        return super().get_queryset(request).filter(
            Q(invoice_no__startswith="IPDREF-") | Q(invoice_no__icontains="IPDREF")
        )


@admin.register(OPDBillingInvoice)
class OPDBillingInvoiceAdmin(BaseBillingInvoiceAdmin):
    def get_queryset(self, request):
        return super().get_queryset(request).filter(encounter_type=BillingInvoice.EncounterType.OPD)


@admin.register(OtherBillingInvoice)
class OtherBillingInvoiceAdmin(BaseBillingInvoiceAdmin):
    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .exclude(invoice_no__startswith="IPDADV-")
            .exclude(invoice_no__startswith="IPDSRV-")
            .exclude(invoice_no__startswith="IPDROOM-")
            .exclude(invoice_no__startswith="IPDREF-")
            .exclude(invoice_no__icontains="IPDREF")
            .exclude(encounter_type=BillingInvoice.EncounterType.OPD)
        )


@admin.register(InvoiceItem)
class InvoiceItemAdmin(admin.ModelAdmin):
    list_display = ("id", "invoice", "description", "line_total")
    search_fields = ("invoice__invoice_no", "description")


@admin.register(IPDFinalBillItem)
class IPDFinalBillItemAdmin(admin.ModelAdmin):
    list_display = ("id", "final_bill", "description", "amount")
    search_fields = ("final_bill__bill_no", "description")


class IPDFinalBillItemInline(admin.TabularInline):
    model = IPDFinalBillItem
    extra = 0
    fields = ("description", "category", "quantity", "rate", "amount")


@admin.register(IPDFinalBill)
class IPDFinalBillAdmin(admin.ModelAdmin):
    inlines = [IPDFinalBillItemInline]
    list_display = ("bill_no", "patient_name", "hospital", "admission", "net_amount", "amount_paid", "due_amount", "created_at")
    list_filter = ("hospital", "created_at")
    search_fields = ("bill_no", "patient_name", "patient_phone", "admission__ipd_no")
    readonly_fields = ("admission", "hospital", "patient")
    fieldsets = (
        (None, {
            "fields": (
                "admission", "hospital", "patient", "bill_no",
                "patient_name", "guardian_name", "patient_phone", "patient_address",
                "consultant_name", "room_bed", "scheme_name",
                "admission_date", "discharge_date",
                "gross_amount", "discount_amount", "net_amount", "amount_paid", "due_amount",
                "notes",
            ),
        }),
        ("Timestamps", {
            "fields": ("created_at", "updated_at"),
            "description": "Created and updated date/time are editable here.",
        }),
    )

    def save_model(self, request, obj, form, change):
        # TimeStampedModel.save() always overwrites updated_at; persist both
        # timestamp fields via QuerySet.update after the normal save.
        created_at = form.cleaned_data.get("created_at")
        updated_at = form.cleaned_data.get("updated_at")
        super().save_model(request, obj, form, change)
        updates = {}
        if created_at is not None:
            updates["created_at"] = created_at
        if updated_at is not None:
            updates["updated_at"] = updated_at
        if updates:
            type(obj).objects.filter(pk=obj.pk).update(**updates)
            for key, value in updates.items():
                setattr(obj, key, value)


@admin.register(DailyClosingSummary)
class DailyClosingSummaryAdmin(admin.ModelAdmin):
    list_display = ("id", "hospital", "closing_date", "total_collected", "total_outstanding")
