import json

from django.http import HttpResponse
from django.views import View

from apps.settings_management.pwa_manifest import VALID_PORTALS, build_pwa_manifest


class PwaManifestView(View):
    """
    Same-origin PWA manifest (Chrome cannot install with blob: manifest URLs).

    GET /api/v1/pwa/manifest/<portal>/?hospital_id=<uuid>
    """

    def get(self, request, portal: str):
        role_key = portal if portal in VALID_PORTALS else "staff"
        hospital_id = request.GET.get("hospital_id") or request.GET.get("hospital")
        manifest = build_pwa_manifest(role_key, hospital_id)
        body = json.dumps(manifest, ensure_ascii=False)
        response = HttpResponse(body, content_type="application/manifest+json")
        response["Cache-Control"] = "public, max-age=300"
        return response
