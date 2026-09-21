"""
Management command: seed_lab_templates
Creates demo lab test templates (CBC panel + Widal + rapid serology cards)
for the first hospital found in the database.

CBC + Widal parameter names, units, and reference ranges match the SONAL report pack
(apps/lab/packs/sonal_cbc_widal.json).

Usage:
    python manage.py seed_lab_templates
    python manage.py seed_lab_templates --hospital-id <uuid>
"""
from django.core.management.base import BaseCommand
from apps.shared.models import Hospital
from apps.lab.models import LabTestCategory, LabTest, LabTestParameter


# Exact names/units/ranges from SONAL CBC report (HEMATOLOGY)
CBC_PARAMETERS = [
    # (name, code, unit, ref_range, ref_low, ref_high, method, section_title, sort_order, result_type)
    ("Hemoglobin", "HB", "g/dL", "MEN: 13.5-17.5 / WOMEN: 12.0-15.5", 12.0, 15.5, "", "", 1, "numeric"),
    ("Total Leukocyte Count (TLC)", "TLC", "/cumm", "4000-11000", 4000.0, 11000.0, "", "", 2, "numeric"),
    ("Neutrophils", "NEU", "%", "40-75", 40.0, 75.0, "", "Differential Leucocyte Count (DLC)", 3, "numeric"),
    ("Lymphocytes", "LYM", "%", "20-45", 20.0, 45.0, "", "Differential Leucocyte Count (DLC)", 4, "numeric"),
    ("Monocytes", "MON", "%", "2-10", 2.0, 10.0, "", "Differential Leucocyte Count (DLC)", 5, "numeric"),
    ("Eosinophils", "EOS", "%", "1-5", 1.0, 5.0, "", "Differential Leucocyte Count (DLC)", 6, "numeric"),
    ("Basophils", "BAS", "%", "0-1", 0.0, 1.0, "", "Differential Leucocyte Count (DLC)", 7, "numeric"),
    ("Red Blood Count (RBC)", "RBC", "million/μl", "3.8-4.8", 3.8, 4.8, "", "", 8, "numeric"),
    ("Packed Cell Volume (PCV)", "PCV", "%", "36-46", 36.0, 46.0, "", "", 9, "numeric"),
    ("Mean Corpuscular Volume (MCV)", "MCV", "fL", "83.0-101.0", 83.0, 101.0, "", "", 10, "numeric"),
    ("Mean Corpuscular Hemoglobin (MCH)", "MCH", "pg", "27-32", 27.0, 32.0, "", "", 11, "numeric"),
    ("Mean Corpuscular Hb Concentration (MCHC)", "MCHC", "g/dL", "31.5-34.5", 31.5, 34.5, "", "", 12, "numeric"),
    ("RDW-SD", "RDWSD", "fl", "37-54", 37.0, 54.0, "", "", 13, "numeric"),
    ("RDW-CV", "RDWCV", "%", "11.6-14", 11.6, 14.0, "", "", 14, "numeric"),
    ("Absolute Neutrophils Count", "ANC", "thou/mm3", "2.00-7.00", 2.0, 7.0, "", "Absolute Leucocyte Count", 15, "numeric"),
    ("Absolute Lymphocytes Count", "ALC", "thou/mm3", "1.00-3.00", 1.0, 3.0, "", "Absolute Leucocyte Count", 16, "numeric"),
    ("Absolute Monocytes Count", "AMC", "thou/mm3", "0.20-1.00", 0.2, 1.0, "", "Absolute Leucocyte Count", 17, "numeric"),
    ("Absolute Eosinophils Count", "AEC", "thou/mm3", "0.02-0.50", 0.02, 0.5, "", "Absolute Leucocyte Count", 18, "numeric"),
    ("Platelet Count", "PLT", "lakh/cumm", "1.5-4.5", 1.5, 4.5, "", "", 19, "numeric"),
]

WIDAL_PARAMETERS = [
    ("Salmonella Typhi - \"O\" Antigen", "TO", "", "No Agglutination", None, None, "Slide agglutination", "Widal Test - Slide agglutination", 1, "qualitative"),
    ("Salmonella Typhi - \"H\" Antigen", "TH", "", "No Agglutination", None, None, "Slide agglutination", "Widal Test - Slide agglutination", 2, "qualitative"),
    ("Salmonella Paratyphi - A-H Antigen", "AH", "", "No Agglutination", None, None, "Slide agglutination", "Widal Test - Slide agglutination", 3, "qualitative"),
    ("Salmonella Paratyphi - B-H Antigen", "BH", "", "No Agglutination", None, None, "Slide agglutination", "Widal Test - Slide agglutination", 4, "qualitative"),
    ("Impression", "IMP", "", "Negative", None, None, "Slide agglutination", "Widal Test - Slide agglutination", 5, "qualitative"),
]

WIDAL_INTERPRETATION = (
    "Widal test is a serological test and is used for the diagnosis of enteric fever or typhoid fever. "
    "It is an agglutination test in which specific typhoid fever antibodies are detected by mixing the "
    "patient's serum with killed bacterial suspension of Salmonella carrying specific O, H, AH and BH "
    "antigens and observed for clumping ie. Antigen-antibody reaction. The main principle of Widal test "
    "is that if homologous antibody is present in patient's serum, it will react with respective antigen "
    "in the suspension and gives visible clumping on the test slide or card."
)

HBSAG_INTERPRETATION = (
    "Rapid (card) test for the qualitative detection of HBsAg in human serum/plasma is a sensitive and accurate "
    "one step immunoassay for the qualitative detection of Hepatitis B Surface Antigen (HBsAg). The assay is "
    "intended to be used as an aid in recognition and diagnosis of acute infections and chronic infections of Hepatitis B Virus (HBV).\n"
    "Card test can detect Hepatitis B Surface Antigen in serum or plasma at a concentration of as low as 0.5 ng/ml.\n"
    "This is only screening test. All reactive samples should be confirmed by confirmatory test."
)

HIV_INTERPRETATION = (
    "1. The test can detect HIV-1/2 antibodies in human serum or plasma if present.\n"
    "2. Test can differentiate between HIV-1 & HIV-2 antibodies if present.\n"
    "3. Negative test result indicates antibody is not detected against HIV-1/2.\n"
    "4. As per local regulatory guidelines, all initial reactive results by primary method are subjected to "
    "further testing by one or two additional methods (Strategies II & III, NACO guidelines 2007) and final "
    "report is issued in accordance with the same.\n"
    "5. Indeterminate test result indicates antibody to HIV-1/2 have been detected in the sample by two methods "
    "but not detected by the third method.\n"
    "6. For Indeterminate result, repeat testing after 2-4 weeks and confirmatory test like RT PCR or western blot is recommended."
)


def _upsert_parameters(test, rows):
    """Replace all parameters for a test with the given rows."""
    LabTestParameter.objects.filter(test=test).delete()
    for (name, code, unit, ref_range, ref_low, ref_high, method, section, sort, rtype) in rows:
        LabTestParameter.objects.create(
            test=test,
            name=name,
            code=code,
            unit=unit,
            reference_range=ref_range,
            ref_low=ref_low,
            ref_high=ref_high,
            method=method,
            section_title=section,
            sort_order=sort,
            result_type=rtype,
        )


class Command(BaseCommand):
    help = "Seed demo lab test templates (CBC + Widal + HBsAg + HCV + HIV rapid cards)"

    def add_arguments(self, parser):
        parser.add_argument("--hospital-id", type=str, help="UUID of the hospital (defaults to first)")
        parser.add_argument(
            "--overwrite",
            action="store_true",
            help="Update existing CBC/Widal templates and replace their parameters",
        )

    def handle(self, *args, **options):
        hosp_id = options.get("hospital_id")
        overwrite = options.get("overwrite", False)
        if hosp_id:
            hospital = Hospital.objects.get(id=hosp_id)
        else:
            hospital = Hospital.objects.first()

        if not hospital:
            self.stderr.write("No hospital found. Create one first.")
            return

        self.stdout.write(f"Seeding templates for: {hospital}")

        # ── Categories
        haem, _ = LabTestCategory.objects.get_or_create(hospital=hospital, name="Haematology")
        immuno, _ = LabTestCategory.objects.get_or_create(hospital=hospital, name="Immunology - Serology")
        serology, _ = LabTestCategory.objects.get_or_create(hospital=hospital, name="Serology")

        # ── CBC Panel (SONAL report layout)
        cbc = LabTest.objects.filter(hospital=hospital, code__iexact="CBC").first()
        if not cbc:
            cbc = LabTest.objects.filter(hospital=hospital, name__iexact="COMPLETE BLOOD COUNT (CBC)").first()
        if not cbc:
            cbc = LabTest.objects.create(
                hospital=hospital,
                category=haem,
                name="COMPLETE BLOOD COUNT (CBC)",
                code="CBC",
                price=350,
                is_group_test=True,
                sample_type="WHOLE BLOOD EDTA",
                method="Automated Haematology Analyser",
                department_label="HEMATOLOGY",
                interpretation="CBC is used as a screening tool in the diagnosis or monitoring of many diseases.",
                is_active=True,
            )
            _upsert_parameters(cbc, CBC_PARAMETERS)
            self.stdout.write(f"  Created CBC panel with {len(CBC_PARAMETERS)} parameters")
        elif overwrite or cbc.parameters.count() == 0:
            cbc.category = haem
            cbc.name = "COMPLETE BLOOD COUNT (CBC)"
            cbc.code = "CBC"
            cbc.price = 350
            cbc.is_group_test = True
            cbc.sample_type = "WHOLE BLOOD EDTA"
            cbc.method = "Automated Haematology Analyser"
            cbc.department_label = "HEMATOLOGY"
            cbc.interpretation = "CBC is used as a screening tool in the diagnosis or monitoring of many diseases."
            cbc.is_active = True
            cbc.save()
            _upsert_parameters(cbc, CBC_PARAMETERS)
            self.stdout.write(f"  Updated CBC panel with {len(CBC_PARAMETERS)} parameters")
        else:
            self.stdout.write("  CBC already exists — skipped (pass --overwrite to refresh)")

        # ── Widal Test (SONAL report layout)
        widal = LabTest.objects.filter(hospital=hospital, code__iexact="WID").first()
        if not widal:
            widal = LabTest.objects.filter(hospital=hospital, name__icontains="Widal").first()
        if not widal:
            widal = LabTest.objects.create(
                hospital=hospital,
                category=serology,
                name="Widal Test (Slide agglutination)",
                code="WID",
                price=200,
                is_group_test=True,
                sample_type="SERUM",
                method="Slide agglutination based assay",
                department_label="SEROLOGY",
                interpretation=WIDAL_INTERPRETATION,
                is_active=True,
            )
            _upsert_parameters(widal, WIDAL_PARAMETERS)
            self.stdout.write(f"  Created Widal with {len(WIDAL_PARAMETERS)} parameters")
        elif overwrite or widal.parameters.count() == 0:
            widal.category = serology
            widal.name = "Widal Test (Slide agglutination)"
            widal.code = "WID"
            widal.price = 200
            widal.is_group_test = True
            widal.sample_type = "SERUM"
            widal.method = "Slide agglutination based assay"
            widal.department_label = "SEROLOGY"
            widal.interpretation = WIDAL_INTERPRETATION
            widal.is_active = True
            widal.save()
            _upsert_parameters(widal, WIDAL_PARAMETERS)
            self.stdout.write(f"  Updated Widal with {len(WIDAL_PARAMETERS)} parameters")
        else:
            self.stdout.write("  Widal already exists — skipped (pass --overwrite to refresh)")

        # ── HBsAg Rapid
        hbsag, created = LabTest.objects.get_or_create(
            hospital=hospital,
            name="HEPATITIS B SURFACE ANTIGEN - RAPID CARD",
            defaults=dict(
                category=immuno,
                code="HBSAG-RAPID",
                price=150,
                is_group_test=False,
                sample_type="SERUM",
                method="Immunochromatography",
                department_label="SEROLOGY",
                interpretation=HBSAG_INTERPRETATION,
                is_active=True,
            ),
        )
        if created:
            LabTestParameter.objects.create(
                test=hbsag,
                name="Hepatitis B Surface Antigen Rapid",
                unit="", reference_range="NEGATIVE",
                ref_low=None, ref_high=None,
                method="Immunochromatography",
                sort_order=1, result_type="qualitative",
            )
            self.stdout.write("  Created HBsAg Rapid")
        else:
            self.stdout.write("  HBsAg already exists — skipped")

        # ── HCV Rapid
        hcv, created = LabTest.objects.get_or_create(
            hospital=hospital,
            name="HCV ANTIBODY CARD",
            defaults=dict(
                category=immuno,
                code="HCV-RAPID",
                price=150,
                is_group_test=False,
                sample_type="SERUM",
                method="Immunochromatography",
                department_label="SEROLOGY",
                is_active=True,
            ),
        )
        if created:
            LabTestParameter.objects.create(
                test=hcv,
                name="HCV ANTIBODY",
                unit="", reference_range="NON-REACTIVE",
                ref_low=None, ref_high=None,
                method="Immunochromatography",
                sort_order=1, result_type="qualitative",
            )
            self.stdout.write("  Created HCV Rapid")
        else:
            self.stdout.write("  HCV already exists — skipped")

        # ── HIV 1&2 Rapid
        hiv, created = LabTest.objects.get_or_create(
            hospital=hospital,
            name="HIV 1&2 RAPID",
            defaults=dict(
                category=immuno,
                code="HIV-RAPID",
                price=200,
                is_group_test=False,
                sample_type="SERUM",
                method="Immunochromatography",
                department_label="SEROLOGY",
                interpretation=HIV_INTERPRETATION,
                is_active=True,
            ),
        )
        if created:
            LabTestParameter.objects.create(
                test=hiv,
                name="HIV (RAPID CARD TEST)",
                unit="", reference_range="Non-Reactive",
                ref_low=None, ref_high=None,
                method="Immunochromatography",
                sort_order=1, result_type="qualitative",
            )
            self.stdout.write("  Created HIV 1&2 Rapid")
        else:
            self.stdout.write("  HIV already exists — skipped")

        self.stdout.write(self.style.SUCCESS("Done! Open Lab Portal > Test Templates to verify."))
