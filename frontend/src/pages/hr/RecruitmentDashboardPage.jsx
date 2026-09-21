import { useOutletContext } from 'react-router-dom';
import HRDashboard from '../../components/HR/HRDashboard';

export default function RecruitmentDashboardPage() {
  const ctx = useOutletContext();
  const theme = ctx?.theme || 'purple';
  return (
    <div className="max-w-7xl mx-auto">
      <HRDashboard theme={theme} />
    </div>
  );
}
