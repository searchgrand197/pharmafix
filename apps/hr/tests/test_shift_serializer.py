from datetime import time
from decimal import Decimal

from django.test import TestCase

from apps.hr.models import Shift
from apps.hr.serializers import ShiftSerializer
from apps.shared.models import Hospital


class ShiftSerializerTests(TestCase):
    def setUp(self):
        self.hospital = Hospital.objects.create(name='Shift Hospital', slug='shift-hospital')
        self.existing = Shift.objects.create(
            hospital=self.hospital,
            name='Mid Shift',
            code='MSHI',
            start_time=time(16, 0),
            end_time=time(0, 0),
            grace_minutes=10,
            half_day_hours=Decimal('4'),
            full_day_hours=Decimal('8'),
            is_overnight=True,
        )

    def test_create_resolves_duplicate_shift_code(self):
        serializer = ShiftSerializer(data={
            'hospital': str(self.hospital.id),
            'name': 'Morning Shift',
            'code': 'MSHI',
            'start_time': '09:00:00',
            'end_time': '18:00:00',
            'grace_minutes': 15,
            'half_day_hours': '4',
            'full_day_hours': '8',
            'is_overnight': False,
            'active': True,
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        shift = serializer.save()
        self.assertEqual(shift.code, 'MSHI2')
        self.assertEqual(Shift.objects.filter(hospital=self.hospital).count(), 2)
