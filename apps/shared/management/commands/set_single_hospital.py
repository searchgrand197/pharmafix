"""
Replace all hospitals with a single tenant: Test Hospital.

Reassigns every model FK to Hospital, then deletes other hospital rows.
On unique (hospital, …) conflicts, drops the row from the old hospital.
"""
from django.apps import apps
from django.core.management.base import BaseCommand
from django.db import IntegrityError, transaction

from apps.shared.models import Hospital


def _hospital_fk_fields():
    for model in apps.get_models():
        for field in model._meta.get_fields():
            if (
                getattr(field, "many_to_one", False)
                and getattr(field, "related_model", None) is Hospital
            ):
                yield model, field.name


class Command(BaseCommand):
    help = 'Keep only one hospital named "Test Hospital" (slug: test-hospital).'

    def add_arguments(self, parser):
        parser.add_argument(
            "--name",
            default="Test Hospital",
            help='Display name for the sole hospital (default: "Test Hospital").',
        )
        parser.add_argument(
            "--slug",
            default="test-hospital",
            help="Slug for the sole hospital (default: test-hospital).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        name = options["name"].strip()
        slug = options["slug"].strip()

        test, created = Hospital.objects.update_or_create(
            slug=slug,
            defaults={"name": name, "is_active": True, "timezone": "UTC"},
        )
        if not created and test.name != name:
            test.name = name
            test.save(update_fields=["name", "updated_at"])

        others = list(Hospital.objects.exclude(pk=test.pk))
        if not others:
            self.stdout.write(self.style.SUCCESS(f'Only "{test.name}" exists (pk={test.pk}).'))
            return

        reassigned = 0
        dropped = 0

        for old in others:
            for model, field_name in _hospital_fk_fields():
                if model is Hospital:
                    continue
                qs = model.objects.filter(**{field_name: old})
                for obj in qs.iterator(chunk_size=500):
                    setattr(obj, field_name, test)
                    try:
                        with transaction.atomic():
                            obj.save(update_fields=[field_name])
                        reassigned += 1
                    except IntegrityError:
                        obj.delete()
                        dropped += 1

            old.delete()
            self.stdout.write(f"Removed hospital: {old.name} ({old.pk})")

        self.stdout.write(
            self.style.SUCCESS(
                f'Done. Sole hospital: "{test.name}" (slug={test.slug}). '
                f"Reassigned {reassigned} row(s); dropped {dropped} duplicate(s)."
            )
        )
