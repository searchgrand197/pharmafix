"""
Export / import lab templates as JSON.

  python manage.py export_import_lab_templates export --hospital-id <uuid> --out templates.json
  python manage.py export_import_lab_templates import --hospital-id <uuid> --file templates.json
"""
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.shared.models import Hospital
from apps.lab.template_pack import (
    dumps_pack,
    export_hospital_templates,
    import_templates_to_hospital,
    loads_pack,
)


class Command(BaseCommand):
    help = "Export or import lab test templates as a shareable JSON pack"

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["export", "import"])
        parser.add_argument("--hospital-id", required=True)
        parser.add_argument("--out", help="Output .json path (export)")
        parser.add_argument("--file", help="Input .json path (import)")
        parser.add_argument("--no-overwrite", action="store_true")
        parser.add_argument("--keep-extra-parameters", action="store_true")

    def handle(self, *args, **options):
        hospital = Hospital.objects.filter(id=options["hospital_id"]).first()
        if not hospital:
            raise CommandError("Hospital not found")

        action = options["action"]
        if action == "export":
            if not options.get("out"):
                raise CommandError("--out is required for export")
            pack = export_hospital_templates(hospital)
            path = Path(options["out"])
            path.write_text(dumps_pack(pack), encoding="utf-8")
            self.stdout.write(self.style.SUCCESS(
                f"Exported {pack['test_count']} templates to {path}"
            ))
            return

        if action == "import":
            if not options.get("file"):
                raise CommandError("--file is required for import")
            path = Path(options["file"])
            if not path.exists():
                raise CommandError(f"File not found: {path}")
            pack = loads_pack(path.read_text(encoding="utf-8-sig"))
            stats = import_templates_to_hospital(
                hospital,
                pack,
                overwrite=not options["no_overwrite"],
                replace_parameters=not options["keep_extra_parameters"],
            )
            self.stdout.write(self.style.SUCCESS(f"Import done: {stats}"))
            return
