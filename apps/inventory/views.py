from __future__ import annotations

import re
from decimal import Decimal

from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from django.db import transaction

from apps.auditlogs.services import create_audit_log
from apps.inventory.models import Medicine, MedicineBatch, MedicineCategory, StockLedger, Unit
from apps.pharmacy.models import PharmacyOutletSettings
from apps.inventory.serializers import (
    MedicineBatchCreateUpdateSerializer,
    MedicineBatchRatesUpdateSerializer,
    MedicineBatchSerializer,
    MedicineCategoryCreateUpdateSerializer,
    MedicineCategorySerializer,
    MedicineCreateUpdateSerializer,
    MedicineSerializer,
    StockLedgerCreateSerializer,
    StockLedgerSerializer,
    UnitCreateUpdateSerializer,
    UnitSerializer,
)
from apps.inventory.services.stock_service import get_batch_available_qty
from apps.roles_permissions.permissions import HasRequiredPermission
from apps.shared.pagination import LargeLimitOffsetPagination
from apps.shared.response import success_response
def _resolve_request_pharmacy(request):
    """Resolve active pharmacy branch strictly from middleware context."""
    pharmacy = getattr(request, "pharmacy", None)
    if pharmacy is not None:
        return pharmacy
    return None


def _tablets_per_strip_from_pack_info(pack_info: str) -> int | None:
    """e.g. '1x10' or '1 x 10' → 10 tablets per strip (uses the number after x)."""
    if not pack_info or not str(pack_info).strip():
        return None
    m = re.match(r"^\s*(\d+)\s*[x×]\s*(\d+)\s*$", str(pack_info).strip(), re.I)
    if not m:
        return None
    return int(m.group(2))


def _medicine_pack_size(medicine: Medicine) -> int:
    """Base units per retail pack (strip/box); user-defined via unit_conversions JSON."""
    conv = medicine.unit_conversions or {}
    for key in ("strip", "STRIP", "box", "BOX", "carton", "CARTON"):
        v = conv.get(key)
        if v is not None:
            try:
                n = int(float(v))
                if n > 0:
                    return n
            except (TypeError, ValueError):
                continue
    t = _tablets_per_strip_from_pack_info(medicine.pack_info or "")
    return t if t and t > 0 else 1


def _expiry_status(expiry_date):
    """Return (status, days_to_expiry) where status is expired|expiring|ok."""
    if not expiry_date:
        return "ok", None
    today = timezone.now().date()
    if expiry_date < today:
        return "expired", (expiry_date - today).days
    days = (expiry_date - today).days
    if days <= 60:
        return "expiring", days
    return "ok", days


class PharmacyScopedMixin:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if _resolve_request_pharmacy(request) is None:
            raise ValidationError({"detail": ["Pharmacy branch context required."]})

    def get_queryset(self):
        qs = super().get_queryset()
        pharmacy = _resolve_request_pharmacy(self.request)
        pid = getattr(pharmacy, "id", None)
        if pid:
            return qs.filter(pharmacy_id=pid)
        return qs.none()


class UnitViewSet(PharmacyScopedMixin, viewsets.ModelViewSet):
    queryset = Unit.objects.all()
    filter_backends = (DjangoFilterBackend, SearchFilter)
    search_fields = ("code", "name")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]

    required_permission_map = {
        "list": "inventory.view_unit",
        "retrieve": "inventory.view_unit",
        "create": "inventory.create_unit",
        "update": "inventory.update_unit",
        "partial_update": "inventory.update_unit",
        "destroy": "inventory.delete_unit",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return UnitSerializer
        return UnitCreateUpdateSerializer

    def get_required_permission(self):
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def perform_create(self, serializer):
        pharmacy = _resolve_request_pharmacy(self.request)
        if pharmacy is None:
            raise ValidationError({"detail": ["Pharmacy branch context required."]})
        unit = serializer.save(pharmacy_id=pharmacy.id)
        create_audit_log(
            request=self.request,
            hospital=unit.pharmacy.hospital,
            module="inventory",
            action="create_unit",
            obj=unit,
            after={"code": unit.code, "name": unit.name},
        )


class MedicineCategoryViewSet(PharmacyScopedMixin, viewsets.ModelViewSet):
    queryset = MedicineCategory.objects.all().order_by("name")
    pagination_class = LargeLimitOffsetPagination
    filter_backends = (DjangoFilterBackend, SearchFilter)
    search_fields = ("name",)
    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]
    required_permission_map = {
        "list": "inventory.view_medicine",
        "retrieve": "inventory.view_medicine",
        "create": "inventory.create_medicine",
        "update": "inventory.update_medicine",
        "partial_update": "inventory.update_medicine",
        "destroy": "inventory.delete_medicine",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return MedicineCategorySerializer
        return MedicineCategoryCreateUpdateSerializer

    def get_required_permission(self):
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def perform_create(self, serializer):
        pharmacy = _resolve_request_pharmacy(self.request)
        if pharmacy is None:
            raise ValidationError({"detail": ["Pharmacy branch context required."]})
        serializer.save(pharmacy_id=pharmacy.id)


class MedicineViewSet(PharmacyScopedMixin, viewsets.ModelViewSet):
    queryset = Medicine.objects.all().select_related("unit")
    pagination_class = LargeLimitOffsetPagination
    filter_backends = (DjangoFilterBackend, SearchFilter)
    search_fields = ("sku", "name", "name_on_bill")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]

    required_permission_map = {
        "list": "inventory.view_medicine",
        "retrieve": "inventory.view_medicine",
        "search": "inventory.view_medicine",
        "create": "inventory.create_medicine",
        "update": "inventory.update_medicine",
        "partial_update": "inventory.update_medicine",
        "destroy": "inventory.delete_medicine",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return MedicineSerializer
        return MedicineCreateUpdateSerializer

    def get_required_permission(self):
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        # Medicine/category screens should only show active medicines.
        if getattr(self, "action", None) in {"list", "retrieve", "search"}:
            return qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        pharmacy = _resolve_request_pharmacy(self.request)
        if pharmacy is None:
            raise ValidationError({"detail": ["Pharmacy branch context required."]})
        pharmacy_id = pharmacy.id
        unit = serializer.validated_data.get("unit")
        if unit is None:
            unit, _ = Unit.objects.get_or_create(
                pharmacy_id=pharmacy_id,
                code="TAB",
                defaults={"name": "Tablet", "is_active": True},
            )
            medicine = serializer.save(pharmacy_id=pharmacy_id, unit=unit)
        else:
            medicine = serializer.save(pharmacy_id=pharmacy_id)

        per_strip = _tablets_per_strip_from_pack_info(medicine.pack_info or "")
        conv = medicine.unit_conversions or {}
        if per_strip and per_strip > 0 and not conv.get("strip"):
            conv = {**conv, "strip": float(per_strip)}
            medicine.unit_conversions = conv
            medicine.save(update_fields=["unit_conversions", "updated_at"])

        create_audit_log(
            request=self.request,
            hospital=medicine.pharmacy.hospital,
            module="inventory",
            action="create_medicine",
            obj=medicine,
            after={"sku": medicine.sku, "name": medicine.name},
        )

    @action(detail=False, methods=["get"], url_path="search")
    def search(self, request):
        """
        Pharmacy billing: flat medicine+batch suggestions (Marg-style).
        GET /api/v1/medicines/search/?q=para
        """
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return success_response([])
        # Allow cross-branch search if pharmacy branch header is set
        pharmacy = _resolve_request_pharmacy(request)
        pid = getattr(pharmacy, "id", None)
        if not pid:
            return Response({"success": False, "detail": "Pharmacy context required."}, status=400)

        med_qs = (
            Medicine.objects.filter(pharmacy_id=pid, is_active=True)
            .filter(Q(name__icontains=q) | Q(name_on_bill__icontains=q) | Q(sku__icontains=q))
            .select_related("unit", "category")
            .order_by("name")[:25]
        )

        out = []
        for med in med_qs:
            pack_size = _medicine_pack_size(med)
            batches = (
                MedicineBatch.objects.filter(medicine_id=med.id, pharmacy_id=pid)
                .order_by("expiry_date", "batch_no")
            )
            for b in batches:
                stock = float(get_batch_available_qty(b))
                st, days = _expiry_status(b.expiry_date)
                out.append(
                    {
                        "medicine": {
                            "id": str(med.id),
                            "name": med.name,
                            "name_on_bill": (med.name_on_bill or "").strip(),
                            "sku": med.sku,
                            "pack_info": med.pack_info or "",
                            "hsn_code": med.hsn_code or "",
                            "gst_percent": str(med.gst_percent),
                            "unit_conversions": med.unit_conversions or {},
                            "unit_name": med.unit.name if med.unit_id else "",
                            "pack_size": pack_size,
                            "category": str(med.category_id) if med.category_id else None,
                            "form": med.form or "",
                        },
                        "batch": {
                            "id": str(b.id),
                            "batch_no": b.batch_no,
                            "expiry_date": b.expiry_date.isoformat() if b.expiry_date else None,
                            "mrp": str(b.mrp),
                            "unit_cost": str(b.unit_cost),
                            "sale_rate": str(b.sale_rate),
                            "stock": stock,
                            "is_sale_blocked": bool(b.is_sale_blocked),
                            "sale_block_reason": b.sale_block_reason or "",
                        },
                        "expiry_status": st,
                        "days_to_expiry": days,
                        "sellable": stock > 0 and not b.is_sale_blocked,
                    }
                )

        def sort_key(row):
            st = row["expiry_status"]
            prio = 0 if st == "ok" else 1 if st == "expiring" else 2
            exp = row["batch"]["expiry_date"] or "9999-12-31"
            return (prio, exp, row["medicine"]["name"], row["batch"]["batch_no"])

        # Sellable batches first (FEFO); out-of-stock / blocked ones are capped separately
        # so they never crowd sellable batches out of the response.
        sellable = sorted((r for r in out if r["sellable"]), key=sort_key)
        hidden = sorted((r for r in out if not r["sellable"]), key=sort_key)
        return success_response(sellable[:80] + hidden[:40])

    @action(detail=False, methods=["get"], url_path="low-stock")
    def low_stock(self, request):
        """
        Returns medicines whose total stock (sum across all batches) is below the
        pharmacy's low_stock_threshold setting.
        GET /api/v1/medicines/low-stock/
        """
        pharmacy = _resolve_request_pharmacy(request)
        pid = getattr(pharmacy, "id", None)
        if not pid:
            return Response({"success": False, "detail": "Pharmacy context required."}, status=400)

        # Resolve threshold from settings (default 10)
        threshold = 10
        try:
            settings_obj = PharmacyOutletSettings.objects.get(pharmacy_id=pid)
            threshold = int(settings_obj.b2c_low_stock_threshold)
        except (PharmacyOutletSettings.DoesNotExist, TypeError, ValueError):
            pass

        medicines = (
            Medicine.objects.filter(pharmacy_id=pid, is_active=True)
            .select_related("unit")
            .order_by("name")
        )

        out = []
        for med in medicines:
            batches = MedicineBatch.objects.filter(medicine_id=med.id, pharmacy_id=pid)
            total_stock = sum(float(get_batch_available_qty(b)) for b in batches)
            if total_stock < threshold:
                batch_list = []
                for b in batches:
                    qty = float(get_batch_available_qty(b))
                    st, days = _expiry_status(b.expiry_date)
                    batch_list.append({
                        "id": str(b.id),
                        "batch_no": b.batch_no,
                        "expiry_date": b.expiry_date.isoformat() if b.expiry_date else None,
                        "mrp": str(b.mrp),
                        "sale_rate": str(b.sale_rate),
                        "quantity": qty,
                        "expiry_status": st,
                        "days_to_expiry": days,
                    })
                out.append({
                    "id": str(med.id),
                    "name": med.name,
                    "sku": med.sku or "",
                    "pack_info": med.pack_info or "",
                    "unit_name": med.unit.name if med.unit_id else "",
                    "total_stock": total_stock,
                    "threshold": threshold,
                    "batches": batch_list,
                })

        return success_response(out)


class MedicineBatchViewSet(PharmacyScopedMixin, viewsets.ModelViewSet):
    queryset = MedicineBatch.objects.all().select_related("medicine", "medicine__unit")
    pagination_class = LargeLimitOffsetPagination
    filter_backends = (DjangoFilterBackend, SearchFilter)
    search_fields = ("batch_no", "medicine__name")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]

    required_permission_map = {
        "list": "inventory.view_batch",
        "retrieve": "inventory.view_batch",
        "create": "inventory.create_batch",
        "update": "inventory.update_batch",
        "partial_update": "inventory.update_batch",
        "destroy": "inventory.delete_batch",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return MedicineBatchSerializer
        if self.action in {"update", "partial_update"}:
            return MedicineBatchRatesUpdateSerializer
        return MedicineBatchCreateUpdateSerializer

    def get_required_permission(self):
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def perform_create(self, serializer):
        pharmacy = _resolve_request_pharmacy(self.request)
        if pharmacy is None:
            raise ValidationError({"detail": ["Pharmacy branch context required."]})
        batch = serializer.save(pharmacy_id=pharmacy.id)
        create_audit_log(
            request=self.request,
            hospital=batch.pharmacy.hospital,
            module="inventory",
            action="create_batch",
            obj=batch,
            after={"batch_no": batch.batch_no, "expiry_date": str(batch.expiry_date)},
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        was_blocked = bool(instance.is_sale_blocked)
        before_reason = instance.sale_block_reason
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        refreshed = self.get_queryset().get(pk=instance.pk)
        if bool(refreshed.is_sale_blocked) != was_blocked:
            create_audit_log(
                request=request,
                hospital=refreshed.pharmacy.hospital,
                module="inventory",
                action="block_batch_sale" if refreshed.is_sale_blocked else "unblock_batch_sale",
                obj=refreshed,
                before={"is_sale_blocked": was_blocked, "sale_block_reason": before_reason},
                after={
                    "batch_no": refreshed.batch_no,
                    "is_sale_blocked": refreshed.is_sale_blocked,
                    "sale_block_reason": refreshed.sale_block_reason,
                },
            )
        return Response(MedicineBatchSerializer(refreshed, context={"request": request}).data)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        from apps.pharmacy.models import PharmacyInvoiceItem, PharmacyPurchaseChallanLine

        from apps.pharmacy.margin_utils import batch_unit_cost_for_snapshot

        instance = self.get_object()
        bn = instance.batch_no
        exp = instance.expiry_date
        unit_cost = batch_unit_cost_for_snapshot(instance)
        PharmacyInvoiceItem.objects.filter(batch_id=instance.id).update(
            snapshot_batch_no=bn,
            snapshot_expiry_date=exp,
            snapshot_unit_cost=unit_cost,
            batch_id=None,
        )
        PharmacyPurchaseChallanLine.objects.filter(batch_id=instance.id).update(
            snapshot_batch_no=bn,
            snapshot_expiry_date=exp,
            batch_id=None,
        )
        create_audit_log(
            request=request,
            hospital=instance.pharmacy.hospital,
            module="inventory",
            action="delete_batch",
            obj=instance,
            before={
                "batch_no": instance.batch_no,
                "expiry_date": str(instance.expiry_date) if instance.expiry_date else "",
                "medicine_id": str(instance.medicine_id),
            },
        )
        StockLedger.objects.filter(batch_id=instance.id).delete()
        return super().destroy(request, *args, **kwargs)


class StockLedgerViewSet(PharmacyScopedMixin, viewsets.ModelViewSet):
    queryset = StockLedger.objects.all().select_related("medicine", "batch", "pharmacy").order_by("-created_at")
    filter_backends = (DjangoFilterBackend, SearchFilter)
    filterset_fields = ("batch", "medicine", "reason", "reference_type")
    search_fields = ("medicine__name", "batch__batch_no", "reference_type", "reference_id")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]

    http_method_names = ["get", "post"]

    required_permission_map = {
        "list": "inventory.view_stock_ledger",
        "retrieve": "inventory.view_stock_ledger",
        "create": "inventory.create_stock_ledger",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve"}:
            return StockLedgerSerializer
        return StockLedgerCreateSerializer

    def get_required_permission(self):
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    @transaction.atomic
    def perform_create(self, serializer):
        data = serializer.validated_data
        medicine_batch = MedicineBatch.objects.select_related("medicine", "pharmacy__hospital").get(pk=data["batch"])
        request_pharmacy = _resolve_request_pharmacy(self.request)
        if request_pharmacy is None:
            raise ValidationError({"detail": ["Pharmacy branch context required."]})
        if str(medicine_batch.pharmacy_id) != str(request_pharmacy.id):
            raise ValidationError({"batch": ["Batch does not belong to selected pharmacy branch."]})
        pharmacy = medicine_batch.pharmacy

        med_id = data["medicine"]
        if str(med_id) != str(medicine_batch.medicine_id):
            raise ValidationError({"medicine": ["Medicine must match the selected batch."]})

        qty_change = Decimal(data["qty_change"])
        reason = data["reason"]
        if reason in {StockLedger.Reason.STOCK_IN, StockLedger.Reason.RETURN_IN} and qty_change <= 0:
            raise ValidationError({"qty_change": ["Must be greater than zero for stock in / return."]})
        if reason == StockLedger.Reason.DISPENSE_OUT and qty_change >= 0:
            raise ValidationError({"qty_change": ["Must be negative for dispense out."]})

        ref_type = (data.get("reference_type") or "").strip()
        ref_id = (data.get("reference_id") or "").strip()
        allow_negative = bool(data.get("allow_negative_stock", False))

        if reason == StockLedger.Reason.ADJUST:
            if qty_change == 0:
                raise ValidationError({"qty_change": ["Adjustment quantity cannot be zero."]})
            if not ref_id:
                raise ValidationError({"reference_id": ["Reason is required for stock adjustments."]})
            available = get_batch_available_qty(medicine_batch)
            projected = available + qty_change
            if projected < 0 and not allow_negative:
                raise ValidationError(
                    {
                        "qty_change": [
                            f"Resulting stock would be negative ({projected}). Enable allow_negative_stock or reduce the adjustment."
                        ]
                    }
                )
            if not ref_type:
                ref_type = "inventory_adjust"

        entry = StockLedger.objects.create(
            pharmacy_id=pharmacy.id,
            medicine_id=med_id,
            batch=medicine_batch,
            qty_change=qty_change,
            reason=reason,
            reference_type=ref_type[:50],
            reference_id=ref_id[:100],
            created_by=self.request.user,
        )

        create_audit_log(
            request=self.request,
            hospital=pharmacy.hospital,
            module="inventory",
            action="create_stock_ledger",
            obj=entry,
            after={"qty_change": str(entry.qty_change), "reason": entry.reason},
        )

        serializer.instance = entry

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(
            StockLedgerSerializer(serializer.instance, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

from django.shortcuts import render

# Create your views here.
