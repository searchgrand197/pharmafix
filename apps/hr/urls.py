from django.urls import path
from apps.hr import views

app_name = 'hr'

urlpatterns = [
    path('dashboard/', views.hr_dashboard_view, name='dashboard'),
    path('verification/', views.hr_document_verification_view, name='verification-dashboard'),
    path('jobs/<str:job_code>/apply', views.apply_job, name='apply_job_no_slash'),
    path('jobs/<str:job_code>/apply/', views.apply_job, name='apply_job'),
    path('hr/jobs/<str:job_code>/apply', views.redirect_public_job_apply, name='apply_job_hr_redirect_no_slash'),
    path('hr/jobs/<str:job_code>/apply/', views.redirect_public_job_apply, name='apply_job_hr_redirect'),
    path('hr/onboarding/<uuid:token>/', views.onboarding_document_upload_view, name='onboarding-upload'),
    path('api/onboarding/upload-document/', views.onboarding_upload_document_api, name='onboarding-upload-api'),
    path('api/onboarding/get-documents/<uuid:token>/', views.onboarding_get_documents_api, name='onboarding-get-documents'),
    path(
        'api/onboarding/files/<uuid:token>/<uuid:requirement_id>/<str:action>/',
        views.onboarding_document_file_api,
        name='onboarding-document-file',
    ),
    path(
        'api/onboarding/files/<uuid:token>/<uuid:requirement_id>/versions/<uuid:version_id>/<str:action>/',
        views.onboarding_document_version_file_api,
        name='onboarding-document-version-file',
    ),
    path('api/onboarding/complete/', views.onboarding_complete_api, name='onboarding-complete'),
    path('api/verification/employees/', views.verification_get_employees_api, name='verification-employees'),
    path('api/verification/employee/<int:employee_id>/documents/', views.verification_get_employee_documents_api, name='verification-employee-documents'),
    path('api/verification/document/<int:document_id>/approve/', views.verification_approve_document_api, name='verification-approve-document'),
    path('api/verification/document/<int:document_id>/reject/', views.verification_reject_document_api, name='verification-reject-document'),
    path('api/verification/document/<int:document_id>/request-reupload/', views.verification_request_reupload_api, name='verification-request-reupload'),
    path('api/verification/employee/<int:employee_id>/mark-ready/', views.verification_mark_ready_to_join_api, name='verification-mark-ready'),
    path('api/verification/summary/', views.verification_get_summary_api, name='verification-summary'),
    path('onboarding/success/', views.onboarding_success_view, name='onboarding-success'),
]
