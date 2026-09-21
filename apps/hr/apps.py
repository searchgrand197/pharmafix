from django.apps import AppConfig

class HrConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.hr'

    def ready(self):
        try:
            from apps.hr.models import create_default_component_templates
            from django.db.utils import OperationalError, ProgrammingError
            try:
                create_default_component_templates()
            except (OperationalError, ProgrammingError):
                pass
        except Exception:
            pass

