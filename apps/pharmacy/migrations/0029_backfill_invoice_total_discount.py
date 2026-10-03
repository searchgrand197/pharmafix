from decimal import Decimal

from django.db import migrations

ZERO = Decimal("0")
MIN_DISCOUNT = Decimal("0.05")


def backfill_total_discount(apps, schema_editor):
    """Store the bill-level discount that sales billing applied but never saved."""
    PharmacyInvoice = apps.get_model("pharmacy", "PharmacyInvoice")
    qs = PharmacyInvoice.objects.filter(total_discount=ZERO).only(
        "id", "subtotal", "cgst", "sgst", "round_off", "grand_total", "total_discount"
    )
    for inv in qs.iterator():
        pre_discount = (inv.subtotal or ZERO) + (inv.cgst or ZERO) + (inv.sgst or ZERO)
        implied = (pre_discount + (inv.round_off or ZERO) - (inv.grand_total or ZERO)).quantize(Decimal("0.01"))
        if implied >= MIN_DISCOUNT:
            PharmacyInvoice.objects.filter(pk=inv.pk).update(total_discount=implied)


class Migration(migrations.Migration):

    dependencies = [
        ("pharmacy", "0028_pharmacyinvoice_round_off"),
    ]

    operations = [
        migrations.RunPython(backfill_total_discount, migrations.RunPython.noop),
    ]
