from django.contrib import admin

from apps.billing.admin_delete import hard_delete_payment

from .models import CashHandover, PaymentQuickService, PaymentSlipSequence, PaymentTransaction, RefundLog


@admin.register(PaymentSlipSequence)
class PaymentSlipSequenceAdmin(admin.ModelAdmin):
    list_display = ("id", "hospital", "year", "last_seq", "created_at", "updated_at")


def _is_refund_related(obj) -> bool:
    if isinstance(obj, RefundLog):
        return True
    model = getattr(obj, "_meta", None)
    return bool(model and f"{model.app_label}.{model.model_name}" == "payments.refundlog")


class PaymentHardDeleteMixin:
    """Hard-delete payment rows so soft-deleted payments do not block invoice removal."""

    def get_deleted_objects(self, objs, request):
        from django.contrib.admin.utils import NestedObjects
        from django.db import router

        deleted_objects, model_count, perms_needed, protected = super().get_deleted_objects(objs, request)
        if not protected:
            return deleted_objects, model_count, perms_needed, protected

        obj_list = list(objs)
        collector = NestedObjects(using=router.db_for_write(obj_list[0].__class__))
        collector.collect(obj_list)
        remaining = [obj for obj in collector.protected if not _is_refund_related(obj)]
        if remaining:
            return deleted_objects, model_count, perms_needed, protected
        return deleted_objects, model_count, perms_needed, []

    def delete_model(self, request, obj):
        hard_delete_payment(obj)

    def delete_queryset(self, request, queryset):
        for obj in queryset:
            hard_delete_payment(obj)


@admin.register(PaymentTransaction)
class PaymentTransactionAdmin(PaymentHardDeleteMixin, admin.ModelAdmin):
    list_display = (
        "slip_number",
        "invoice",
        "amount",
        "payment_mode",
        "status",
        "hospital",
        "paid_at",
        "is_deleted",
        "voided",
    )
    list_filter = ("hospital", "status", "payment_mode", "is_deleted", "voided", "paid_at")
    search_fields = (
        "slip_number",
        "receipt_no",
        "transaction_reference",
        "invoice__invoice_no",
        "id",
    )
    date_hierarchy = "paid_at"
    ordering = ("-paid_at", "-created_at")


@admin.register(RefundLog)
class RefundLogAdmin(admin.ModelAdmin):
    list_display = ("id", "invoice", "amount", "hospital", "refunded_at")


@admin.register(CashHandover)
class CashHandoverAdmin(admin.ModelAdmin):
    list_display = ("id", "hospital", "from_user", "to_user", "status", "created_at")
    list_filter = ("hospital", "status")


@admin.register(PaymentQuickService)
class PaymentQuickServiceAdmin(admin.ModelAdmin):
    list_display = ("id", "hospital", "label", "price", "is_active", "sort_order")
