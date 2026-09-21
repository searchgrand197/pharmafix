"""SQLite tuning and retry helpers for local development."""

from __future__ import annotations

import logging
import time

from django.db.backends.signals import connection_created
from django.db.utils import OperationalError

logger = logging.getLogger(__name__)


def enable_sqlite_wal(sender, connection, **kwargs) -> None:
    if connection.vendor != 'sqlite':
        return
    with connection.cursor() as cursor:
        cursor.execute('PRAGMA journal_mode=WAL;')
        cursor.execute('PRAGMA synchronous=NORMAL;')
        cursor.execute('PRAGMA busy_timeout=30000;')


def connect_sqlite_wal_signal() -> None:
    connection_created.connect(enable_sqlite_wal, dispatch_uid='shared_sqlite_wal')


def run_with_sqlite_retry(func, *, max_attempts: int = 8, base_delay: float = 0.15):
    """Retry callable when SQLite reports database is locked."""
    last_exc = None
    for attempt in range(max_attempts):
        try:
            return func()
        except OperationalError as exc:
            last_exc = exc
            message = str(exc).lower()
            if 'database is locked' not in message and 'locked' not in message:
                raise
            if attempt >= max_attempts - 1:
                raise
            delay = base_delay * (attempt + 1)
            logger.warning(
                'SQLite locked (attempt %s/%s), retrying in %.2fs',
                attempt + 1,
                max_attempts,
                delay,
            )
            time.sleep(delay)
    if last_exc:
        raise last_exc
    return None
