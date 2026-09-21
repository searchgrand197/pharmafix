from __future__ import annotations

import re
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import Http404
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import NotFound
from rest_framework.filters import OrderingFilter
from rest_framework.response import Response

from apps.auditlogs.services import create_audit_log
from apps.expenses.models import ExpenseLineItem, ExpenseParty, ExpenseQuickCategory, ExpenseQuickService, ExpenseTransaction
from apps.expenses.serializers import (
    ExpenseTransactionCreateSerializer,
    ExpenseTransactionSerializer,
    ExpenseTransactionUpdateSerializer,
    ExpenseVoidSerializer,
)
from apps.roles_permissions.permissions import HasRequiredPermission
from apps.shared.cancel_service import (
    apply_void_if_last,
    is_last_expense_voucher,
    release_expense_voucher_number,
    void_expense_voucher_sequence,
)
from apps.shared.response import success_response


_EXPENSE_SEARCH_LOOKUPS = (
    "paid_to",
    "slip_number",
    "remarks",
)


class ExpenseTransactionFilter(django_filters.FilterSet):
    paid_at__date__gte = django_filters.DateFilter(field_name="paid_at", lookup_expr="date__gte")
    paid_at__date__lte = django_filters.DateFilter(field_name="paid_at", lookup_expr="date__lte")
    payment_mode = django_filters.CharFilter()
    recorded_by = django_filters.UUIDFilter()
    voided = django_filters.BooleanFilter()
    status = django_filters.CharFilter()
    source = django_filters.CharFilter()

    class Meta:
        model = ExpenseTransaction
        fields = []


class ExpenseTransactionViewSet(viewsets.ModelViewSet):
    queryset = (
        ExpenseTransaction.objects.filter(is_deleted=False)
        .select_related("recorded_by", "voided_by")
        .prefetch_related("items")
    )
    filter_backends = (django_filters.DjangoFilterBackend, OrderingFilter)
    filterset_class = ExpenseTransactionFilter
    ordering_fields = ("paid_at", "created_at", "total_amount")
    ordering = ("-paid_at", "-created_at")

    permission_classes = [permissions.IsAuthenticated, HasRequiredPermission]
    http_method_names = ["get", "post", "patch"]

    required_permission_map = {
        "list": "expenses.view_transaction",
        "retrieve": "expenses.view_transaction",
        "create": "expenses.create_transaction",
        "update": "expenses.create_transaction",
        "partial_update": "expenses.create_transaction",
        "void": "expenses.void_transaction",
    }

    def get_serializer_class(self):
        if self.action in {"list", "retrieve", "void"}:
            return ExpenseTransactionSerializer
        if self.action in {"partial_update", "update"}:
            return ExpenseTransactionUpdateSerializer
        return ExpenseTransactionCreateSerializer

    def get_required_permission(self) -> str | None:
        return self.required_permission_map.get(getattr(self, "action", None))

    def get_permissions(self):
        self.required_permission = self.get_required_permission()
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        if not self.request.user.hospital_id:
            return qs.none()
        qs = qs.filter(hospital_id=self.request.user.hospital_id)
        if self.action in {"list"} and "voided" not in self.request.query_params:
            qs = qs.filter(voided=False)
        return qs

    def filter_queryset(self, queryset):
        qs = super().filter_queryset(queryset)
        search = (self.request.query_params.get("search") or "").strip()
        if not search:
            return qs

        terms = [part for part in re.split(r"\s+", search) if part]
        if not terms:
            return qs

        filters = Q()
        for term in terms:
            term_q = Q()
            for lookup in _EXPENSE_SEARCH_LOOKUPS:
                term_q |= Q(**{f"{lookup}__icontains": term})
            filters &= term_q
        return qs.filter(filters).distinct()

    def get_object(self):
        try:
            return super().get_object()
        except Http404 as exc:
            raise NotFound() from exc

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        serializer = ExpenseTransactionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if not request.user.hospital_id:
            return Response(
                {"success": False, "errors": {"hospital": ["User is not linked to a hospital."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        validated = serializer.validated_data
        expense = ExpenseTransaction.objects.create(
            hospital_id=request.user.hospital_id,
            recorded_by_id=request.user.id,
            paid_at=validated["paid_at"],
            paid_to=validated["paid_to"],
            payment_mode=validated["payment_mode"],
            source=validated.get("source") or ExpenseTransaction.Source.COLLECTION,
            remarks=validated.get("remarks") or "",
            subtotal=validated["subtotal"],
            discount_amount=validated["discount_amount"],
            total_amount=validated["total_amount"],
            status=ExpenseTransaction.Status.SUCCESS,
        )

        for item in validated["items"]:
            ExpenseLineItem.objects.create(
                expense=expense,
                description=item["description"],
                category=item.get("category") or "",
                quantity=item["quantity"],
                unit_price=item["unit_price"],
                line_total=item["line_total"],
            )

        create_audit_log(
            request=request,
            hospital=expense.hospital,
            module="expenses",
            action="create_expense",
            obj=expense,
            after={
                "slip_number": expense.slip_number,
                "paid_to": expense.paid_to,
                "total_amount": str(expense.total_amount),
                "payment_mode": expense.payment_mode,
            },
        )

        expense.refresh_from_db()
        return success_response(
            data=ExpenseTransactionSerializer(expense).data,
            status_code=status.HTTP_201_CREATED,
        )

    @transaction.atomic
    def partial_update(self, request, *args, **kwargs):
        expense: ExpenseTransaction = self.get_object()
        if expense.voided or expense.status == ExpenseTransaction.Status.CANCELLED:
            return Response(
                {"success": False, "errors": {"void": ["This expense voucher is already cancelled."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = ExpenseTransactionUpdateSerializer(
            data=request.data,
            partial=True,
            context={"instance": expense},
        )
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        before = {
            "paid_to": expense.paid_to,
            "payment_mode": expense.payment_mode,
            "remarks": expense.remarks,
            "subtotal": str(expense.subtotal),
            "discount_amount": str(expense.discount_amount),
            "total_amount": str(expense.total_amount),
            "paid_at": expense.paid_at.isoformat() if expense.paid_at else None,
        }

        if "paid_at" in validated:
            expense.paid_at = validated["paid_at"]
        if "paid_to" in validated:
            expense.paid_to = validated["paid_to"]
        if "payment_mode" in validated:
            expense.payment_mode = validated["payment_mode"]
        if "source" in validated:
            expense.source = validated["source"]
        if "remarks" in validated:
            expense.remarks = validated["remarks"]

        if "items" in request.data or "discount_amount" in request.data:
            expense.items.all().delete()
            for item in validated["items"]:
                ExpenseLineItem.objects.create(
                    expense=expense,
                    description=item["description"],
                    category=item.get("category") or "",
                    quantity=item["quantity"],
                    unit_price=item["unit_price"],
                    line_total=item["line_total"],
                )
            expense.subtotal = validated["subtotal"]
            expense.discount_amount = validated["discount_amount"]
            expense.total_amount = validated["total_amount"]

        expense.save()

        create_audit_log(
            request=request,
            hospital=expense.hospital,
            module="expenses",
            action="update_expense",
            obj=expense,
            before=before,
            after={
                "paid_to": expense.paid_to,
                "payment_mode": expense.payment_mode,
                "remarks": expense.remarks,
                "subtotal": str(expense.subtotal),
                "discount_amount": str(expense.discount_amount),
                "total_amount": str(expense.total_amount),
                "paid_at": expense.paid_at.isoformat() if expense.paid_at else None,
            },
        )

        expense.refresh_from_db()
        return success_response(data=ExpenseTransactionSerializer(expense).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def void(self, request, pk=None):
        expense: ExpenseTransaction = self.get_object()
        if expense.voided or expense.status == ExpenseTransaction.Status.CANCELLED:
            return Response(
                {"success": False, "errors": {"void": ["This expense voucher is already cancelled."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = ExpenseVoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        void_reason = serializer.validated_data["void_reason"]

        voided_last = apply_void_if_last(
            obj=expense,
            is_last_fn=is_last_expense_voucher,
            void_seq_fn=void_expense_voucher_sequence,
            release_number_fn=release_expense_voucher_number,
        )

        expense.status = ExpenseTransaction.Status.CANCELLED
        expense.void_reason = void_reason
        expense.voided_by_id = request.user.id
        expense.voided_at = timezone.now()
        expense.save(
            update_fields=[
                "voided",
                "status",
                "void_reason",
                "voided_by",
                "voided_at",
                "slip_number",
                "updated_at",
            ]
        )

        create_audit_log(
            request=request,
            hospital=expense.hospital,
            module="expenses",
            action="void_expense",
            obj=expense,
            before={"voided": False, "status": ExpenseTransaction.Status.SUCCESS},
            after={
                "voided": expense.voided,
                "status": expense.status,
                "void_reason": void_reason,
                "slip_number": expense.slip_number,
                "voided_last": voided_last,
            },
        )

        return success_response(data=ExpenseTransactionSerializer(expense).data)


@api_view(["GET", "PUT"])
@permission_classes([permissions.IsAuthenticated])
@transaction.atomic
def expense_quick_services(request):
    def _normalize_category(value) -> str:
        category = str(value or "").strip()
        return (category or "Custom")[:80]

    hospital_id = getattr(request.user, "hospital_id", None)
    if not hospital_id:
        return Response({"success": False, "detail": "Hospital context required."}, status=400)

    if request.method == "GET":
        service_rows = (
            ExpenseQuickService.objects.filter(hospital_id=hospital_id, is_active=True)
            .order_by("category", "sort_order", "created_at")
        )
        category_rows = (
            ExpenseQuickCategory.objects.filter(hospital_id=hospital_id, is_active=True)
            .order_by("sort_order", "created_at")
        )
        services = [{"label": r.label, "category": r.category or "Custom", "price": float(r.price)} for r in service_rows]
        categories = [r.name for r in category_rows]
        return success_response(data={"services": services, "categories": categories})

    services = request.data.get("services")
    if not isinstance(services, list):
        return Response({"success": False, "errors": {"services": ["Must be a list."]}}, status=400)
    category_names = request.data.get("categories")
    if category_names is not None and not isinstance(category_names, list):
        return Response({"success": False, "errors": {"categories": ["Must be a list."]}}, status=400)

    ExpenseQuickService.objects.filter(hospital_id=hospital_id).delete()
    create_rows = []
    for idx, row in enumerate(services):
        label = str((row or {}).get("label") or "").strip()
        if not label:
            continue
        category = _normalize_category((row or {}).get("category"))
        try:
            price = Decimal(str((row or {}).get("price") or "0"))
        except Exception:
            price = Decimal("0")
        if price < 0:
            price = Decimal("0")
        create_rows.append(
            ExpenseQuickService(
                hospital_id=hospital_id,
                label=label[:120],
                category=category,
                price=price,
                sort_order=idx,
                is_active=True,
            )
        )
    if create_rows:
        ExpenseQuickService.objects.bulk_create(create_rows)

    normalized_categories = []
    if isinstance(category_names, list):
        for name in category_names:
            normalized = _normalize_category(name)
            if normalized and normalized not in normalized_categories:
                normalized_categories.append(normalized)
    for row in create_rows:
        normalized = _normalize_category(row.category)
        if normalized and normalized not in normalized_categories:
            normalized_categories.append(normalized)
    if "Custom" not in normalized_categories:
        normalized_categories.insert(0, "Custom")

    ExpenseQuickCategory.objects.filter(hospital_id=hospital_id).delete()
    ExpenseQuickCategory.objects.bulk_create(
        [
            ExpenseQuickCategory(
                hospital_id=hospital_id,
                name=name,
                sort_order=idx,
                is_active=True,
            )
            for idx, name in enumerate(normalized_categories)
        ]
    )

    return success_response(data={"services": services, "categories": normalized_categories})


@api_view(["GET", "POST"])
@permission_classes([permissions.IsAuthenticated])
@transaction.atomic
def expense_parties(request):
    hospital_id = getattr(request.user, "hospital_id", None)
    if not hospital_id:
        return Response({"success": False, "detail": "Hospital context required."}, status=400)

    if request.method == "GET":
        qs = ExpenseParty.objects.filter(hospital_id=hospital_id, is_active=True).order_by("name")
        search = (request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(phone__icontains=search))
        limit = min(int(request.query_params.get("limit") or 50), 200)
        rows = [
            {"id": str(p.id), "name": p.name, "phone": p.phone or ""}
            for p in qs[:limit]
        ]
        return success_response(data={"parties": rows})

    name = str((request.data or {}).get("name") or "").strip()
    if not name:
        return Response({"success": False, "errors": {"name": ["Party name is required."]}}, status=400)
    phone = str((request.data or {}).get("phone") or "").strip()[:30]

    party, created = ExpenseParty.objects.get_or_create(
        hospital_id=hospital_id,
        name=name,
        defaults={"phone": phone, "is_active": True},
    )
    if not created and phone and party.phone != phone:
        party.phone = phone
        party.save(update_fields=["phone", "updated_at"])

    create_audit_log(
        request=request,
        hospital=party.hospital,
        module="expenses",
        action="create_expense_party" if created else "update_expense_party",
        obj=party,
        after={"name": party.name, "phone": party.phone},
    )

    return success_response(
        data={"id": str(party.id), "name": party.name, "phone": party.phone or "", "created": created},
        status_code=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


def _get_expense_party_for_hospital(party_id, hospital_id):
    try:
        return ExpenseParty.objects.get(id=party_id, hospital_id=hospital_id, is_active=True)
    except ExpenseParty.DoesNotExist as exc:
        raise NotFound() from exc


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([permissions.IsAuthenticated])
@transaction.atomic
def expense_party_detail(request, party_id):
    hospital_id = getattr(request.user, "hospital_id", None)
    if not hospital_id:
        return Response({"success": False, "detail": "Hospital context required."}, status=400)

    party = _get_expense_party_for_hospital(party_id, hospital_id)

    if request.method == "GET":
        return success_response(
            data={"id": str(party.id), "name": party.name, "phone": party.phone or ""},
        )

    if request.method == "DELETE":
        before = {"name": party.name, "phone": party.phone, "is_active": party.is_active}
        party.is_active = False
        party.save(update_fields=["is_active", "updated_at"])
        create_audit_log(
            request=request,
            hospital=party.hospital,
            module="expenses",
            action="delete_expense_party",
            obj=party,
            before=before,
            after={"is_active": False},
        )
        return success_response(data={"id": str(party.id), "deleted": True})

    payload = request.data or {}
    before = {"name": party.name, "phone": party.phone}
    update_fields = []

    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            return Response(
                {"success": False, "errors": {"name": ["Party name is required."]}},
                status=400,
            )
        party.name = name
        update_fields.append("name")

    if "phone" in payload:
        party.phone = str(payload.get("phone") or "").strip()[:30]
        update_fields.append("phone")

    if not update_fields:
        return success_response(
            data={"id": str(party.id), "name": party.name, "phone": party.phone or ""},
        )

    update_fields.append("updated_at")
    try:
        party.save(update_fields=update_fields)
    except IntegrityError:
        return Response(
            {"success": False, "errors": {"name": ["A party with this name already exists."]}},
            status=400,
        )

    create_audit_log(
        request=request,
        hospital=party.hospital,
        module="expenses",
        action="update_expense_party",
        obj=party,
        before=before,
        after={"name": party.name, "phone": party.phone},
    )

    return success_response(
        data={"id": str(party.id), "name": party.name, "phone": party.phone or ""},
    )
