from django.urls import path

from apps.settings_management.pwa_views import PwaManifestView

urlpatterns = [
    path("pwa/manifest/<str:portal>/", PwaManifestView.as_view(), name="pwa-manifest"),
]
