import Layout from '../Layout';
import { useOutletContext } from 'react-router-dom';

export default function HRPageWrapper({
  title,
  subtitle,
  color = 'purple',
  headerExtra,
  layoutSidebar = false,
  children,
}) {
  const ctx = useOutletContext();

  if (ctx?.hrShell) {
    const showChrome = Boolean(title || subtitle || headerExtra);
    return (
      <div>
        {showChrome && (
          <div className="mb-4 flex flex-col gap-2 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {title ? <h1 className="text-lg font-bold text-gray-900">{title}</h1> : null}
              {subtitle ? <p className="text-sm text-gray-600">{subtitle}</p> : null}
            </div>
            {headerExtra ? <div className="flex shrink-0 flex-wrap gap-2">{headerExtra}</div> : null}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <Layout
      title={title}
      subtitle={subtitle}
      color={color}
      headerExtra={headerExtra}
      sidebar={layoutSidebar}
    >
      {children}
    </Layout>
  );
}
