from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.billing.final_bill_utils import preview_ipd_final_bill_number
from apps.billing.models import IPDFinalBill, IPDFinalBillSequence
from apps.ipd.models import IPDAdmission
from apps.patients.models import Patient
from apps.shared.models import Hospital

User = get_user_model()


class IPDAdmissionFinalBillTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hospital = Hospital.objects.create(name="IPD Hospital", slug="ipd-hospital")
        self.user = User.objects.create_user(
            email="admin@ipd.test",
            password="x",
            hospital=self.hospital,
            is_active=True,
            is_superuser=True,
        )
        self.patient = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-IPD-001",
            first_name="Final",
            middle_name="Bill",
            last_name="Patient",
            gender="male",
            phone="9999999999",
            status="active",
        )
        self.client.force_authenticate(self.user)

    def test_create_admission_creates_ipd_final_bill_record(self):
        IPDFinalBillSequence.objects.create(hospital=self.hospital, year=2026, last_seq=7)

        response = self.client.post(
            "/api/v1/ipd-admissions/",
            {
                "patient": str(self.patient.id),
                "admission_date": "2026-07-04",
                "ward_name": "Ward A",
                "room_name": "Room 1",
                "bed_code": "B-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

        admission = IPDAdmission.objects.get(patient=self.patient, status=IPDAdmission.Status.ADMITTED)
        final_bill = IPDFinalBill.objects.get(admission=admission)
        seq = IPDFinalBillSequence.objects.get(hospital=self.hospital, year=2026)
        self.assertEqual(final_bill.hospital, self.hospital)
        self.assertEqual(final_bill.patient, self.patient)
        self.assertEqual(seq.last_seq, 8)
        self.assertEqual(final_bill.bill_no, preview_ipd_final_bill_number(admission, 8))
        self.assertEqual(final_bill.patient_name, "Final Bill Patient")
        self.assertEqual(final_bill.patient_phone, "9999999999")
        self.assertEqual(final_bill.room_bed, "B-01")
        self.assertEqual(final_bill.net_amount, 0)
        self.assertEqual(final_bill.items.count(), 0)

    def test_next_admission_uses_updated_final_bill_sequence(self):
        IPDFinalBillSequence.objects.create(hospital=self.hospital, year=2026, last_seq=25)

        first = self.client.post(
            "/api/v1/ipd-admissions/",
            {
                "patient": str(self.patient.id),
                "admission_date": "2026-07-04",
                "ward_name": "Ward A",
                "room_name": "Room 1",
                "bed_code": "B-01",
            },
            format="json",
        )
        self.assertEqual(first.status_code, 201, first.content)

        patient2 = Patient.objects.create(
            hospital=self.hospital,
            uhid="UHID-IPD-002",
            first_name="Second",
            last_name="Patient",
            gender="female",
            phone="8888888888",
            status="active",
        )
        second = self.client.post(
            "/api/v1/ipd-admissions/",
            {
                "patient": str(patient2.id),
                "admission_date": "2026-07-04",
                "ward_name": "Ward B",
                "room_name": "Room 2",
                "bed_code": "B-02",
            },
            format="json",
        )
        self.assertEqual(second.status_code, 201, second.content)

        admission2 = IPDAdmission.objects.get(patient=patient2, status=IPDAdmission.Status.ADMITTED)
        final_bill2 = IPDFinalBill.objects.get(admission=admission2)
        seq = IPDFinalBillSequence.objects.get(hospital=self.hospital, year=2026)
        self.assertEqual(seq.last_seq, 27)
        self.assertEqual(final_bill2.bill_no, preview_ipd_final_bill_number(admission2, 27))
