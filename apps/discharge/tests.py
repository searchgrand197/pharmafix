from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.beds.models import Bed, BedRoom, Floor
from apps.billing.models import BillingInvoice, IPDFinalBill
from apps.discharge.models import DischargeSummary, DischargeSummaryTemplate, DischargeSurgery
from apps.ipd.models import IPDAdmission
from apps.patients.models import Patient
from apps.shared.models import Hospital

User = get_user_model()


class DischargeCatalogAndTemplateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="Discharge Hospital", slug="discharge-hospital")
        self.other_hospital = Hospital.objects.create(name="Other Hospital", slug="other-hospital")
        self.user = User.objects.create_user(
            email="doctor@discharge.test",
            password="x",
            hospital=self.hospital,
            is_active=True,
        )
        self.patient = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-DS-001",
            first_name="Test",
            last_name="Patient",
            gender="male",
            phone="9876500001",
            status="active",
        )
        self.admission = IPDAdmission.objects.create(
            hospital=self.hospital,
            patient=self.patient,
            admission_date="2026-05-01",
            status=IPDAdmission.Status.ADMITTED,
            ward_name="Ward A",
            bed_code="B-01",
        )
        self.client.force_authenticate(self.user)

    def test_field_catalog_returns_historical_values(self):
        summary = DischargeSummary.objects.create(
            admission=self.admission,
            hospital=self.hospital,
            diagnosis="Fracture femur",
            diet_advice="Soft diet",
            condition_at_discharge="Stable",
            vitals_at_discharge={"bp": "120/80", "pulse": "72"},
        )
        DischargeSurgery.objects.create(
            summary=summary,
            procedure_name="TKR",
            surgeon_name="Dr. Smith",
        )

        response = self.client.get("/api/v1/summaries/field-catalog/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("Fracture femur", data["fields"]["diagnosis"])
        self.assertIn("Soft diet", data["fields"]["diet_advice"])
        self.assertIn("120/80", data["vitals"]["bp"])
        self.assertIn("TKR", data["child_fields"]["procedure_name"])
        self.assertNotIn("total_billed", data["fields"])

    def test_template_crud_is_hospital_scoped(self):
        create_resp = self.client.post(
            "/api/v1/summaries/templates/",
            {
                "name": "Ortho routine",
                "payload": {
                    "diagnosis": "Fracture",
                    "diet_advice": "Soft diet",
                    "discharge_date": "2026-05-01",
                },
            },
            format="json",
        )
        self.assertEqual(create_resp.status_code, 201)
        template_id = create_resp.json()["id"]
        self.assertNotIn("discharge_date", create_resp.json()["payload"])

        list_resp = self.client.get("/api/v1/summaries/templates/")
        self.assertEqual(list_resp.status_code, 200)
        list_data = list_resp.json()
        rows = list_data.get("results", list_data) if isinstance(list_data, dict) else list_data
        names = [row["name"] for row in rows]
        self.assertIn("Ortho routine", names)

        other_user = User.objects.create_user(
            email="other@discharge.test",
            password="x",
            hospital=self.other_hospital,
            is_active=True,
        )
        self.client.force_authenticate(other_user)
        other_list = self.client.get("/api/v1/summaries/templates/")
        self.assertEqual(other_list.status_code, 200)
        other_data = other_list.json()
        other_rows = other_data.get("results", other_data) if isinstance(other_data, dict) else other_data
        self.assertEqual(other_rows, [])

        self.client.force_authenticate(self.user)
        dup_resp = self.client.post(
            "/api/v1/summaries/templates/",
            {"name": "Ortho routine", "payload": {"diagnosis": "Dup"}},
            format="json",
        )
        self.assertEqual(dup_resp.status_code, 400)

        patch_resp = self.client.patch(
            f"/api/v1/summaries/templates/{template_id}/",
            {"name": "Ortho routine v2", "payload": {"diagnosis": "Updated"}},
            format="json",
        )
        self.assertEqual(patch_resp.status_code, 200)
        self.assertEqual(patch_resp.json()["name"], "Ortho routine v2")

        delete_resp = self.client.delete(f"/api/v1/summaries/templates/{template_id}/")
        self.assertEqual(delete_resp.status_code, 204)
        template = DischargeSummaryTemplate.objects.get(pk=template_id)
        self.assertFalse(template.is_active)

    def test_create_upsert_sets_is_draft_without_finalize(self):
        response = self.client.post(
            "/api/v1/summaries/",
            {
                "admission": str(self.admission.id),
                "diagnosis": "Test diagnosis",
                "is_draft": True,
            },
            format="json",
        )
        self.assertIn(response.status_code, (200, 201))
        summary = DischargeSummary.objects.get(admission=self.admission)
        self.assertTrue(summary.is_draft)

    def test_finalize_payload_clears_is_draft(self):
        DischargeSummary.objects.create(
            admission=self.admission,
            hospital=self.hospital,
            is_draft=True,
        )
        response = self.client.post(
            "/api/v1/summaries/",
            {
                "admission": str(self.admission.id),
                "total_billed": "1000.00",
                "total_paid": "500.00",
                "outstanding_balance": "500.00",
                "is_draft": True,
            },
            format="json",
        )
        self.assertIn(response.status_code, (200, 201))
        summary = DischargeSummary.objects.get(admission=self.admission)
        self.assertFalse(summary.is_draft)

    def test_finalize_creates_room_invoice_and_discharges_admission(self):
        floor = Floor.objects.create(hospital=self.hospital, floor_number=1, name="First Floor")
        room = BedRoom.objects.create(
            hospital=self.hospital,
            floor=floor,
            name="Ward A",
            daily_charge="500.00",
        )
        Bed.objects.create(
            hospital=self.hospital,
            room=room,
            bed_code="B-01",
            bed_number="1",
            status=Bed.Status.OCCUPIED,
        )
        existing_final_bill = IPDFinalBill.objects.create(
            admission=self.admission,
            hospital=self.hospital,
            patient=self.patient,
            bill_no="IPDFIN-CUSTOM-2026-99",
            patient_name="Test Patient",
            patient_phone="9876500001",
            room_bed="B-01",
        )

        response = self.client.post(
            "/api/v1/summaries/",
            {
                "admission": str(self.admission.id),
                "total_billed": "1500.00",
                "total_paid": "1500.00",
                "outstanding_balance": "0.00",
            },
            format="json",
        )
        self.assertIn(response.status_code, (200, 201), response.content)

        self.admission.refresh_from_db()
        self.assertEqual(self.admission.status, IPDAdmission.Status.DISCHARGED)
        self.assertIsNotNone(self.admission.discharged_at)

        room_invoice = BillingInvoice.objects.filter(
            ipd_admission=self.admission,
            invoice_no__startswith="IPDROOM-",
        ).first()
        self.assertIsNotNone(room_invoice)
        self.assertEqual(room_invoice.status, BillingInvoice.Status.FINALIZED)
        self.assertEqual(room_invoice.items.count(), 1)

        bed = Bed.objects.get(bed_code="B-01", hospital=self.hospital)
        self.assertEqual(bed.status, Bed.Status.AVAILABLE)

        final_bill = IPDFinalBill.objects.get(admission=self.admission)
        self.assertEqual(final_bill.hospital, self.hospital)
        self.assertEqual(final_bill.patient, self.patient)
        self.assertEqual(final_bill.id, existing_final_bill.id)
        self.assertEqual(final_bill.bill_no, "IPDFIN-CUSTOM-2026-99")
        self.assertEqual(final_bill.room_bed, "B-01")
        self.assertEqual(final_bill.gross_amount, room_invoice.total_amount)
        self.assertEqual(final_bill.net_amount, room_invoice.total_amount)
        self.assertEqual(final_bill.items.count(), 1)
        self.assertEqual(final_bill.items.first().description, room_invoice.items.first().description)

    def _list_summary_ids(self, response):
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        rows = payload.get("results", payload.get("data", payload))
        if isinstance(rows, dict):
            rows = rows.get("results", rows.get("data", []))
        return {row["id"] for row in rows}

    def test_list_summaries_excludes_drafts_when_is_draft_false(self):
        patient2 = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-DS-002",
            first_name="Final",
            last_name="Patient",
            gender="female",
            phone="9876500002",
            status="active",
        )
        admission2 = IPDAdmission.objects.create(
            hospital=self.hospital,
            patient=patient2,
            admission_date="2026-05-02",
            status=IPDAdmission.Status.DISCHARGED,
            ward_name="Ward B",
            bed_code="B-02",
        )
        draft_summary = DischargeSummary.objects.create(
            admission=self.admission,
            hospital=self.hospital,
            is_draft=True,
            diagnosis="Draft only",
        )
        final_summary = DischargeSummary.objects.create(
            admission=admission2,
            hospital=self.hospital,
            is_draft=False,
            diagnosis="Finalized",
        )

        response = self.client.get("/api/v1/summaries/?is_draft=false&limit=500")
        ids = self._list_summary_ids(response)
        self.assertIn(str(final_summary.id), ids)
        self.assertNotIn(str(draft_summary.id), ids)

    def test_list_summaries_includes_drafts_when_unfiltered(self):
        patient2 = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-DS-003",
            first_name="Another",
            last_name="Patient",
            gender="male",
            phone="9876500003",
            status="active",
        )
        admission2 = IPDAdmission.objects.create(
            hospital=self.hospital,
            patient=patient2,
            admission_date="2026-05-03",
            status=IPDAdmission.Status.DISCHARGED,
            ward_name="Ward C",
            bed_code="B-03",
        )
        draft_summary = DischargeSummary.objects.create(
            admission=self.admission,
            hospital=self.hospital,
            is_draft=True,
        )
        final_summary = DischargeSummary.objects.create(
            admission=admission2,
            hospital=self.hospital,
            is_draft=False,
        )

        response = self.client.get("/api/v1/summaries/?limit=500")
        ids = self._list_summary_ids(response)
        self.assertIn(str(draft_summary.id), ids)
        self.assertIn(str(final_summary.id), ids)
