# Attendance Refactor Report

**Date:** 2026-06-04  
**Scope:** Simulator consistency, grace configuration, in-progress checkout, UI timezone display, analytics alignment.

---

## 1. Current behavior (before this refactor)

| Area | Behavior |
|------|----------|
| Simulator (Check in/out) | `timezone.now()` only in UI; API allowed optional `timestamp` but UI did not send it |
| Bulk mark (Advanced) | Manual `check_in` / `check_out` on selected `date` |
| `late_minutes` | Always minutes after **shift start**; grace only affected **status** `late` |
| Open IN, no OUT | Immediate `incomplete` + `incomplete_checkout=True`; UI showed "MISSING" |
| Shift times | DB: 24h `TimeField`; UI: browser-dependent |
| Hospital TZ | Django `TIME_ZONE` (default `Asia/Kolkata`); `Hospital.timezone` unused |
| Dashboard correction | Could set summary fields without recalculating from punches |

---

## 2. Recommended behavior (implemented)

| Area | Behavior |
|------|----------|
| Simulator | **Default:** live tap uses server time (real device). **Optional:** HR can set custom punch datetime (same validation as bulk). Shared punch + recalc path as bulk mark. |
| Bulk mark | Unchanged contract; shares `record_simulation_punch()` with simulator |
| `late_minutes` | Configurable via `ATTENDANCE_LATE_MINUTES_BASIS`: `shift_start` (default) or `after_grace` |
| Open IN, no OUT | **`in_progress`** before shift end; **`missing_checkout`** after shift end |
| Shift times | DB stays 24h; UI helpers can show 12h AM/PM for display |
| Analytics | Counts `in_progress` and `missing_checkout`; engine is single source for `DailyAttendance` |
| Policy API | `GET /api/v1/hr/daily-attendance/policy/` returns active rules for UI |

---

## 3. Migration / data impact

| Change | Impact | Destructive? |
|--------|--------|--------------|
| New status values `in_progress`, `missing_checkout` | CharField — no column change; migration updates choices metadata only | **No** |
| Recalculate existing rows | Old `incomplete` + open IN may become `in_progress` / `missing_checkout` after **Rebuild & refresh** or `recalculate` | **No** — status label change only |
| `late_minutes` with `after_grace` | If env switched, recalc changes stored `late_minutes` for same punches | **No** — configurable, documented |
| Simulator optional time | New punches only; past punches unchanged | **No** |

**Recommended ops after deploy:**

1. Set `ATTENDANCE_LATE_MINUTES_BASIS` in `.env` if you want payroll-style late (after grace).
2. HR → Attendance dashboard → **Refresh** (force rebuild) for recent dates.
3. Calendar → **Rebuild & refresh** for current month.

**No automatic data wipe or punch deletion.**

---

## 4. Enterprise recommendation: simulator time

**Chosen approach:** Live tap = `timezone.now()` (authentic device behavior) + **optional HR override** on the same API for testing/corrections. Bulk mark continues to use explicit times on the working date. Both call **`record_simulation_punch()`** then **`recalculate_daily_attendance()`**.

---

## 5. Grace period configuration

| Value | `late_minutes` meaning | Status `late` when |
|-------|------------------------|-------------------|
| `shift_start` (default) | Minutes after scheduled start | Check-in after start + grace |
| `after_grace` | Minutes after grace deadline only | Check-in after grace deadline |

Set in `.env`:

```env
ATTENDANCE_LATE_MINUTES_BASIS=shift_start
# or
ATTENDANCE_LATE_MINUTES_BASIS=after_grace
```

---

## 6. Consistency checklist

| Consumer | Source |
|----------|--------|
| Attendance dashboard list/summary | `DailyAttendance` via engine + `build_dashboard_summary` |
| Attendance calendar | `build_calendar_month` + day list from same model |
| Punch simulator console | `get_employee_punch_console_state` after recalc |
| Employee analytics | `build_employee_analytics` recalculates then reads summaries |
| Status labels (UI) | `resolveDisplayAttendanceStatus()` + `attendance_policy` from summary API |

---

## 7. Timezone fix (2026-06-04)

- All shift times and punch wall clocks use **`settings.TIME_ZONE`** (`Asia/Kolkata`), not the browser locale.
- Custom simulator punches send **`punch_date` + `punch_time`** (HH:MM), not `toISOString()` from the browser.
- UI displays check-in/out in the attendance timezone via `timeDisplay.js`.
- Set `TIME_ZONE=Asia/Kolkata` in `.env` and restart Django after deploy.
- **Existing wrong punches** are not auto-migrated: void the punch or bulk-mark with correct times, then refresh attendance.

---

## 8. Post-deploy verification

1. `GET /api/v1/hr/daily-attendance/policy/` — confirm `late_minutes_basis` and timezone.
2. Dashboard **Refresh** (`force=true`) for today — open IN rows should show `in_progress` or `missing_checkout`.
3. Simulator: live tap without override; optional datetime for corrections.
4. No punch deletion or bulk status wipe was performed.

---

## 8. Files touched

- `apps/hr/attendance_policy.py` (new)
- `apps/hr/attendance_engine.py`
- `apps/hr/attendance_control.py`
- `apps/hr/attendance_analytics.py`
- `apps/hr/models.py` (choices)
- `apps/hr/views.py` (policy endpoint, reconciliation)
- `apps/hr/migrations/0064_attendance_in_progress_missing_checkout.py`
- `config/settings_common.py`, `.env.example`
- Frontend: `attendanceControl.js`, `timeDisplay.js`, Attendance Control / Dashboard / Calendar / Shift pages
- Tests: `test_attendance_policy.py`
