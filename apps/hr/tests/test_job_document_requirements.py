"""Tests for per-job document requirements and application snapshots."""
from django.test import TestCase

from apps.hr.job_document_requirements import (
    save_job_document_requirements,
    snapshot_application_document_requirements,
)
from apps.hr.models import (
    ApplicationDocumentRequirement,
    Candidate,
    Department,
    DocumentType,
    Employee,
    JobDocumentRequirement,
    JobOpening,
)
from apps.hr.onboarding_documents import build_candidate_onboarding_payload, sync_employee_requirements
from apps.hr.recruitment_applications import create_application_from_public_apply
from apps.hr.serializers import DocumentTypeSerializer
from apps.shared.models import Hospital


class JobDocumentRequirementTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Test Hospital', slug='test-hospital-doc')
        self.department = Department.objects.create(hospital=self.hospital, name='Operations')
        self.job = JobOpening.objects.create(
            hospital=self.hospital,
            title='Driver',
            department=self.department,
            job_code='JOB-DOC-001',
            status='open',
        )
        self.license = DocumentType.objects.create(
            hospital=self.hospital,
            name='Driving License',
            mandatory=True,
            verification_mode='upload',
        )
        self.aadhaar = DocumentType.objects.create(
            hospital=self.hospital,
            name='Aadhaar',
            mandatory=True,
            verification_mode='upload',
        )
        self.degree = DocumentType.objects.create(
            hospital=self.hospital,
            name='Degree Certificate',
            mandatory=True,
            verification_mode='upload',
        )

    def test_job_document_requirements_saved_per_job(self):
        save_job_document_requirements(
            self.job,
            [
                {'document_type': str(self.license.id), 'is_required': True, 'display_order': 0},
                {'document_type': str(self.aadhaar.id), 'is_required': True, 'display_order': 1},
            ],
        )
        self.assertEqual(JobDocumentRequirement.objects.filter(job=self.job).count(), 2)
        names = set(
            JobDocumentRequirement.objects.filter(job=self.job).values_list(
                'document_type__name', flat=True
            )
        )
        self.assertEqual(names, {'Driving License', 'Aadhaar'})

    def test_application_snapshot_immutable_when_job_changes(self):
        save_job_document_requirements(
            self.job,
            [{'document_type': str(self.license.id), 'is_required': True}],
        )
        candidate = create_application_from_public_apply(
            self.job,
            name='Alex Driver',
            email='alex.driver@example.com',
            phone='9999999999',
        )
        self.assertEqual(ApplicationDocumentRequirement.objects.filter(application=candidate).count(), 1)

        save_job_document_requirements(
            self.job,
            [
                {'document_type': str(self.degree.id), 'is_required': True},
                {'document_type': str(self.aadhaar.id), 'is_required': True},
            ],
        )
        snapshot = snapshot_application_document_requirements(candidate)
        self.assertEqual(len(snapshot), 1)
        self.assertEqual(snapshot[0].document_type.name, 'Driving License')

    def test_employee_sync_uses_application_snapshot_not_global(self):
        save_job_document_requirements(
            self.job,
            [{'document_type': str(self.aadhaar.id), 'is_required': True}],
        )
        candidate = create_application_from_public_apply(
            self.job,
            name='Sam Sweeper',
            email='sam.sweeper@example.com',
        )
        employee = Employee.objects.create(
            hospital=self.hospital,
            name=candidate.name,
            email=candidate.email,
            candidate=candidate,
            job_title=self.job.title,
        )
        requirements = list(sync_employee_requirements(employee))
        self.assertEqual(len(requirements), 1)
        self.assertEqual(requirements[0].document_type.name, 'Aadhaar')
        self.assertTrue(requirements[0].mandatory)

    def test_onboarding_payload_includes_all_job_upload_documents(self):
        voter_card = DocumentType.objects.create(
            hospital=self.hospital,
            name='Voter Card',
            mandatory=True,
            verification_mode='upload',
        )
        save_job_document_requirements(
            self.job,
            [
                {'document_type': str(self.aadhaar.id), 'is_required': True, 'display_order': 0},
                {'document_type': str(self.degree.id), 'is_required': True, 'display_order': 1},
                {'document_type': str(voter_card.id), 'is_required': True, 'display_order': 2},
            ],
        )
        candidate = create_application_from_public_apply(
            self.job,
            name='Pat Voter',
            email='pat.voter@example.com',
        )
        employee = Employee.objects.create(
            hospital=self.hospital,
            name=candidate.name,
            email=candidate.email,
            candidate=candidate,
            job_title=self.job.title,
        )

        payload = build_candidate_onboarding_payload(employee)
        documents = payload['documents']

        self.assertEqual(len(documents), 3)
        for row in documents:
            self.assertEqual(row['verification_mode'], 'upload')

        self.assertFalse(payload['can_submit'])
        self.assertEqual(len(payload['missing_uploads']), 3)
        self.assertEqual(payload['progress']['required_total'], 3)

    def test_document_type_serializer_forces_upload_mode(self):
        serializer = DocumentTypeSerializer(
            data={
                'hospital': str(self.hospital.id),
                'name': 'Legacy Physical Type',
                'verification_mode': 'physical',
                'mandatory': True,
                'is_active': True,
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        doc_type = serializer.save()
        self.assertEqual(doc_type.verification_mode, 'upload')

        update = DocumentTypeSerializer(
            doc_type,
            data={'verification_mode': 'hybrid'},
            partial=True,
        )
        self.assertTrue(update.is_valid(), update.errors)
        updated = update.save()
        self.assertEqual(updated.verification_mode, 'upload')
