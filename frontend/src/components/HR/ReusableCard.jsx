import React from 'react';

export default function ReusableCard({ title, subtitle, icon: Icon, children, headerAction, theme = 'purple' }) {
  const themeClasses = {
    purple: 'bg-purple-100 text-purple-600',
    lightpink: 'bg-pink-100 text-pink-500',
  };

  const activeClass = themeClasses[theme] || themeClasses.purple;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full">
      <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        {Icon && (
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${activeClass}`}>
            <Icon size={16} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-800 text-sm truncate">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
        </div>
        {headerAction && (
          <div className="flex-shrink-0">
            {headerAction}
          </div>
        )}
      </div>
      <div className="p-6 flex-1">
        {children}
      </div>
    </div>
  );
}
