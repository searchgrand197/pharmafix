import os
from django.core.management.base import BaseCommand
from apps.hr.models import Candidate


class Command(BaseCommand):
    help = 'Delete DOC/DOCX resume files and set resume field to null for candidates'

    def handle(self, *args, **options):
        candidates = Candidate.objects.exclude(resume__isnull=True).exclude(resume='')
        
        deleted_count = 0
        updated_count = 0
        
        for candidate in candidates:
            if candidate.resume and candidate.resume.name:
                resume_path = candidate.resume.path if hasattr(candidate.resume, 'path') else None
                file_name = candidate.resume.name.lower()
                
                # Check if file is DOC or DOCX
                if file_name.endswith('.doc') or file_name.endswith('.docx'):
                    # Delete physical file
                    if resume_path and os.path.exists(resume_path):
                        try:
                            os.remove(resume_path)
                            deleted_count += 1
                            self.stdout.write(f'Deleted file: {resume_path}')
                        except Exception as e:
                            self.stdout.write(f'Error deleting file {resume_path}: {str(e)}')
                    
                    # Set resume field to null
                    candidate.resume = None
                    candidate.save()
                    updated_count += 1
                    self.stdout.write(f'Updated candidate: {candidate.name}')
        
        self.stdout.write(self.style.SUCCESS(
            f'Successfully deleted {deleted_count} DOC/DOCX files and updated {updated_count} candidates'
        ))
