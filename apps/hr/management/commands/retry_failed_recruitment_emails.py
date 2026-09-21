from django.core.management.base import BaseCommand

from apps.hr.models import Candidate, Interview, Offer, RecruitmentEmailEvent
from apps.hr.recruitment_email_dispatcher import EmailEventDispatcher


def _build_retry_context(event: RecruitmentEmailEvent) -> dict:
    """Rebuild dispatcher context from a stored recruitment email event."""
    context = dict(event.metadata or {})
    candidate = event.candidate

    if event.event_type == RecruitmentEmailEvent.EVENT_APPLICATION_RECEIVED:
        context.setdefault('job', candidate.job_opening)

    elif event.event_type in (
        RecruitmentEmailEvent.EVENT_INTERVIEW_SCHEDULED,
        RecruitmentEmailEvent.EVENT_INTERVIEW_RESCHEDULED,
    ):
        interview_id = context.get('interview_id')
        if not interview_id and event.stage.startswith('interview:'):
            parts = event.stage.split(':')
            if len(parts) >= 2:
                interview_id = parts[1]
        if interview_id:
            context['interview_id'] = interview_id
            interview = Interview.objects.filter(pk=interview_id).only('scheduled_start').first()
            if interview and event.event_type == RecruitmentEmailEvent.EVENT_INTERVIEW_RESCHEDULED:
                context.setdefault('scheduled_start', interview.scheduled_start)

    elif event.event_type == RecruitmentEmailEvent.EVENT_OFFER_SENT:
        offer_id = context.get('offer_id')
        if not offer_id and event.stage.startswith('offer:'):
            offer_id = event.stage.split(':', 1)[1]
        if offer_id:
            context['offer_id'] = offer_id
            context['offer'] = Offer.objects.filter(pk=offer_id).first()

    elif event.event_type == RecruitmentEmailEvent.EVENT_OFFER_ACCEPTED:
        offer_id = context.get('offer_id')
        if not offer_id and event.stage.startswith('offer:'):
            offer_id = event.stage.split(':', 1)[1].split(':', 1)[0]
        offer = Offer.objects.filter(pk=offer_id).first() if offer_id else None
        employee = getattr(candidate, 'employee', None)
        if employee is None and offer:
            employee = getattr(offer, 'employee', None)
        if employee is not None:
            context['employee'] = employee
        if offer is not None:
            context['offer'] = offer

    elif event.event_type == RecruitmentEmailEvent.EVENT_DOCUMENT_REQUEST:
        context.setdefault('message', context.get('message', ''))
        context.setdefault('documents', context.get('documents') or [])

    return context


class Command(BaseCommand):
    help = 'Retry failed recruitment (ATS) candidate emails logged in RecruitmentEmailEvent.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--event-id',
            dest='event_id',
            help='Retry a single RecruitmentEmailEvent UUID.',
        )
        parser.add_argument(
            '--candidate-email',
            dest='candidate_email',
            help='Limit retries to events for candidates with this email address.',
        )

    def handle(self, *args, **options):
        qs = RecruitmentEmailEvent.objects.filter(
            email_status=RecruitmentEmailEvent.STATUS_FAILED,
        ).select_related('candidate', 'candidate__job_opening').order_by('created_at')

        if options.get('event_id'):
            qs = qs.filter(pk=options['event_id'])
        if options.get('candidate_email'):
            qs = qs.filter(candidate__email__iexact=options['candidate_email'].strip())

        events = list(qs)
        if not events:
            self.stdout.write(self.style.WARNING('No failed recruitment email events to retry.'))
            return

        self.stdout.write(f'Retrying {len(events)} failed recruitment email event(s)...')

        sent = 0
        failed = 0
        for event in events:
            candidate = event.candidate
            if not isinstance(candidate, Candidate):
                self.stdout.write(self.style.ERROR(f'Skip {event.pk}: candidate missing'))
                failed += 1
                continue

            context = _build_retry_context(event)
            label = f'{event.event_type} candidate={candidate.email} stage={event.stage}'

            try:
                ok = EmailEventDispatcher.dispatch(
                    event.event_type,
                    candidate=candidate,
                    stage=event.stage,
                    metadata=dict(event.metadata or {}),
                    on_commit=False,
                    sync=True,
                    allow_duplicate=False,
                    **context,
                )
            except Exception as exc:
                self.stdout.write(self.style.ERROR(f'FAIL {label}: {exc}'))
                failed += 1
                continue

            event.refresh_from_db(fields=['email_status', 'error_message'])
            if ok and event.email_status == RecruitmentEmailEvent.STATUS_SENT:
                self.stdout.write(self.style.SUCCESS(f'SENT {label}'))
                sent += 1
            else:
                err = event.error_message or 'unknown error'
                self.stdout.write(self.style.ERROR(f'FAIL {label}: {err}'))
                failed += 1

        self.stdout.write('')
        self.stdout.write(f'Done. sent={sent} failed={failed}')
