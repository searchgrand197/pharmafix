"""
Central event-driven dispatcher for recruitment (ATS) candidate emails.

All recruitment notification triggers must call EmailEventDispatcher — never email_utils
send wrappers directly from views or services.
"""
from __future__ import annotations

import logging
import threading
import uuid
from typing import Any, Optional

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.hr.models import Candidate, Interview, Offer, RecruitmentEmailEvent

logger = logging.getLogger(__name__)

# Public alias for event type constants
EmailEventType = RecruitmentEmailEvent

_METADATA_SKIP_KEYS = frozenset({'job', 'offer', 'employee', 'candidate'})


def _metadata_from_context(context: dict) -> dict:
    """Build JSON-safe metadata for RecruitmentEmailEvent (no model instances)."""
    meta = {}
    for key, value in context.items():
        if value is None or key in _METADATA_SKIP_KEYS:
            continue
        if hasattr(value, 'pk'):
            meta[f'{key}_id'] = str(value.pk)
            continue
        if isinstance(value, (str, int, float, bool)):
            meta[key] = value
            continue
        if isinstance(value, (list, dict)):
            try:
                import json
                json.dumps(value)
                meta[key] = value
            except (TypeError, ValueError):
                meta[key] = str(value)
            continue
        meta[key] = str(value)
    return meta


class EmailEventDispatcher:
    """Routes allowed recruitment emails through idempotent event logging."""

    ALLOWED_EVENT_TYPES = frozenset(
        choice[0] for choice in RecruitmentEmailEvent.EVENT_TYPE_CHOICES
    )

    @classmethod
    def default_stage(cls, event_type: str, **context) -> str:
        """Build the idempotency stage key for an event."""
        if event_type == RecruitmentEmailEvent.EVENT_APPLICATION_RECEIVED:
            return 'applied'
        if event_type == RecruitmentEmailEvent.EVENT_SHORTLISTED:
            return 'shortlisted'
        if event_type == RecruitmentEmailEvent.EVENT_REJECTED:
            return 'rejected'
        if event_type == RecruitmentEmailEvent.EVENT_INTERVIEW_SCHEDULED:
            interview_id = context.get('interview_id')
            return f'interview:{interview_id}'
        if event_type == RecruitmentEmailEvent.EVENT_INTERVIEW_RESCHEDULED:
            interview_id = context.get('interview_id')
            slot = context.get('scheduled_start')
            if slot is not None:
                if hasattr(slot, 'timestamp'):
                    ts = int(slot.timestamp())
                else:
                    ts = str(slot)
                return f'interview:{interview_id}:reschedule:{ts}'
            return f'interview:{interview_id}:reschedule'
        if event_type == RecruitmentEmailEvent.EVENT_OFFER_SENT:
            offer_id = context.get('offer_id')
            return f'offer:{offer_id}'
        if event_type == RecruitmentEmailEvent.EVENT_OFFER_ACCEPTED:
            offer_id = context.get('offer_id')
            return f'offer:{offer_id}:welcome'
        if event_type == RecruitmentEmailEvent.EVENT_DOCUMENT_REQUEST:
            return context.get('stage') or f'doc_req:{uuid.uuid4()}'
        raise ValueError(f'No default stage for event_type={event_type}')

    @classmethod
    def dispatch(
        cls,
        event_type: str,
        *,
        candidate_id=None,
        candidate=None,
        stage: Optional[str] = None,
        on_commit: bool = True,
        sync: bool = False,
        allow_duplicate: bool = False,
        metadata: Optional[dict] = None,
        **context: Any,
    ) -> bool:
        """
        Queue or run a recruitment email.

        Returns True if send succeeded (or duplicate skipped as no-op success).
        For sync OFFER_SENT, returns False when SMTP fails.
        """
        if event_type not in cls.ALLOWED_EVENT_TYPES:
            raise ValueError(f'Unsupported recruitment email event: {event_type}')

        cand = candidate
        if cand is None:
            if not candidate_id:
                raise ValueError('candidate or candidate_id is required')
            cand = Candidate.objects.select_related('job_opening').filter(pk=candidate_id).first()
            if not cand:
                logger.warning('[email-dispatch] candidate not found id=%s', candidate_id)
                return False
        else:
            candidate_id = cand.pk

        if not stage:
            stage = cls.default_stage(event_type, **context)

        meta = dict(metadata or {})
        meta.update(_metadata_from_context(context))

        candidate_pk = cand.pk
        job_ref = context.get('job')

        def _run():
            run_cand = cand
            if candidate_pk and (on_commit is False or sync):
                run_cand = (
                    Candidate.objects.select_related('job_opening')
                    .filter(pk=candidate_pk)
                    .first()
                ) or cand
            run_context = dict(context)
            if job_ref is not None:
                run_context['job'] = job_ref
            elif run_cand and getattr(run_cand, 'job_opening_id', None):
                run_context.setdefault('job', run_cand.job_opening)
            return cls._execute(
                event_type,
                run_cand,
                stage,
                allow_duplicate,
                meta,
                **run_context,
            )

        if on_commit:
            transaction.on_commit(_run)
            return True
        if sync:
            return _run()
        threading.Thread(target=_run, daemon=True).start()
        return True

    @classmethod
    def _execute(
        cls,
        event_type: str,
        candidate: Candidate,
        stage: str,
        allow_duplicate: bool,
        metadata: dict,
        **context: Any,
    ) -> bool:
        event_row = None
        try:
            if allow_duplicate:
                event_row = RecruitmentEmailEvent.objects.create(
                    candidate=candidate,
                    event_type=event_type,
                    stage=stage,
                    email_status=RecruitmentEmailEvent.STATUS_PENDING,
                    metadata=metadata,
                )
            else:
                event_row, is_dup = cls._claim(candidate.pk, event_type, stage, metadata)
                if is_dup:
                    logger.info(
                        '[email-dispatch] duplicate skipped candidate=%s event=%s stage=%s',
                        candidate.pk,
                        event_type,
                        stage,
                    )
                    return True

            ok, err = cls._send(event_type, candidate, **context)
        except Exception as exc:
            logger.exception(
                '[email-dispatch] send error candidate=%s event=%s',
                candidate.pk,
                event_type,
            )
            if event_row is not None:
                RecruitmentEmailEvent.objects.filter(pk=event_row.pk).update(
                    email_status=RecruitmentEmailEvent.STATUS_FAILED,
                    error_message=str(exc)[:2000],
                )
            return False

        RecruitmentEmailEvent.objects.filter(pk=event_row.pk).update(
            email_status=(
                RecruitmentEmailEvent.STATUS_SENT
                if ok
                else RecruitmentEmailEvent.STATUS_FAILED
            ),
            error_message='' if ok else (err or 'SMTP delivery failed')[:2000],
        )
        return ok

    @classmethod
    def _coerce_smtp_result(cls, result) -> tuple[bool, str]:
        from apps.hr.email_utils import smtp_send_error, smtp_send_ok

        return smtp_send_ok(result), smtp_send_error(result)

    @classmethod
    def _claim(cls, candidate_id, event_type, stage, metadata):
        try:
            with transaction.atomic():
                row = RecruitmentEmailEvent.objects.create(
                    candidate_id=candidate_id,
                    event_type=event_type,
                    stage=stage,
                    email_status=RecruitmentEmailEvent.STATUS_PENDING,
                    metadata=metadata,
                )
            return row, False
        except IntegrityError:
            existing = RecruitmentEmailEvent.objects.filter(
                candidate_id=candidate_id,
                event_type=event_type,
                stage=stage,
            ).first()
            if existing and existing.email_status == RecruitmentEmailEvent.STATUS_FAILED:
                RecruitmentEmailEvent.objects.filter(pk=existing.pk).update(
                    email_status=RecruitmentEmailEvent.STATUS_PENDING,
                    error_message='',
                )
                return existing, False
            if existing:
                RecruitmentEmailEvent.objects.filter(pk=existing.pk).update(
                    email_status=RecruitmentEmailEvent.STATUS_SKIPPED_DUPLICATE,
                )
            return existing, True

    @classmethod
    def _send(cls, event_type: str, candidate: Candidate, **context) -> tuple[bool, str]:
        from apps.hr import email_utils

        if event_type == RecruitmentEmailEvent.EVENT_APPLICATION_RECEIVED:
            job = context.get('job') or candidate.job_opening
            return cls._coerce_smtp_result(
                email_utils._send_job_application_email_core(candidate, job)
            )

        if event_type == RecruitmentEmailEvent.EVENT_SHORTLISTED:
            return cls._coerce_smtp_result(
                email_utils._send_candidate_status_email_core(candidate, 'shortlisted')
            )

        if event_type == RecruitmentEmailEvent.EVENT_REJECTED:
            return cls._coerce_smtp_result(
                email_utils._send_candidate_status_email_core(candidate, 'rejected')
            )

        if event_type == RecruitmentEmailEvent.EVENT_INTERVIEW_SCHEDULED:
            return cls._coerce_smtp_result(
                email_utils._send_interview_slot_email_core(
                    str(candidate.pk),
                    str(context['interview_id']),
                    rescheduled=False,
                )
            )

        if event_type == RecruitmentEmailEvent.EVENT_INTERVIEW_RESCHEDULED:
            return cls._coerce_smtp_result(
                email_utils._send_interview_slot_email_core(
                    str(candidate.pk),
                    str(context['interview_id']),
                    rescheduled=True,
                )
            )

        if event_type == RecruitmentEmailEvent.EVENT_OFFER_SENT:
            offer = context.get('offer')
            if offer is None:
                offer = Offer.objects.get(pk=context['offer_id'])
            return cls._coerce_smtp_result(
                email_utils._send_offer_email_core(
                    offer,
                    base_url=context.get('base_url'),
                )
            )

        if event_type == RecruitmentEmailEvent.EVENT_OFFER_ACCEPTED:
            employee = context['employee']
            offer = context.get('offer')
            return cls._coerce_smtp_result(
                email_utils._send_onboarding_welcome_email_core(employee, offer)
            )

        if event_type == RecruitmentEmailEvent.EVENT_DOCUMENT_REQUEST:
            return cls._coerce_smtp_result(
                email_utils._send_document_request_email_core(
                    candidate,
                    message=context.get('message', ''),
                    documents=context.get('documents') or [],
                )
            )

        return False, 'Unsupported recruitment email event'

    # --- Convenience entry points used by views/services ---

    @classmethod
    def application_received(cls, candidate, job=None, **kwargs):
        return cls.dispatch(
            RecruitmentEmailEvent.EVENT_APPLICATION_RECEIVED,
            candidate=candidate,
            job=job or candidate.job_opening,
            **kwargs,
        )

    @classmethod
    def shortlisted(cls, candidate, **kwargs):
        return cls.dispatch(
            RecruitmentEmailEvent.EVENT_SHORTLISTED,
            candidate=candidate,
            **kwargs,
        )

    @classmethod
    def rejected(cls, candidate, *, rejection_from_status=None, **kwargs):
        meta = kwargs.pop('metadata', None) or {}
        if rejection_from_status:
            meta['rejection_from_status'] = rejection_from_status
        return cls.dispatch(
            RecruitmentEmailEvent.EVENT_REJECTED,
            candidate=candidate,
            metadata=meta,
            **kwargs,
        )

    @classmethod
    def interview_scheduled(cls, candidate_id, interview_id, **kwargs):
        return cls.dispatch(
            RecruitmentEmailEvent.EVENT_INTERVIEW_SCHEDULED,
            candidate_id=candidate_id,
            interview_id=interview_id,
            **kwargs,
        )

    @classmethod
    def interview_rescheduled(
        cls,
        candidate_id,
        interview_id,
        *,
        scheduled_start=None,
        **kwargs,
    ):
        inv = None
        if scheduled_start is None:
            inv = Interview.objects.filter(pk=interview_id).only('scheduled_start').first()
            scheduled_start = inv.scheduled_start if inv else None
        return cls.dispatch(
            RecruitmentEmailEvent.EVENT_INTERVIEW_RESCHEDULED,
            candidate_id=candidate_id,
            interview_id=interview_id,
            scheduled_start=scheduled_start,
            **kwargs,
        )

    @classmethod
    def offer_sent(cls, offer, *, base_url=None, sync=False, on_commit=False, **kwargs):
        return cls.dispatch(
            RecruitmentEmailEvent.EVENT_OFFER_SENT,
            candidate_id=offer.candidate_id,
            offer_id=offer.pk,
            offer=offer,
            base_url=base_url,
            sync=sync,
            on_commit=on_commit,
            **kwargs,
        )

    @classmethod
    def offer_accepted(cls, employee, offer=None, **kwargs):
        """Welcome email after offer acceptance / hire (idempotent per offer)."""
        candidate = None
        if offer and getattr(offer, 'candidate_id', None):
            candidate = offer.candidate
        elif getattr(employee, 'candidate_id', None):
            candidate = employee.candidate
        if not candidate:
            logger.warning('[email-dispatch] offer_accepted: no candidate for employee=%s', employee.pk)
            return False

        offer_id = offer.pk if offer else None
        if not offer_id and getattr(employee, 'offer_id', None):
            offer_id = employee.offer_id

        def _run():
            return cls._execute_offer_accepted(employee, offer, candidate, offer_id)

        if kwargs.get('on_commit', True):
            transaction.on_commit(_run)
            return True
        return _run()

    @classmethod
    def _execute_offer_accepted(cls, employee, offer, candidate, offer_id):
        if offer_id:
            stage = cls.default_stage(
                RecruitmentEmailEvent.EVENT_OFFER_ACCEPTED,
                offer_id=offer_id,
            )
            event_row, is_dup = cls._claim(candidate.pk, RecruitmentEmailEvent.EVENT_OFFER_ACCEPTED, stage, {})
            if is_dup:
                logger.info('[email-dispatch] welcome duplicate skipped offer=%s', offer_id)
                return True
        else:
            event_row = RecruitmentEmailEvent.objects.create(
                candidate=candidate,
                event_type=RecruitmentEmailEvent.EVENT_OFFER_ACCEPTED,
                stage='welcome:no-offer',
                email_status=RecruitmentEmailEvent.STATUS_PENDING,
            )

        if offer_id:
            Offer.objects.filter(pk=offer_id).update(
                onboarding_welcome_email_sent_at=timezone.now(),
            )

        try:
            ok = cls._send(
                RecruitmentEmailEvent.EVENT_OFFER_ACCEPTED,
                candidate,
                employee=employee,
                offer=offer,
            )
        except Exception as exc:
            RecruitmentEmailEvent.objects.filter(pk=event_row.pk).update(
                email_status=RecruitmentEmailEvent.STATUS_FAILED,
                error_message=str(exc)[:2000],
            )
            if offer_id:
                Offer.objects.filter(pk=offer_id).update(onboarding_welcome_email_sent_at=None)
            return False

        if not ok and offer_id:
            Offer.objects.filter(pk=offer_id).update(onboarding_welcome_email_sent_at=None)

        RecruitmentEmailEvent.objects.filter(pk=event_row.pk).update(
            email_status=(
                RecruitmentEmailEvent.STATUS_SENT if ok else RecruitmentEmailEvent.STATUS_FAILED
            ),
            error_message='' if ok else 'SMTP delivery failed',
        )
        return ok

    @classmethod
    def document_request(cls, candidate, *, message='', documents=None, **kwargs):
        stage = f'doc_req:{uuid.uuid4()}'
        return cls.dispatch(
            RecruitmentEmailEvent.EVENT_DOCUMENT_REQUEST,
            candidate=candidate,
            stage=stage,
            allow_duplicate=True,
            message=message,
            documents=documents or [],
            **kwargs,
        )
