"""Run work after commit without blocking the HTTP response."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import Any

from django.db import transaction

from apps.shared.sqlite import run_with_sqlite_retry

logger = logging.getLogger(__name__)


def run_after_commit(func: Callable[..., Any], /, **kwargs: Any) -> None:
    """
    Schedule *func* on a background thread after the outermost transaction commits.
    SQLite lock errors are retried automatically.
    """

    def _spawn() -> None:
        def _run() -> None:
            try:
                run_with_sqlite_retry(lambda: func(**kwargs))
            except Exception:
                logger.exception('Deferred task failed: %s', getattr(func, '__name__', func))

        threading.Thread(target=_run, daemon=True, name=f'deferred-{getattr(func, "__name__", "task")}').start()

    transaction.on_commit(_spawn)
