"""
Management command: restore_orphan_sale_stock

Sales billing used to save each bill line separately, deducting stock line by line.
When a later line failed (e.g. insufficient stock) the half-created invoice was deleted,
but the stock already deducted for the earlier lines was never put back.

This finds stock-ledger "pharmacy_dispense" deductions whose invoice no longer exists
and returns the net quantity (after any cancel / edit restores) to each batch.

Preview first (default, nothing is written):
  python manage.py restore_orphan_sale_stock
  python manage.py restore_orphan_sale_stock --since=2026-09-01 --pharmacy=<uuid>
Then apply:
  python manage.py restore_orphan_sale_stock --apply
"""

from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Min, Sum
from django.utils.dateparse import parse_date

ZERO = Decimal("0")
REFERENCE_TYPE = "pharmacy_orphan_restore"


class Command(BaseCommand):
    help = "Return stock deducted for pharmacy sales whose invoice was deleted (failed saves)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", default=False, help="Write the restore entries.")
        parser.add_argument("--pharmacy", type=str, default=None, help="Limit to one pharmacy UUID.")
        parser.add_argument("--since", type=str, default=None, help="Only deductions on/after YYYY-MM-DD.")

    def handle(self, *args, **options):
        from apps.inventory.models import StockLedger
        from apps.pharmacy.models import PharmacyInvoice

        apply = options["apply"]
        since = None
        if options["since"]:
            since = parse_date(options["since"])
            if since is None:
                raise CommandError("--since must be YYYY-MM-DD")

        dispense = StockLedger.objects.filter(reference_type="pharmacy_dispense").exclude(reference_id="")
        if options["pharmacy"]:
            dispense = dispense.filter(pharmacy_id=options["pharmacy"])
        if since:
            dispense = dispense.filter(created_at__date__gte=since)

        existing = {str(i) for i in PharmacyInvoice.objects.values_list("id", flat=True)}
        orphan_refs = {r for r in dispense.values_list("reference_id", flat=True).distinct() if r not in existing}
        already = set(
            StockLedger.objects.filter(reference_type=REFERENCE_TYPE, reference_id__in=orphan_refs)
            .values_list("reference_id", flat=True)
        )
        orphan_refs -= already
        if not orphan_refs:
            self.stdout.write(self.style.SUCCESS("No orphaned sale deductions found."))
            return

        # Net movement per (invoice ref, batch) across dispense / cancel / edit entries.
        rows = (
            StockLedger.objects.filter(reference_id__in=orphan_refs)
            .values("reference_id", "pharmacy_id", "medicine_id", "batch_id")
            .annotate(net=Sum("qty_change"), first_at=Min("created_at"))
        )
        by_ref = defaultdict(list)
        for r in rows:
            if r["net"] < ZERO:
                by_ref[r["reference_id"]].append(r)

        creators = dict(
            StockLedger.objects.filter(reference_id__in=orphan_refs, reference_type="pharmacy_dispense")
            .values_list("reference_id", "created_by_id")
        )

        total_qty = ZERO
        total_lines = 0
        for ref in sorted(by_ref, key=lambda k: min(r["first_at"] for r in by_ref[k])):
            lines = by_ref[ref]
            qty = sum((-r["net"] for r in lines), ZERO)
            when = min(r["first_at"] for r in lines)
            self.stdout.write(f"  invoice {ref} @ {when:%Y-%m-%d %H:%M}: {len(lines)} batch(es), restore {qty:f}")
            total_qty += qty
            total_lines += len(lines)

        self.stdout.write(
            f"{len(by_ref)} deleted invoice(s), {total_lines} batch line(s), {total_qty:f} unit(s) to restore."
        )
        if not apply:
            self.stdout.write(self.style.WARNING("Preview only. Re-run with --apply to restore stock."))
            return

        with transaction.atomic():
            for ref, lines in by_ref.items():
                for r in lines:
                    StockLedger.objects.create(
                        pharmacy_id=r["pharmacy_id"],
                        medicine_id=r["medicine_id"],
                        batch_id=r["batch_id"],
                        qty_change=-r["net"],
                        reason=StockLedger.Reason.RETURN_IN,
                        reference_type=REFERENCE_TYPE,
                        reference_id=ref,
                        created_by_id=creators[ref],
                    )
        self.stdout.write(self.style.SUCCESS(f"Restored {total_qty:f} unit(s) across {total_lines} batch line(s)."))
