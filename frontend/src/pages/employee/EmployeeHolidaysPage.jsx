import React, { useCallback, useEffect, useMemo, useState } from 'react';

import api from '../../api';

import toast from 'react-hot-toast';

import { CalendarDays, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

import { daysInMonth, monthKey } from '../../utils/attendanceCalendar';



const SCOPE_STYLES = {

  national: 'bg-blue-100 text-blue-900 border-blue-200',

  festival: 'bg-amber-100 text-amber-900 border-amber-200',

  organization: 'bg-violet-100 text-violet-900 border-violet-200',

};



const CALENDAR_DOT = {

  national: 'bg-blue-500',

  festival: 'bg-amber-500',

  organization: 'bg-violet-500',

};



function formatHolidayDate(iso) {

  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {

    weekday: 'short',

    month: 'short',

    day: 'numeric',

    year: 'numeric',

  });

}



function TouchButton({ children, className = '', ...props }) {

  return (

    <button

      type="button"

      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${className}`}

      {...props}

    >

      {children}

    </button>

  );

}



function HolidayCard({ row }) {

  const style = SCOPE_STYLES[row.scope] || SCOPE_STYLES.organization;

  return (

    <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">

      <div className="flex flex-wrap items-start justify-between gap-2">

        <div className="min-w-0 flex-1">

          <p className="font-semibold text-gray-900">{row.name}</p>

          <p className="mt-1 text-sm text-gray-600">{formatHolidayDate(row.date)}</p>

          {row.description ? (

            <p className="mt-2 text-sm text-gray-500">{row.description}</p>

          ) : null}

        </div>

        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${style}`}>

          {row.scope_display || row.scope}

        </span>

      </div>

    </article>

  );

}



export default function EmployeeHolidaysPage() {

  const [tab, setTab] = useState('month');

  const [month, setMonth] = useState(monthKey());

  const [monthRows, setMonthRows] = useState([]);

  const [upcomingRows, setUpcomingRows] = useState([]);

  const [loading, setLoading] = useState(true);

  const [selectedIso, setSelectedIso] = useState(null);



  const [year, mon] = useMemo(() => month.split('-').map(Number), [month]);



  const holidaysByDate = useMemo(() => {

    const map = {};

    monthRows.forEach((row) => {

      if (!map[row.date]) map[row.date] = [];

      map[row.date].push(row);

    });

    return map;

  }, [monthRows]);



  const calendarDays = useMemo(() => {

    const total = daysInMonth(year, mon);

    const days = [];

    for (let d = 1; d <= total; d += 1) {

      const iso = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      days.push({ iso, day: d, holidays: holidaysByDate[iso] || [] });

    }

    return days;

  }, [holidaysByDate, mon, year]);



  const firstWeekday = new Date(year, mon - 1, 1).getDay();

  const calendarCells = useMemo(() => {

    const cells = [];

    for (let i = 0; i < firstWeekday; i += 1) cells.push(null);

    calendarDays.forEach((item) => cells.push(item));

    return cells;

  }, [calendarDays, firstWeekday]);



  const selectedHolidays = selectedIso ? (holidaysByDate[selectedIso] || []) : [];



  const load = useCallback(async () => {

    setLoading(true);

    try {

      const [monthRes, upcomingRes] = await Promise.all([

        api.get('/employee-portal/holidays/', { params: { month } }),

        api.get('/employee-portal/holidays/', { params: { upcoming: true } }),

      ]);

      setMonthRows(monthRes.data.results || []);

      setUpcomingRows(upcomingRes.data.results || []);

    } catch {

      toast.error('Failed to load holidays');

      setMonthRows([]);

      setUpcomingRows([]);

    } finally {

      setLoading(false);

    }

  }, [month]);



  useEffect(() => {

    document.title = 'Holidays | Employee Portal';

    load();

  }, [load]);



  function shiftMonth(delta) {

    const dt = new Date(year, mon - 1 + delta, 1);

    setMonth(monthKey(dt));

    setSelectedIso(null);

  }



  const monthLabel = new Date(year, mon - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  const todayIso = new Date().toISOString().slice(0, 10);



  return (

    <div className="mx-auto w-full max-w-lg space-y-4 overflow-x-hidden pb-8">

      <header>

        <h1 className="text-xl font-bold text-gray-900">Holiday Calendar</h1>

        <p className="mt-1 text-sm text-gray-600">National, festival, and organization holidays.</p>

      </header>



      <div className="flex flex-wrap gap-2">

        <TouchButton

          onClick={() => setTab('month')}

          className={tab === 'month' ? 'bg-teal-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}

        >

          <CalendarDays size={16} /> Monthly Calendar

        </TouchButton>

        <TouchButton

          onClick={() => setTab('upcoming')}

          className={tab === 'upcoming' ? 'bg-teal-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}

        >

          <Sparkles size={16} /> Upcoming

        </TouchButton>

      </div>



      {tab === 'month' && (

        <>

          <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-3 py-2">

            <TouchButton onClick={() => shiftMonth(-1)} className="min-w-[44px] border border-gray-200 p-2">

              <ChevronLeft size={16} />

            </TouchButton>

            <span className="text-sm font-semibold text-gray-900">{monthLabel}</span>

            <TouchButton onClick={() => shiftMonth(1)} className="min-w-[44px] border border-gray-200 p-2">

              <ChevronRight size={16} />

            </TouchButton>

          </div>



          {loading ? (

            <div className="h-56 animate-pulse rounded-2xl bg-gray-100" />

          ) : (

            <section className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">

              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-gray-400">

                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (

                  <div key={label} className="py-1">{label}</div>

                ))}

              </div>

              <div className="mt-1 grid grid-cols-7 gap-1">

                {calendarCells.map((cell, idx) => {

                  if (!cell) {

                    return <div key={`empty-${idx}`} className="aspect-square" />;

                  }

                  const hasHoliday = cell.holidays.length > 0;

                  const primary = cell.holidays[0];

                  const isToday = cell.iso === todayIso;

                  const isSelected = cell.iso === selectedIso;

                  return (

                    <button

                      key={cell.iso}

                      type="button"

                      onClick={() => setSelectedIso(cell.iso)}

                      className={[

                        'relative flex aspect-square flex-col items-center justify-center rounded-lg border text-xs font-semibold transition',

                        hasHoliday ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-gray-100 bg-white text-gray-700',

                        isToday ? 'ring-2 ring-teal-500 ring-offset-1' : '',

                        isSelected ? 'ring-2 ring-indigo-500 ring-offset-1' : '',

                      ].join(' ')}

                      title={hasHoliday ? cell.holidays.map((h) => h.name).join(', ') : cell.iso}

                    >

                      <span>{cell.day}</span>

                      {hasHoliday && (

                        <span

                          className={`mt-0.5 h-1.5 w-1.5 rounded-full ${CALENDAR_DOT[primary.scope] || CALENDAR_DOT.organization}`}

                        />

                      )}

                    </button>

                  );

                })}

              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-gray-500">

                {Object.entries(CALENDAR_DOT).map(([scope, cls]) => (

                  <span key={scope} className="inline-flex items-center gap-1">

                    <span className={`h-2 w-2 rounded-full ${cls}`} />

                    {scope}

                  </span>

                ))}

              </div>

            </section>

          )}



          {selectedIso && selectedHolidays.length > 0 && (

            <section className="space-y-2">

              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">

                {formatHolidayDate(selectedIso)}

              </p>

              {selectedHolidays.map((row) => (

                <HolidayCard key={row.id} row={row} />

              ))}

            </section>

          )}



          {!loading && monthRows.length > 0 && (

            <section className="space-y-3">

              <h2 className="text-sm font-semibold text-gray-900">All holidays in {monthLabel}</h2>

              {monthRows.map((row) => (

                <HolidayCard key={row.id} row={row} />

              ))}

            </section>

          )}



          {!loading && monthRows.length === 0 && (

            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">

              No holidays in {monthLabel}.

            </div>

          )}

        </>

      )}



      {tab === 'upcoming' && (

        <>

          {loading ? (

            <div className="space-y-3">

              {Array.from({ length: 4 }).map((_, i) => (

                <div key={i} className="h-16 animate-pulse rounded-2xl bg-gray-100" />

              ))}

            </div>

          ) : upcomingRows.length === 0 ? (

            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">

              No upcoming holidays scheduled.

            </div>

          ) : (

            <section className="space-y-3">

              {upcomingRows.map((row) => (

                <HolidayCard key={row.id} row={row} />

              ))}

            </section>

          )}

        </>

      )}

    </div>

  );

}

