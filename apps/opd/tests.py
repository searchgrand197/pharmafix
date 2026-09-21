from datetime import datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.opd.models import OPDVisit, OPDVisitSequence, OPDVisitStatusHistory
from apps.patients.models import Patient
from apps.shared.models import Hospital


User = get_user_model()


class OPDSkippedStatusTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="Test Hospital", slug="test-hospital")
        self.user = User.objects.create_user(
            email="doctor@test.com",
            password="x",
            hospital=self.hospital,
            is_active=True,
        )
        self.patient = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-0001",
            first_name="Test",
            last_name="Patient",
            gender="male",
            phone="9876500001",
            status="active",
        )
        self.visit = OPDVisit.objects.create(
            hospital=self.hospital,
            patient=self.patient,
            visit_date="2026-04-28",
            queue_number=1,
            doctor_user=self.user,
            created_by=self.user,
            visit_reason="Fever",
            status=OPDVisit.Status.IN_PROGRESS,
        )
        self.client.force_authenticate(self.user)

    def test_patch_visit_to_skipped(self):
        response = self.client.patch(
            f"/api/v1/opd-visits/{self.visit.id}/",
            data={"status": OPDVisit.Status.SKIPPED},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.visit.refresh_from_db()
        self.assertEqual(self.visit.status, OPDVisit.Status.SKIPPED)

    def test_status_history_created_for_skipped_transition(self):
        self.client.patch(
            f"/api/v1/opd-visits/{self.visit.id}/",
            data={"status": OPDVisit.Status.SKIPPED},
            format="json",
        )
        history = OPDVisitStatusHistory.objects.filter(visit=self.visit).order_by("-created_at").first()
        self.assertIsNotNone(history)
        self.assertEqual(history.from_status, OPDVisit.Status.IN_PROGRESS)
        self.assertEqual(history.to_status, OPDVisit.Status.SKIPPED)


class OPDVisitSearchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="Search Hospital", slug="search-hospital")
        self.user = User.objects.create_user(
            email="search@test.com",
            password="x",
            hospital=self.hospital,
            is_active=True,
        )
        self.client.force_authenticate(self.user)

        self.patient_primary = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-1001",
            first_name="Rahul",
            last_name="Sharma",
            gender="male",
            phone="9876501111",
            status="active",
        )
        self.patient_secondary = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-2002",
            first_name="Priya",
            last_name="Verma",
            gender="female",
            phone="9876502222",
            status="active",
        )

        self.primary_visit = OPDVisit.objects.create(
            hospital=self.hospital,
            patient=self.patient_primary,
            visit_date="2026-04-28",
            queue_number=7,
            doctor_user=self.user,
            created_by=self.user,
            visit_reason="General checkup",
            diagnosis="Seasonal fever",
            status=OPDVisit.Status.WAITING,
        )
        self.secondary_visit = OPDVisit.objects.create(
            hospital=self.hospital,
            patient=self.patient_secondary,
            visit_date="2026-04-28",
            queue_number=8,
            doctor_user=self.user,
            created_by=self.user,
            visit_reason="Headache",
            diagnosis="Migraine",
            status=OPDVisit.Status.WAITING,
        )

    def _search_rows(self, query):
        response = self.client.get("/api/v1/opd-visits/", data={"search": query})
        self.assertEqual(response.status_code, 200)
        payload = response.data.get("data", response.data)
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            return payload.get("results", payload.get("data", []))
        return []

    def test_search_matches_patient_name(self):
        rows = self._search_rows("rahul")
        returned_ids = {str(row.get("id")) for row in rows}
        self.assertIn(str(self.primary_visit.id), returned_ids)
        self.assertNotIn(str(self.secondary_visit.id), returned_ids)

    def test_search_matches_patient_mobile(self):
        rows = self._search_rows("9876501111")
        returned_ids = {str(row.get("id")) for row in rows}
        self.assertIn(str(self.primary_visit.id), returned_ids)
        self.assertNotIn(str(self.secondary_visit.id), returned_ids)

    def test_search_matches_patient_uhid(self):
        rows = self._search_rows("UHID-1001")
        returned_ids = {str(row.get("id")) for row in rows}
        self.assertIn(str(self.primary_visit.id), returned_ids)
        self.assertNotIn(str(self.secondary_visit.id), returned_ids)

    def test_search_does_not_match_by_diagnosis_or_reason(self):
        diagnosis_rows = self._search_rows("seasonal fever")
        reason_rows = self._search_rows("general checkup")
        diagnosis_ids = {str(row.get("id")) for row in diagnosis_rows}
        reason_ids = {str(row.get("id")) for row in reason_rows}
        self.assertNotIn(str(self.primary_visit.id), diagnosis_ids)
        self.assertNotIn(str(self.primary_visit.id), reason_ids)


class OPDCreateDatetimeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="OPD DT Hospital", slug="opd-dt-hospital")
        self.user = User.objects.create_user(
            email="opd-dt@test.com",
            password="x",
            hospital=self.hospital,
            is_active=True,
        )
        self.patient = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-DT-01",
            first_name="Date",
            last_name="Test",
            gender="male",
            phone="9876503333",
            status="active",
        )
        self.client.force_authenticate(self.user)

    def test_next_opd_no_preview_does_not_increment_sequence(self):
        year = timezone.now().year
        OPDVisitSequence.objects.create(hospital=self.hospital, year=year, last_seq=3)

        response = self.client.get("/api/v1/opd-visits/next-opd-no/")
        self.assertEqual(response.status_code, 200)
        payload = response.data.get("data") or response.data
        self.assertTrue(payload.get("opd_no"))

        seq = OPDVisitSequence.objects.get(hospital=self.hospital, year=year)
        self.assertEqual(seq.last_seq, 3)

    def test_create_with_visit_datetime_sets_created_at(self):
        dt = timezone.make_aware(datetime(2026, 5, 15, 14, 30, 0))
        response = self.client.post(
            "/api/v1/opd-visits/",
            {
                "patient": str(self.patient.id),
                "visit_date": "2026-05-15",
                "visit_datetime": dt.isoformat(),
                "status": "waiting",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.data.get("data") or response.data
        visit = OPDVisit.objects.get(pk=payload["id"])
        self.assertEqual(str(visit.visit_date), "2026-05-15")
        self.assertEqual(visit.created_at.replace(microsecond=0), dt.replace(microsecond=0))

    def test_create_without_visit_datetime_keeps_default_created_at(self):
        before = timezone.now()
        response = self.client.post(
            "/api/v1/opd-visits/",
            {
                "patient": str(self.patient.id),
                "visit_date": "2026-05-16",
                "status": "waiting",
            },
            format="json",
        )
        after = timezone.now()
        self.assertEqual(response.status_code, 201)
        payload = response.data.get("data") or response.data
        visit = OPDVisit.objects.get(pk=payload["id"])
        self.assertGreaterEqual(visit.created_at, before)
        self.assertLessEqual(visit.created_at, after)

    def test_visit_datetime_date_mismatch_rejected(self):
        dt = timezone.make_aware(datetime(2026, 5, 15, 10, 0, 0))
        response = self.client.post(
            "/api/v1/opd-visits/",
            {
                "patient": str(self.patient.id),
                "visit_date": "2026-05-16",
                "visit_datetime": dt.isoformat(),
                "status": "waiting",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_patch_with_visit_datetime_updates_created_at(self):
        visit = OPDVisit.objects.create(
            hospital=self.hospital,
            patient=self.patient,
            visit_date="2026-05-17",
            queue_number=1,
            created_by=self.user,
            status=OPDVisit.Status.WAITING,
        )
        dt = timezone.make_aware(datetime(2026, 5, 17, 9, 45, 0))
        response = self.client.patch(
            f"/api/v1/opd-visits/{visit.id}/",
            {
                "visit_date": "2026-05-17",
                "visit_datetime": dt.isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        visit.refresh_from_db()
        self.assertEqual(str(visit.visit_date), "2026-05-17")
        self.assertEqual(visit.created_at.replace(microsecond=0), dt.replace(microsecond=0))
