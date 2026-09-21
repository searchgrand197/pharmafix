import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 8 }

function ChartCard({ title, children, className = '' }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-100 p-3 ${className}`}>
      <p className="text-[11px] font-semibold text-gray-600 mb-2">{title}</p>
      {children}
    </div>
  )
}

function EmptyChart() {
  return <p className="text-sm text-gray-400 text-center py-12">No data for this period</p>
}

function DailyBarChart({ data, color = '#4f46e5' }) {
  if (!data?.length) return <EmptyChart />
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} width={48} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [`₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'Amount']}
          />
          <Bar dataKey="amount" fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function HorizontalBarChart({ data, dataKey = 'amount', color = '#10b981' }) {
  if (!data?.length) return <EmptyChart />
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
          <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [`₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'Amount']}
          />
          <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ModePieChart({ data }) {
  if (!data?.length) return <EmptyChart />
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={44}
            outerRadius={72}
            paddingAngle={2}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [`₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, '']}
          />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

function CategoryBarChart({ data }) {
  if (!data?.length) return <EmptyChart />
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} width={48} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [`₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'Amount']}
          />
          <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function ReportsCharts({ dataTab, chartBundle, loading }) {
  if (loading) {
    return <p className="p-6 text-center text-gray-400 text-sm">Loading…</p>
  }

  const { opd, slips, ipd, refunds, collection } = chartBundle

  if (dataTab === 'collection') {
    return (
      <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Collection by doctor / Self" className="lg:col-span-2">
          <HorizontalBarChart data={collection.byAttribution} color="#6366f1" />
        </ChartCard>
        <ChartCard title="OPD fees vs payment slips" className="lg:col-span-2 lg:max-w-lg">
          <CategoryBarChart data={collection.opdVsSlips} />
        </ChartCard>
      </div>
    )
  }

  if (dataTab === 'opd') {
    return (
      <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Daily OPD collection" className="lg:col-span-2">
          <DailyBarChart data={opd.daily} color="#3b82f6" />
        </ChartCard>
        <ChartCard title="By department (amount)">
          <HorizontalBarChart data={opd.byDept} color="#3b82f6" />
        </ChartCard>
        <ChartCard title="Payment mode">
          <ModePieChart data={opd.mode} />
        </ChartCard>
      </div>
    )
  }

  if (dataTab === 'slips') {
    return (
      <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Daily slip collection" className="lg:col-span-2">
          <DailyBarChart data={slips.daily} color="#10b981" />
        </ChartCard>
        <ChartCard title="By type (amount)">
          <HorizontalBarChart data={slips.byType} color="#10b981" />
        </ChartCard>
        <ChartCard title="Payment mode">
          <ModePieChart data={slips.mode} />
        </ChartCard>
      </div>
    )
  }

  if (dataTab === 'refunds') {
    return (
      <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Daily refunds" className="lg:col-span-2">
          <DailyBarChart data={refunds.daily} color="#0ea5e9" />
        </ChartCard>
        <ChartCard title="Payment mode" className="lg:col-span-2 lg:max-w-md">
          <ModePieChart data={refunds.mode} />
        </ChartCard>
      </div>
    )
  }

  return (
    <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
      <ChartCard title="Daily IPD advance collection" className="lg:col-span-2">
        <DailyBarChart data={ipd.daily} color="#f59e0b" />
      </ChartCard>
      <ChartCard title="Payment mode" className="lg:col-span-2 lg:max-w-md">
        <ModePieChart data={ipd.mode} />
      </ChartCard>
    </div>
  )
}
