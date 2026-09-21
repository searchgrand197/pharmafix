import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { LineChart } from 'lucide-react';
import ReusableTable from '../../components/HR/ReusableTable';
import ReusableCard from '../../components/HR/ReusableCard';

export default function OperationsPerformancePage() {
  const { theme = 'purple' } = useOutletContext() || {};
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/hr/performance/');
        setReviews(data.results || data);
      } catch {
        toast.error('Failed to load performance reviews');
      }
    })();
  }, []);

  const columns = [
    { header: 'Employee', accessor: 'employee_name' },
    { header: 'Remarks', accessor: 'remarks' },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <ReusableCard title="Performance Reviews" icon={LineChart} theme={theme}>
        <ReusableTable columns={columns} data={reviews} />
      </ReusableCard>
    </div>
  );
}
