import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { Plus, Eye, Edit, Trash2, Building2, Briefcase, Building } from 'lucide-react'
import Layout from '../components/Layout'

export default function OfferTemplates() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState('create') // 'create', 'edit', 'view'
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [formData, setFormData] = useState({
    // Basic Info
    name: '',
    content: '',
    
    // Company Details
    company_name: '',
    company_address: '',
    company_email: '',
    company_phone: '',
    company_logo: null,
    
    // HR Details
    hr_name: '',
    hr_designation: '',
    hr_signature: null,
    
    // Job Defaults
    job_title: '',
    department: '',
    job_location: '',
    employment_type: 'full_time',
    
    // Salary Defaults
    default_ctc: '',
    default_basic_salary: '',
    default_hra: '',
    default_allowances: '',
    default_bonus: '',
    
    // Work Details
    default_work_shift: '',
    default_working_hours: '',
    default_weekly_off: 'Saturday, Sunday',
    
    // Policies
    default_probation_period: '6 months',
    default_notice_period: '30 days',
    terms_conditions: 'This offer is subject to satisfactory completion of background verification and submission of required documents.',
  })
  
  const [errors, setErrors] = useState({})
  const [successMessage, setSuccessMessage] = useState('')
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    fetchTemplates()
  }, [])

  const fetchTemplates = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('access')
      const response = await axios.get('/api/v1/hr/offer-templates/', {
        headers: { Authorization: `Bearer ${token}` }
      })
      setTemplates(response.data)
    } catch (error) {
      console.error('Error fetching templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (e) => {
    const { name, value, files } = e.target
    if (files) {
      setFormData({ ...formData, [name]: files[0] })
    } else {
      setFormData({ ...formData, [name]: value })
    }
  }

  const validateForm = () => {
    const newErrors = {}
    
    // Required fields
    if (!formData.name.trim()) newErrors.name = 'Template name is required'
    if (!formData.company_name.trim()) newErrors.company_name = 'Company name is required'
    if (!formData.job_title.trim()) newErrors.job_title = 'Job title is required'
    
    // Email validation
    if (formData.company_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.company_email)) {
      newErrors.company_email = 'Invalid email format'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!validateForm()) return

    try {
      const token = localStorage.getItem('access')
      const data = new FormData()
      
      // Append all form fields
      Object.keys(formData).forEach(key => {
        if (formData[key] !== null && formData[key] !== '') {
          if (formData[key] instanceof File) {
            data.append(key, formData[key])
          } else {
            data.append(key, formData[key])
          }
        }
      })

      if (modalMode === 'create') {
        await axios.post('/api/v1/hr/offer-templates/', data, {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data'
          }
        })
        setSuccessMessage('Template created successfully!')
      } else {
        await axios.put(`/api/v1/hr/offer-templates/${selectedTemplate.id}/`, data, {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data'
          }
        })
        setSuccessMessage('Template updated successfully!')
      }

      setShowModal(false)
      fetchTemplates()
      resetForm()
      
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (error) {
      console.error('Error saving template:', error)
      setErrors({ submit: 'Failed to save template. Please try again.' })
    }
  }

  const handleDelete = async (templateId) => {
    if (!window.confirm('Are you sure you want to delete this template?')) return

    try {
      setDeleting(templateId)
      const token = localStorage.getItem('access')
      await axios.delete(`/api/v1/hr/offer-templates/${templateId}/`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setSuccessMessage('Template deleted successfully!')
      fetchTemplates()
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (error) {
      console.error('Error deleting template:', error)
      alert('Failed to delete template')
    } finally {
      setDeleting(null)
    }
  }

  const handleView = (template) => {
    setSelectedTemplate(template)
    setFormData({
      // Basic Info
      name: template.name || '',
      content: template.content || '',
      
      // Company Details
      company_name: template.company_name || '',
      company_address: template.company_address || '',
      company_email: template.company_email || '',
      company_phone: template.company_phone || '',
      company_logo: null,
      
      // HR Details
      hr_name: template.hr_name || '',
      hr_designation: template.hr_designation || '',
      hr_signature: null,
      
      // Job Defaults
      job_title: template.job_title || '',
      department: template.department || '',
      job_location: template.job_location || '',
      employment_type: template.employment_type || 'full_time',
      
      // Salary Defaults
      default_ctc: template.default_ctc || '',
      default_basic_salary: template.default_basic_salary || '',
      default_hra: template.default_hra || '',
      default_allowances: template.default_allowances || '',
      default_bonus: template.default_bonus || '',
      
      // Work Details
      default_work_shift: template.default_work_shift || '',
      default_working_hours: template.default_working_hours || '',
      default_weekly_off: template.default_weekly_off || 'Saturday, Sunday',
      
      // Policies
      default_probation_period: template.default_probation_period || '6 months',
      default_notice_period: template.default_notice_period || '30 days',
      terms_conditions: template.terms_conditions || '',
    })
    setModalMode('view')
    setShowModal(true)
  }

  const handleEdit = (template) => {
    handleView(template)
    setModalMode('edit')
  }

  const resetForm = () => {
    setFormData({
      name: '',
      content: '',
      company_name: '',
      company_address: '',
      company_email: '',
      company_phone: '',
      company_logo: null,
      hr_name: '',
      hr_designation: '',
      hr_signature: null,
      job_title: '',
      department: '',
      job_location: '',
      employment_type: 'full_time',
      default_ctc: '',
      default_basic_salary: '',
      default_hra: '',
      default_allowances: '',
      default_bonus: '',
      default_work_shift: '',
      default_working_hours: '',
      default_weekly_off: 'Saturday, Sunday',
      default_probation_period: '6 months',
      default_notice_period: '30 days',
      terms_conditions: 'This offer is subject to satisfactory completion of background verification and submission of required documents.',
    })
    setErrors({})
    setSelectedTemplate(null)
  }

  const openCreateModal = () => {
    resetForm()
    setModalMode('create')
    setShowModal(true)
  }

  return (
    <Layout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Offer Templates</h1>
            <p className="text-gray-600 mt-1">Manage offer letter templates for your organization</p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Template
          </button>
        </div>

        {/* Success Message */}
        {successMessage && (
          <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg">
            {successMessage}
          </div>
        )}

        {/* Template List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
            <p className="mt-2 text-gray-600">Loading templates...</p>
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <Briefcase className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Templates Found</h3>
            <p className="text-gray-600 mb-4">Create your first offer template to get started</p>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Create Template
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
              <div key={template.id} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-emerald-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{template.name}</h3>
                        <p className="text-sm text-gray-600">{template.job_title}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Building className="w-4 h-4" />
                      <span>{template.department}</span>
                    </div>
                    {template.employment_type && (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Briefcase className="w-4 h-4" />
                        <span className="capitalize">{template.employment_type.replace('_', ' ')}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => handleView(template)}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      View
                    </button>
                    <button
                      onClick={() => handleEdit(template)}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      disabled={deleting === template.id}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      {deleting === template.id ? '...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Template Form Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto my-4">
              <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">
                  {modalMode === 'create' ? 'Create Template' : modalMode === 'edit' ? 'Edit Template' : 'View Template'}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {/* Error Message */}
                {errors.submit && (
                  <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg">
                    {errors.submit}
                  </div>
                )}

                {/* Basic Info */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Basic Information</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Template Name *</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                      placeholder="e.g., Software Engineer Offer"
                    />
                    {errors.name && <p className="text-red-600 text-sm mt-1">{errors.name}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
                    <textarea
                      name="content"
                      value={formData.content}
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      rows={4}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                      placeholder="Template content with placeholders: {candidate_name}, {job_title}, etc."
                    />
                  </div>
                </div>

                {/* Company Details */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Company Details</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                    <input
                      type="text"
                      name="company_name"
                      value={formData.company_name}
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                      placeholder="e.g., Acme Corporation"
                    />
                    {errors.company_name && <p className="text-red-600 text-sm mt-1">{errors.company_name}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company Address</label>
                    <textarea
                      name="company_address"
                      value={formData.company_address}
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                      placeholder="Full company address"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Company Email</label>
                      <input
                        type="email"
                        name="company_email"
                        value={formData.company_email}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="hr@company.com"
                      />
                      {errors.company_email && <p className="text-red-600 text-sm mt-1">{errors.company_email}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Company Phone</label>
                      <input
                        type="text"
                        name="company_phone"
                        value={formData.company_phone}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="+91 1234567890"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company Logo</label>
                    <input
                      type="file"
                      name="company_logo"
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      accept="image/*"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                    />
                    {selectedTemplate?.company_logo && (
                      <div className="mt-2">
                        <img src={selectedTemplate.company_logo} alt="Current logo" className="h-16 w-auto" />
                      </div>
                    )}
                  </div>
                </div>

                {/* HR Details */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">HR Details</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">HR Name</label>
                    <input
                      type="text"
                      name="hr_name"
                      value={formData.hr_name}
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">HR Designation</label>
                    <input
                      type="text"
                      name="hr_designation"
                      value={formData.hr_designation}
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                      placeholder="HR Manager"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">HR Signature</label>
                    <input
                      type="file"
                      name="hr_signature"
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      accept="image/*"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                    />
                    {selectedTemplate?.hr_signature && (
                      <div className="mt-2">
                        <img src={selectedTemplate.hr_signature} alt="Current signature" className="h-16 w-auto" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Job Defaults */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Job Defaults</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Job Title *</label>
                    <input
                      type="text"
                      name="job_title"
                      value={formData.job_title}
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                      placeholder="e.g., Software Engineer"
                    />
                    {errors.job_title && <p className="text-red-600 text-sm mt-1">{errors.job_title}</p>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                      <input
                        type="text"
                        name="department"
                        value={formData.department}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., Engineering"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                      <input
                        type="text"
                        name="job_location"
                        value={formData.job_location}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., Bangalore"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Employment Type</label>
                    <select
                      name="employment_type"
                      value={formData.employment_type}
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                    >
                      <option value="full_time">Full Time</option>
                      <option value="part_time">Part Time</option>
                      <option value="contract">Contract</option>
                      <option value="internship">Internship</option>
                    </select>
                  </div>
                </div>

                {/* Salary Defaults */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Salary Defaults</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Default CTC</label>
                      <input
                        type="number"
                        name="default_ctc"
                        value={formData.default_ctc}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., 1200000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Basic Salary</label>
                      <input
                        type="number"
                        name="default_basic_salary"
                        value={formData.default_basic_salary}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., 600000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">HRA</label>
                      <input
                        type="number"
                        name="default_hra"
                        value={formData.default_hra}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., 240000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Allowances</label>
                      <input
                        type="number"
                        name="default_allowances"
                        value={formData.default_allowances}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., 300000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bonus</label>
                      <input
                        type="number"
                        name="default_bonus"
                        value={formData.default_bonus}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., 60000"
                      />
                    </div>
                  </div>
                </div>

                {/* Work Details */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Work Details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Work Shift</label>
                      <input
                        type="text"
                        name="default_work_shift"
                        value={formData.default_work_shift}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., 9 AM - 6 PM"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Working Hours</label>
                      <input
                        type="text"
                        name="default_working_hours"
                        value={formData.default_working_hours}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., 8 hours"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Weekly Off</label>
                      <input
                        type="text"
                        name="default_weekly_off"
                        value={formData.default_weekly_off}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., Saturday, Sunday"
                      />
                    </div>
                  </div>
                </div>

                {/* Policies */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Policies</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Probation Period</label>
                      <input
                        type="text"
                        name="default_probation_period"
                        value={formData.default_probation_period}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., 6 months"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Notice Period</label>
                      <input
                        type="text"
                        name="default_notice_period"
                        value={formData.default_notice_period}
                        onChange={handleInputChange}
                        disabled={modalMode === 'view'}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                        placeholder="e.g., 30 days"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Terms & Conditions</label>
                    <textarea
                      name="terms_conditions"
                      value={formData.terms_conditions}
                      onChange={handleInputChange}
                      disabled={modalMode === 'view'}
                      rows={4}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                      placeholder="Terms and conditions for the offer"
                    />
                  </div>
                </div>

                {/* Actions */}
                {modalMode !== 'view' && (
                  <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                    >
                      {modalMode === 'create' ? 'Create Template' : 'Update Template'}
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
