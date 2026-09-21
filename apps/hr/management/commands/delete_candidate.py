from django.core.management.base import BaseCommand
from apps.hr.models import Candidate, JobOpening


class Command(BaseCommand):
    help = 'Delete a specific candidate by name and job code'

    def handle(self, *args, **options):
        # Find the job with JOB003
        try:
            job = JobOpening.objects.get(job_code='JOB003')
        except JobOpening.DoesNotExist:
            self.stdout.write(self.style.ERROR('Job with code "JOB003" not found'))
            return
        
        # Find candidate named ankush for this job
        candidates = Candidate.objects.filter(job_opening=job, name__icontains='ankush')
        count = candidates.count()
        
        if count == 0:
            self.stdout.write(self.style.WARNING('No candidate named "ankush" found for JOB003'))
            return
        
        # List candidates to be deleted
        self.stdout.write(f'Found {count} candidate(s) named "ankush" for JOB003:')
        for candidate in candidates:
            self.stdout.write(f'  - {candidate.name} (ID: {candidate.id})')
        
        # Delete the candidates
        deleted, _ = candidates.delete()
        
        self.stdout.write(self.style.SUCCESS(
            f'Successfully deleted {deleted} candidate(s) named "ankush" for JOB003'
        ))
