"""
Enterprise email normalization: store and compare emails case-insensitively.

All person/contact emails should use normalize_email_address() before save and
email__iexact (or normalized value) for lookups.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable


def normalize_email_address(email: str | None) -> str:
    """Strip whitespace and lowercase the full address (local + domain)."""
    if email is None:
        return ''
    return str(email).strip().lower()


def email_iexact_filter(email: str | None, field_name: str = 'email') -> dict[str, Any]:
    """Django ORM kwargs for case-insensitive email lookup."""
    return {f'{field_name}__iexact': normalize_email_address(email)}


def find_duplicate_email_groups(
    model,
    email_field: str = 'email',
    *,
    exclude_blank: bool = True,
) -> list[dict[str, Any]]:
    """
    Find groups of rows whose emails differ only by case (or normalize to same value).
    Returns list of {normalized, ids, emails, count}.
    """
    buckets: dict[str, list[tuple[Any, str]]] = defaultdict(list)
    qs = model.objects.all().only('pk', email_field)
    for row in qs.iterator():
        raw = getattr(row, email_field, None) or ''
        if exclude_blank and not str(raw).strip():
            continue
        key = normalize_email_address(raw)
        if not key:
            continue
        buckets[key].append((row.pk, raw))

    groups = []
    for normalized, items in buckets.items():
        distinct_raw = {e for _, e in items}
        if len(items) > 1 and (len(distinct_raw) > 1 or any(normalize_email_address(e) != e for _, e in items)):
            groups.append({
                'normalized': normalized,
                'count': len(items),
                'ids': [str(pk) for pk, _ in items],
                'emails': sorted(distinct_raw, key=str.lower),
            })
    return sorted(groups, key=lambda g: g['normalized'])


def employee_email_exists(email: str, *, exclude_pk=None) -> bool:
    from apps.hr.models import Employee

    if not email:
        return False
    qs = Employee.objects.filter(**email_iexact_filter(email))
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs.exists()


def user_email_exists(email: str, *, exclude_pk=None) -> bool:
    from apps.accounts.models import User

    if not email:
        return False
    qs = User.objects.filter(**email_iexact_filter(email))
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs.exists()


def normalize_model_email_fields(instance, field_names: Iterable[str]) -> list[str]:
    """Normalize email fields on an unsaved/saved instance. Returns list of changed field names."""
    changed = []
    for field in field_names:
        raw = getattr(instance, field, None)
        if not raw:
            continue
        normalized = normalize_email_address(raw)
        if normalized != raw:
            setattr(instance, field, normalized)
            changed.append(field)
    return changed


# Registry for bulk normalization / duplicate reports
EMAIL_MODELS: list[tuple[str, str, tuple[str, ...]]] = [
    ('accounts', 'User', ('email',)),
    ('hr', 'Employee', ('email',)),
    ('hr', 'Candidate', ('email',)),
    ('hr', 'Offer', ('candidate_email', 'company_email')),
    ('hr', 'OfferBuilderV2', ('candidate_email',)),
    ('hr', 'OfferTemplate', ('company_email',)),
]


def iter_email_models(apps=None):
    """Yield (label, model_class, fields) for normalization commands."""
    for app_label, model_name, fields in EMAIL_MODELS:
        if apps is not None:
            model = apps.get_model(app_label, model_name)
        else:
            from django.apps import apps as django_apps
            model = django_apps.get_model(app_label, model_name)
        yield f'{app_label}.{model_name}', model, fields


def normalize_all_stored_emails(
    apps=None,
    *,
    dry_run: bool = True,
    stdout=None,
) -> dict[str, Any]:
    """
    Lowercase stored emails. Skips rows that would violate unique constraints.
    Returns summary dict.
    """
    write = stdout.write if stdout else (lambda s: None)
    summary = {'updated': 0, 'skipped_conflict': 0, 'unchanged': 0, 'conflicts': []}

    for label, model, fields in iter_email_models(apps):
        for obj in model.objects.all().iterator():
            updates = {}
            for field in fields:
                raw = getattr(obj, field, None)
                if not raw:
                    continue
                normalized = normalize_email_address(raw)
                if normalized == raw:
                    summary['unchanged'] += 1
                    continue
                # Unique check for single-email models
                if field == 'email' and hasattr(model, '_meta'):
                    conflict = model.objects.filter(**email_iexact_filter(normalized)).exclude(pk=obj.pk).exists()
                    if conflict:
                        summary['skipped_conflict'] += 1
                        summary['conflicts'].append({
                            'model': label,
                            'pk': str(obj.pk),
                            'field': field,
                            'from': raw,
                            'to': normalized,
                        })
                        write(f'CONFLICT {label} {obj.pk} {raw} -> {normalized}\n')
                        continue
                updates[field] = normalized

            if not updates:
                continue
            if dry_run:
                write(f'[dry-run] {label} {obj.pk} {updates}\n')
                summary['updated'] += 1
            else:
                model.objects.filter(pk=obj.pk).update(**updates)
                summary['updated'] += 1
                write(f'Updated {label} {obj.pk} {updates}\n')

    return summary
