# Payroll / Salary Module — Readiness Audit Report

**Audit date:** 2026-06-04  
**Scope:** HR payroll, salary, payslip, and compensation flows in `apps/hr` (+ related frontend)  
**Method:** Code and schema trace only — **no code changes**

---

## Executive summary

| Verdict | Detail |
|---------|--------|
| **Overall payroll readiness** | **Not ready** for production payroll |
| **What exists** | A minimal `Salary` CRUD table, recruitment compensation on `Offer` / `Employee`, and a read-only HR UI |
| **What is missing** | Payroll runs, payslips, tax, structured earnings/deductions, and any engine that consumes `DailyAttendance` / leave for pay |

Attendance and leave modules are **mature relative to payroll** but are **not wired into pay calculation**.

---

## 1. Existing payroll models

| Status | **Missing** |

There is **no** `Payroll`, `PayrollRun`, `PayrollPeriod`, `PayrollLine`, or similar model in the repository.

| Searched | Result |
|----------|--------|
| `apps/hr/models.py` | No payroll-named models |
| `apps/billing/` | No payroll references |
| Migrations / `api_urls` | No payroll routes |

**Related (not payroll):** `apps/attendance/` is the **HMS staff** attendance module (designations, earned leave allocations) — separate from HR `DailyAttendance`.

---

## 2. Existing salary models

| Status | **Partially implemented** |

### `hr.Salary` (`apps/hr/models.py`)

| Field | Type | Notes |
|-------|------|--------|
| `employee` | FK → `Employee` | `related_name='salary_records'` |
| `basic_pay` | Decimal | Required |
| `allowance` | Decimal | Default 0 |
| `deductions` | Decimal | Single lump sum, not line items |
| `overtime` | Decimal | Manual amount, not computed from attendance |
| `month` | DateField | Period anchor (no `unique_together` with employee) |

**Gaps:** No `gross_pay`, `net_pay`, `status`, `payroll_run` FK, `payslip` FK, tax fields, or calculation metadata.

### `hr.Employee.salary`

| Field | Purpose |
|-------|---------|
| `salary` | Optional **annual** CTC (`Decimal`, help text: "Annual salary") |

Populated from **offer conversion** (`services.convert_hired_candidate_to_employee`: `employee.salary = offer.ctc`) and **manual hire** — **not** synced to `Salary` rows.

### Recruitment compensation (not payroll ledger)

| Model | Salary-related fields |
|-------|----------------------|
| `OfferTemplate` | `default_ctc`, `default_basic_salary`, `default_hra`, `default_allowances`, `default_bonus` |
| `Offer` | `ctc`, `basic_salary`, `hra`, `allowances`, `bonus` |
| `OfferBuilderV2` | `basic_salary`, `hra`, `special_allowance`, `bonus`, `ctc` (mostly `CharField`) |
| `Candidate` | `expected_salary`, `offered_salary` |

These support **offer letters**, not monthly payroll processing.

---

## 3. Existing payslip models

| Status | **Missing** |

No `Payslip`, `PayslipLine`, or payslip PDF storage model.

**Naming collision (not employee payslip):**

- `EmployeeDocument` / onboarding type `salary_slip` = **previous employer** document upload
- `Offer.pdf` = **offer letter** PDF, not salary slip

---

## 4. Salary structure support

| Status | **Partially implemented** |

| Layer | Implementation |
|-------|----------------|
| **Offer / template defaults** | CTC, basic, HRA, allowances, bonus on `OfferTemplate` and snapshot on `Offer` |
| **Employee master** | Single annual `Employee.salary` (CTC) |
| **Payroll structure** | **Missing** — no salary components table, no effective-dated structure, no PF/ESI splits |
| **Monthly `Salary` row** | Flat four buckets only (`basic_pay`, `allowance`, `deductions`, `overtime`) |

Offer builder `salary_table` blocks (`component_renderer.render_salary_table`) are **HTML/PDF presentation only**.

---

## 5. Earnings support

| Status | **Partially implemented** |

| Capability | Status |
|------------|--------|
| Basic pay | Field on `Salary`; not derived from offer structure automatically |
| Allowances | Single `allowance` column |
| HRA / bonus / special allowance | On **Offer** only; not on `Salary` |
| Variable pay / incentives | **Missing** |
| Arrears | **Missing** |
| Earnings line items | **Missing** |

---

## 6. Deduction support

| Status | **Partially implemented** |

| Capability | Status |
|------------|--------|
| Lump-sum deductions | `Salary.deductions` (one number) |
| Deduction rules (PF, ESI, PT, TDS) | **Missing** |
| Leave without pay (LOP) | **Missing** in payroll (leave affects `DailyAttendance`, not `Salary`) |
| Attendance-based deductions | **Missing** |

---

## 7. Attendance integration

| Status | **Partially implemented** (attendance yes, payroll no) |

| System | What works |
|--------|------------|
| `AttendancePunch` + `DailyAttendance` | Full engine: present/late/absent/half_day, `late_minutes`, `overtime_hours`, `total_work_hours` |
| Dashboard / calendar / analytics | Reads `DailyAttendance` only |
| Test seeder | Generates real punches + summaries for testing |

| Payroll link | Status |
|--------------|--------|
| Read `DailyAttendance` for pay period | **Missing** |
| LOP from absent days | **Missing** |
| OT pay from `overtime_hours` | **Missing** (OT stored on daily row, not rolled into `Salary.overtime`) |
| Late penalties | **Missing** |

**Conclusion:** Attendance is **payroll-ready as a data source** but **no payroll consumer** exists.

---

## 8. Leave integration

| Status | **Partially implemented** |

| Component | Status |
|-----------|--------|
| `LeaveRequest` + `LeaveBalance` + `LeaveType` | Implemented; UI uses `/hr/leave-requests/` |
| Approve/reject | Updates balance; **recalculates `DailyAttendance`** per leave day (`LeaveRequestViewSet._recalculate_leave_dates`) |
| Engine | Approved leave → `DailyAttendance.attendance_status = 'leave'` |

| Payroll link | Status |
|--------------|--------|
| Unpaid leave / LOP amount | **Missing** |
| Paid leave pay rules | **Missing** |
| Sync to `Salary` | **Missing** |

### Orphan: legacy `Leave` model

- `hr.Leave` + `LeaveViewSet` (`/hr/leaves/`) with approve/reject
- **Not used** by frontend (`OperationsLeavePage` uses `leave-requests` only)
- Does **not** update `LeaveBalance` or attendance engine
- **Risk:** duplicate/conflicting leave data if API used manually

---

## 9. Overtime integration

| Status | **Partially implemented** |

| Layer | Detail |
|-------|--------|
| Shift | `overtime_allowed` flag |
| `DailyAttendance` | `overtime_hours`, `overtime_minutes` from engine |
| Dashboard | Counts employees with OT |
| `Salary.overtime` | **Manual decimal** — no code copies from attendance |

**Missing:** OT rate, OT hours × rate, caps, holiday OT rules, payroll posting.

---

## 10. Tax support

| Status | **Missing** |

No models or services for TDS, tax regimes, exemptions, Form 16, or statutory tax slabs.

`apps/pharmacy` has invoice tax amounts — **unrelated** to HR payroll.

---

## 11. Payroll run support

| Status | **Missing** |

No workflow for:

- Open / calculate / approve / lock / pay payroll for a period
- Batch processing all employees
- Reversal or supplemental runs
- Audit trail of payroll calculation

`Salary` rows could be entered via generic CRUD API (`SalaryViewSet`) but nothing orchestrates a **run**.

---

## 12. Payslip generation support

| Status | **Missing** (for payroll) |

| Artifact | Exists? | Purpose |
|----------|---------|---------|
| Employee payslip PDF/HTML | **No** | — |
| Offer letter PDF | **Yes** | `Offer.pdf`, `pdf_generator`, offer renderer |
| Salary table in offer | **Yes** | Display only |

---

## API & UI inventory

| Endpoint / UI | Purpose | Payroll relevance |
|---------------|---------|-----------------|
| `GET/POST /api/v1/hr/salary/` | `SalaryViewSet` (generic CRUD) | Only salary API; **no custom actions** |
| `/hr/operations/salary` | `OperationsSalaryPage` | **Read-only** table; no create/edit/generate |
| Offer / builder APIs | Compensation for hiring | Pre-employment |
| `/hr/daily-attendance/*` | Attendance ops | Upstream data, not payroll |

`SalaryViewSet` inherits `HRBaseViewSet` → filters by `employee__hospital_id` when user has hospital.

---

## Orphan / unused payroll-related code

| Item | Issue |
|------|--------|
| `hr.Leave` + `LeaveViewSet` | Legacy duplicate of `LeaveRequest`; unused by UI |
| `hr.Attendance` (legacy) | Superseded by `AttendancePunch` / `DailyAttendance`; still in API `hr/attendance` |
| `Salary` model | **No application code creates rows** (grep: only model definition + demo reset + ViewSet queryset) |
| `OperationsSalaryPage` | Subtitle says "payroll" but only **lists** existing `Salary` rows |
| Offer `salary_table` / variables | Recruitment documents, not payroll engine |

---

## Broken or incomplete flows

| Flow | Problem |
|------|---------|
| Hire → monthly pay | `Employee.salary` (CTC) set from offer; **no `Salary` record** created |
| Attendance month → pay | Rich `DailyAttendance`; **no payroll calculation** |
| Leave approve → pay | Updates attendance to `leave`; **no pay impact** |
| HR Salary screen | Cannot generate or edit pays; empty unless rows inserted via API/admin |
| `Salary` + same employee + month | **No DB uniqueness** — duplicate monthly rows possible |
| Legacy `Leave` approve | Does not integrate with balances or attendance |

---

## Missing dependencies (to reach production payroll)

1. **Payroll domain models** — run, period, payslip, component lines, employee salary structure (effective dates).
2. **Calculation service** — inputs: structure, attendance summary, leave, OT, holidays; outputs: earnings, deductions, net pay.
3. **Attendance aggregator** — month roll-up from `DailyAttendance` (present days, LOP days, OT hours, late policy if needed).
4. **Leave payroll rules** — paid vs unpaid leave types; LOP integration.
5. **Tax / statutory engine** — at least configurable deductions (PF/ESI/PT/TDS) or external export.
6. **Payslip generator** — PDF/HTML from calculated lines.
7. **UI** — payroll run wizard, review, approval, employee payslip download.
8. **Tests** — zero `test*salary*` files found.
9. **Deprecate or bridge** — `Leave` vs `LeaveRequest`; clarify `Salary` vs `Employee.salary`.

---

## Readiness matrix

| # | Area | Status |
|---|------|--------|
| 1 | Payroll models | **Missing** |
| 2 | Salary models | **Partially implemented** |
| 3 | Payslip models | **Missing** |
| 4 | Salary structure | **Partially implemented** |
| 5 | Earnings | **Partially implemented** |
| 6 | Deductions | **Partially implemented** |
| 7 | Attendance integration | **Partially implemented** |
| 8 | Leave integration | **Partially implemented** |
| 9 | Overtime integration | **Partially implemented** |
| 10 | Tax support | **Missing** |
| 11 | Payroll run | **Missing** |
| 12 | Payslip generation | **Missing** |

---

## Recommended build order (informational)

1. Employee **salary structure** (components + effective date) synced from offer/HR master.  
2. **Period aggregator** reading `DailyAttendance` + approved `LeaveRequest`.  
3. **Payroll calculation** → `Salary` or new `Payslip` lines with audit JSON.  
4. **Payroll run** state machine + HR UI.  
5. **Payslip PDF** + employee self-service (optional).  
6. **Tax / statutory** rules or export format.

---

## Can payroll “consume” attendance today?

**Conditionally — data only, not code.**

| Data on `DailyAttendance` | Payroll-useful |
|---------------------------|----------------|
| `attendance_status` | Yes (present/absent/late/half_day/leave/weekend/holiday) |
| `total_work_hours` | Yes |
| `overtime_hours` / `overtime_minutes` | Yes |
| `late_minutes` | Yes (if policy requires) |
| `date`, `employee`, `shift` | Yes |
| `calculation_locked` / `manually_corrected` | Yes (exclude or flag for review) |

A future payroll module should call **`DailyAttendance` for the pay period**, not rebuild from punches directly, to stay aligned with HR dashboards.

---

*End of audit — no application code was modified.*
