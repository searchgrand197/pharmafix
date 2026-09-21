import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HRPageWrapper from '../components/HR/HRPageWrapper';
import api from '../api';
import toast from 'react-hot-toast';
import { Briefcase, ArrowLeft, XCircle } from 'lucide-react';
import HRForm from '../components/HR/HRForm';
import ReusableCard from '../components/HR/ReusableCard';

export default function DepartmentForm() {
  const navigate = useNavigate();
  const [formLoading, setFormLoading] = useState(false);

  const handleSubmit = async (data) => {
    setFormLoading(true);

    try {
      await api.post('/hr/departments/', { name: data.name });
      toast.success('Department created successfully');
      navigate('/hr/operations/departments');
    } catch (error) {
      console.error('Error creating department:', error);
      const message = error.response?.data?.detail || 
                      Object.values(error.response?.data || {})[0]?.[0] || 
                      'Failed to create department';
      toast.error(message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleCancel = () => {
    navigate('/hr/operations/departments');
  };

  const formFields = [
    { name: 'name', label: 'Department Name', type: 'text', required: true, placeholder: 'e.g., Cardiology, Nursing, HR' },
  ];

  return (
    <HRPageWrapper color="purple" layoutSidebar={true}>
      <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* Back Button */}
        <div className="mb-6">
          <button
            onClick={() => navigate('/hr/operations/departments')}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Departments
          </button>
        </div>

        <ReusableCard
          title="Create Department"
          icon={Briefcase}
          theme="purple"
          headerAction={
            <button
              onClick={handleCancel}
              className="text-gray-500 hover:text-gray-700"
            >
              <XCircle size={20} />
            </button>
          }
        >
          <HRForm
            fields={formFields}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            submitLabel="Create Department"
            theme="purple"
            loading={formLoading}
          />
        </ReusableCard>
      </div>
    </HRPageWrapper>
  );
}
