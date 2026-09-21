from django.db import transaction

from apps.lab.models import LabSettings


@transaction.atomic
def allocate_lab_visit_id(hospital) -> str:
    """Atomically allocate the next Visit ID for a hospital (PREFIX-0001 style)."""
    settings, _ = LabSettings.objects.select_for_update().get_or_create(
        hospital=hospital,
        defaults={"lab_name": getattr(hospital, "name", "") or "Clinical Laboratory"},
    )
    visit_id = settings.peek_next_visit_id()
    settings.visit_id_next_number = max(1, int(settings.visit_id_next_number or 1)) + 1
    settings.save(update_fields=["visit_id_next_number", "updated_at"])
    return visit_id
