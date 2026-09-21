from decimal import Decimal, ROUND_HALF_UP

from rest_framework import serializers

from apps.expenses.models import ExpenseLineItem, ExpenseTransaction


class ExpenseLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseLineItem
        fields = [
            "id",
            "description",
            "category",
            "quantity",
            "unit_price",
            "line_total",
            "created_at",
            "updated_at",
        ]


class ExpenseTransactionSerializer(serializers.ModelSerializer):
    hospital_id = serializers.UUIDField(read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.full_name", read_only=True)
    voided_by_name = serializers.CharField(source="voided_by.full_name", read_only=True)
    items = ExpenseLineItemSerializer(many=True, read_only=True)

    class Meta:
        model = ExpenseTransaction
        fields = [
            "id",
            "hospital_id",
            "slip_number",
            "paid_at",
            "paid_to",
            "payment_mode",
            "source",
            "remarks",
            "subtotal",
            "discount_amount",
            "total_amount",
            "recorded_by",
            "recorded_by_name",
            "voided",
            "void_reason",
            "voided_at",
            "voided_by",
            "voided_by_name",
            "status",
            "items",
            "created_at",
            "updated_at",
        ]


class ExpenseLineItemInputSerializer(serializers.Serializer):
    description = serializers.CharField(max_length=300)
    category = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    quantity = serializers.DecimalField(max_digits=10, decimal_places=2, default=Decimal("1.00"))
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    def validate(self, attrs):
        qty = attrs.get("quantity")
        unit_price = attrs.get("unit_price")
        description = str(attrs.get("description") or "").strip()
        if not description:
            raise serializers.ValidationError({"description": ["Description is required."]})
        if qty <= 0:
            raise serializers.ValidationError({"quantity": ["Quantity must be greater than zero."]})
        if unit_price < 0:
            raise serializers.ValidationError({"unit_price": ["Unit price cannot be negative."]})
        attrs["description"] = description
        return attrs


class ExpenseTransactionCreateSerializer(serializers.Serializer):
    paid_at = serializers.DateTimeField()
    paid_to = serializers.CharField(max_length=200)
    payment_mode = serializers.ChoiceField(choices=ExpenseTransaction.PaymentMode.choices)
    source = serializers.ChoiceField(choices=ExpenseTransaction.Source.choices, default=ExpenseTransaction.Source.COLLECTION)
    remarks = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    discount_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, default=Decimal("0.00")
    )
    items = ExpenseLineItemInputSerializer(many=True)

    def validate_paid_to(self, value):
        cleaned = str(value or "").strip()
        if not cleaned:
            raise serializers.ValidationError("Paid to is required.")
        return cleaned

    def validate(self, attrs):
        items = attrs.get("items") or []
        if not items:
            raise serializers.ValidationError({"items": ["At least one line item is required."]})

        discount = attrs.get("discount_amount") or Decimal("0.00")
        if discount < 0:
            raise serializers.ValidationError({"discount_amount": ["Discount cannot be negative."]})

        subtotal = Decimal("0.00")
        for item in items:
            qty = item["quantity"]
            unit_price = item["unit_price"]
            line_base = (qty * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            item["line_total"] = line_base
            subtotal += line_base

        subtotal = subtotal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        discount_amount = min(discount, subtotal).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total_amount = (subtotal - discount_amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        if total_amount <= 0:
            raise serializers.ValidationError({"items": ["Total amount must be greater than zero."]})

        attrs["subtotal"] = subtotal
        attrs["discount_amount"] = discount_amount
        attrs["total_amount"] = total_amount
        attrs["remarks"] = str(attrs.get("remarks") or "").strip()
        return attrs


class ExpenseVoidSerializer(serializers.Serializer):
    void_reason = serializers.CharField(max_length=500)

    def validate_void_reason(self, value):
        cleaned = str(value or "").strip()
        if not cleaned:
            raise serializers.ValidationError("Cancellation reason is required.")
        return cleaned


class ExpenseTransactionUpdateSerializer(serializers.Serializer):
    paid_at = serializers.DateTimeField(required=False)
    paid_to = serializers.CharField(max_length=200, required=False)
    payment_mode = serializers.ChoiceField(choices=ExpenseTransaction.PaymentMode.choices, required=False)
    source = serializers.ChoiceField(choices=ExpenseTransaction.Source.choices, required=False)
    remarks = serializers.CharField(max_length=500, required=False, allow_blank=True)
    discount_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False
    )
    items = ExpenseLineItemInputSerializer(many=True, required=False)

    def validate_paid_to(self, value):
        cleaned = str(value or "").strip()
        if not cleaned:
            raise serializers.ValidationError("Paid to is required.")
        return cleaned

    def validate(self, attrs):
        instance: ExpenseTransaction | None = self.context.get("instance")
        if instance is None:
            raise serializers.ValidationError("Expense instance is required.")

        raw_items = attrs.get("items")
        if raw_items is None:
            raw_items = [
                {
                    "description": item.description,
                    "category": item.category,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                }
                for item in instance.items.all()
            ]

        if not raw_items:
            raise serializers.ValidationError({"items": ["At least one line item is required."]})

        discount = attrs.get("discount_amount")
        if discount is None:
            discount = instance.discount_amount
        if discount < 0:
            raise serializers.ValidationError({"discount_amount": ["Discount cannot be negative."]})

        subtotal = Decimal("0.00")
        processed_items = []
        for item in raw_items:
            qty = item["quantity"]
            unit_price = item["unit_price"]
            line_base = (qty * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            processed_items.append({**item, "line_total": line_base})
            subtotal += line_base

        subtotal = subtotal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        discount_amount = min(discount, subtotal).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total_amount = (subtotal - discount_amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        if total_amount <= 0:
            raise serializers.ValidationError({"items": ["Total amount must be greater than zero."]})

        attrs["items"] = processed_items
        attrs["subtotal"] = subtotal
        attrs["discount_amount"] = discount_amount
        attrs["total_amount"] = total_amount
        attrs["remarks"] = str(attrs.get("remarks", instance.remarks) or "").strip()
        return attrs
