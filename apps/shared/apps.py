from django.apps import AppConfig


class SharedConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.shared'

    def ready(self):
        from apps.shared.sqlite import connect_sqlite_wal_signal

        connect_sqlite_wal_signal()
