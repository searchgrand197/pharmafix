export function parseLeaveNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function isUnlimitedLeaveType(lt) {
  return Boolean(lt?.balance?.is_unlimited);
}

/** Sum paid/limited leave only — unlimited types (e.g. LWP) use sentinel 9999 in DB. */
export function computeLeaveDashboard(leaveTypes = [], allLeaves = []) {
  let totalBalance = 0;
  let used = 0;
  let remaining = 0;
  let unlimitedCount = 0;

  leaveTypes.forEach((lt) => {
    const unlimited = isUnlimitedLeaveType(lt);
    if (unlimited) {
      unlimitedCount += 1;
      used += parseLeaveNum(lt.balance?.used_days);
      return;
    }
    totalBalance += parseLeaveNum(lt.balance?.total_days);
    used += parseLeaveNum(lt.balance?.used_days);
    remaining += parseLeaveNum(lt.balance?.remaining_days);
  });

  const pending = allLeaves.filter((row) => row.status === 'PENDING').length;
  return { totalBalance, used, remaining, pending, unlimitedCount };
}

export function leaveTypeSelectable(lt) {
  if (lt.balance?.is_unlimited) return true;
  if (!lt.balance) return lt.is_paid === false;
  return parseLeaveNum(lt.balance.remaining_days) > 0;
}
