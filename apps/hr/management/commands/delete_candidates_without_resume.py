from django.core.management.base import BaseCommand
from apps.hr.models import Candidate


class Command(BaseCommand):
    help = 'Delete candidates who do not have a resume'

    def handle(self, *args, **options):
        # Find candidates without resume
        candidates_without_resume = Candidate.objects.filter(resume__isnull=True) | Candidate.objects.filter(resume='')
        
        deleted_count = candidates_without_resume.count()
        
        if deleted_count == 0:
            self.stdout.write(self.style.WARNING('No candidates without resumes found'))
            return
        
        # List candidates to be deleted
        self.stdout.write(f'Found {deleted_count} candidates without resumes:')
        for candidate in candidates_without_resume:
            self.stdout.write(f'  - {candidate.name} (ID: {candidate.id})')
        
        # Delete the candidates
        candidates_without_resume.delete()
        
        self.stdout.write(self.style.SUCCESS(
            f'Successfully deleted {deleted_count} candidates without resumes'
        ))
