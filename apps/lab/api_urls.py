from django.urls import path, include
from rest_framework import routers
from apps.lab.views import (
    LabTestCategoryViewSet,
    LabTestViewSet,
    LabReportViewSet,
    LabTestResultViewSet,
    LabSettingsView,
)

router = routers.DefaultRouter()
router.register(r'lab-categories', LabTestCategoryViewSet)
router.register(r'lab-tests', LabTestViewSet)
router.register(r'lab-reports', LabReportViewSet)
router.register(r'lab-test-results', LabTestResultViewSet)

urlpatterns = [
    path('lab/settings/', LabSettingsView.as_view(), name='lab-settings'),
    path('', include(router.urls)),
]
