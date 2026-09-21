import { useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, CircularProgress, IconButton, MenuItem, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { useAuth } from '@admin/context/AuthContext';
import { useStaffQuery, useStaffMutations } from '@/hooks/useStaffQuery';
import { useDepartmentsQuery } from '@/hooks/useDepartmentsQuery';
import { useDesignationsQuery } from '@/hooks/useDesignationsQuery';
import { AppButton } from '@/components/AppButton';
import { AppTextField } from '@/components/AppTextField';
import { AppSelect } from '@/components/AppSelect';
import { AppTable } from '@/components/AppTable';
import { AppDialog } from '@/components/AppDialog';
import { useToast } from '@admin/context/ToastContext';
import { getApiErrorMessage } from '@/utils/apiError';
import { staffFormSchema } from '@admin/modules/staff/staffSchema';

function staffRowMeta(raw) {
  const firstName = (raw?.first_name || '').trim();
  const lastName = (raw?.last_name || '').trim();
  const name = [firstName, lastName].filter(Boolean).join(' ') || raw?.name || '—';
  const email = raw?.email || raw?.user_email || '—';
  const phone = raw?.phone || raw?.phone_number || raw?.mobile || '—';
  const address = raw?.address || raw?.current_address || raw?.full_address || '—';
  const employeeCode = (raw?.employee_code || '').trim() || '—';
  const departmentName = raw?.department_name || String(raw?.department || '');
  const designationName = raw?.designation_name || String(raw?.designation || '');

  return {
    id: raw?.id,
    name,
    email,
    phone,
    address,
    employeeCode,
    departmentName,
    designationName,
    raw,
  };
}

function optionId(item) {
  return item?.id ?? item?.pk ?? null;
}

export function StaffPage() {
  const { user } = useAuth();
  const canManage = user?.is_superuser === true;

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [formMode, setFormMode] = useState('create');
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [credentials, setCredentials] = useState({ loginEmail: '', initialPassword: '' });
  const { showToast } = useToast();

  const { data, isLoading, isError, error } = useStaffQuery();
  const { create, patch, remove } = useStaffMutations();

  const {
    data: deptData,
    isLoading: deptsLoading,
    isError: deptsError,
  } = useDepartmentsQuery();
  const {
    data: desigData,
    isLoading: desigsLoading,
    isError: desigsError,
  } = useDesignationsQuery();

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      address: '',
      joining_date: '',
      department: '',
      designation: '',
    },
  });

  const rows = useMemo(() => {
    const list = (data?.data ?? []).map(staffRowMeta);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => {
      const name = String(item?.name ?? '').toLowerCase();
      const email = String(item?.email ?? '').toLowerCase();
      const employeeCode = String(item?.employeeCode ?? '').toLowerCase();
      const dept = String(item?.departmentName ?? '').toLowerCase();
      const desig = String(item?.designationName ?? '').toLowerCase();
      return (
        name.includes(q) ||
        email.includes(q) ||
        employeeCode.includes(q) ||
        dept.includes(q) ||
        desig.includes(q)
      );
    });
  }, [data?.data, search]);

  const departments = (deptData?.data ?? [])
    .map((d) => ({
      id: optionId(d),
      name: d?.name ?? '—',
    }))
    .filter((d) => d.id != null);
  const designations = (desigData?.data ?? [])
    .map((d) => ({
      id: optionId(d),
      name: d?.name ?? '—',
    }))
    .filter((d) => d.id != null);

  const defaultValues = {
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
    joining_date: '',
    department: '',
    designation: '',
  };

  const openCreate = () => {
    setFormMode('create');
    setEditingId(null);
    setFormError('');
    reset(defaultValues);
    setFormOpen(true);
  };

  const openEdit = (row) => {
    const raw = row?.raw || {};
    setFormMode('edit');
    setEditingId(row?.id ?? raw?.id ?? null);
    setFormError('');
    reset({
      first_name: raw.first_name || '',
      last_name: raw.last_name || '',
      email: raw.email || raw.user_email || '',
      phone: raw.phone || raw.phone_number || raw.mobile || '',
      address: raw.address || raw.current_address || raw.full_address || '',
      joining_date: raw.joining_date || '',
      department: raw.department != null ? String(raw.department) : '',
      designation: raw.designation != null ? String(raw.designation) : '',
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setFormError('');
    setEditingId(null);
  };

  const onSubmit = async (values) => {
    setFormError('');
    const payload = {
      first_name: values.first_name,
      last_name: values.last_name,
      email: String(values.email || '').trim().toLowerCase(),
      phone: values.phone,
      address: values.address,
      joining_date: values.joining_date || null,
      department: values.department,
      designation: values.designation,
    };
    try {
      if (formMode === 'create') {
        const result = await create.mutateAsync(payload);
        closeForm();
        const created = result?.data;
        const loginEmail =
          created?.login_email ?? created?.loginEmail ?? '';
        const initialPassword =
          created?.initial_password ?? created?.initialPassword ?? '';
        showToast({ type: 'success', message: 'Staff member created' });
        if (loginEmail || initialPassword) {
          setCredentials({
            loginEmail: String(loginEmail),
            initialPassword: String(initialPassword),
          });
          setCredentialsOpen(true);
        }
      } else if (editingId != null) {
        await patch.mutateAsync({ id: editingId, payload });
        showToast({ type: 'success', message: 'Staff member updated' });
        closeForm();
      }
    } catch (e) {
      const res = e?.response?.data;
      const fieldErrors = res?.errors || res;
      if (fieldErrors?.email && Array.isArray(fieldErrors.email) && fieldErrors.email.length) {
        setError('email', {
          type: 'server',
          message: String(fieldErrors.email[0]),
        });
      } else {
        setFormError(getApiErrorMessage(e));
      }
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError('');
    try {
      await remove.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      showToast({ type: 'success', message: 'Staff member deleted' });
    } catch (e) {
      setDeleteError(getApiErrorMessage(e));
    }
  };

  const closeDeleteDialog = () => {
    setDeleteTarget(null);
    setDeleteError('');
  };

  const saving = create.isPending || patch.isPending;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Typography variant="h5">Staff</Typography>
        {canManage ? (
          <AppButton variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Add staff
          </AppButton>
        ) : null}
      </Box>

      <Box sx={{ maxWidth: { md: '50%', lg: '33.33%' } }}>
        <AppTextField
          label="Search"
          placeholder="Name, email, employee code, department, designation"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Box>

      {!canManage ? (
        <Box>
          <Alert severity="info">
            Only superusers can create, edit, or delete staff profiles. You can view the list below.
          </Alert>
        </Box>
      ) : null}

      {isError ? (
        <Box>
          <Alert severity="error">{getApiErrorMessage(error)}</Alert>
        </Box>
      ) : null}

      <Box sx={{ position: 'relative' }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
            <CircularProgress size={32} />
          </Box>
        ) : (
          <AppTable
            columns={[
              {
                id: 'name',
                header: 'Name',
                renderCell: (row) => row.name,
              },
              {
                id: 'employee_code',
                header: 'Employee code',
                renderCell: (row) => row.employeeCode,
              },
              {
                id: 'email',
                header: 'Email',
                renderCell: (row) => row.email,
              },
              {
                id: 'phone',
                header: 'Phone',
                renderCell: (row) => row.phone || '—',
              },
              {
                id: 'address',
                header: 'Address',
                renderCell: (row) => row.address || '—',
              },
              {
                id: 'department',
                header: 'Department',
                renderCell: (row) => row.departmentName || '—',
              },
              {
                id: 'designation',
                header: 'Designation',
                renderCell: (row) => row.designationName || '—',
              },
            ]}
            data={rows}
            emptyMessage="No staff found"
            getRowId={(row) => row.id}
            renderActions={(row) =>
              canManage ? (
                <>
                  <IconButton size="small" aria-label="Edit staff" onClick={() => openEdit(row)}>
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label="Delete staff"
                    onClick={() => {
                      setDeleteError('');
                      setDeleteTarget({ id: row.id, name: row.name });
                    }}
                  >
                    <DeleteOutlinedIcon fontSize="small" />
                  </IconButton>
                </>
              ) : (
                '—'
              )
            }
          />
        )}
      </Box>

      <AppDialog
        open={formOpen}
        onClose={saving ? () => {} : closeForm}
        title={formMode === 'create' ? 'Add staff' : 'Edit staff'}
        maxWidth="sm"
        actions={
          <>
            <AppButton onClick={closeForm} disabled={saving}>
              Cancel
            </AppButton>
            <AppButton variant="contained" onClick={handleSubmit(onSubmit)} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </AppButton>
          </>
        }
      >
        {formError ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setFormError('')}>
            {formError}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          <AppTextField
            label="First name"
            required
            {...register('first_name')}
            error={Boolean(errors.first_name)}
            helperText={errors.first_name?.message}
          />
          <AppTextField
            label="Last name"
            required
            {...register('last_name')}
            error={Boolean(errors.last_name)}
            helperText={errors.last_name?.message}
          />
          <AppTextField
            label="Email"
            required
            {...register('email')}
            error={Boolean(errors.email)}
            helperText={errors.email?.message}
          />
          <AppTextField
            label="Phone"
            required
            {...register('phone')}
            error={Boolean(errors.phone)}
            helperText={errors.phone?.message}
          />
          <AppTextField
            label="Address"
            required
            multiline
            minRows={2}
            {...register('address')}
            error={Boolean(errors.address)}
            helperText={errors.address?.message}
          />
          <AppTextField
            label="Joining date"
            type="date"
            InputLabelProps={{ shrink: true }}
            {...register('joining_date')}
            error={Boolean(errors.joining_date)}
            helperText={errors.joining_date?.message}
          />
          <Controller
            name="department"
            control={control}
            render={({ field, fieldState }) => (
              <AppSelect
                label="Department"
                id="department"
                {...field}
                error={fieldState.error}
                disabled={deptsLoading || deptsError}
              >
                {departments.map((d) => (
                  <MenuItem key={d.id} value={String(d.id)}>
                    {d.name}
                  </MenuItem>
                ))}
              </AppSelect>
            )}
          />
          <Controller
            name="designation"
            control={control}
            render={({ field, fieldState }) => (
              <AppSelect
                label="Designation"
                id="designation"
                {...field}
                error={fieldState.error}
                disabled={desigsLoading || desigsError}
              >
                {designations.map((d) => (
                  <MenuItem key={d.id} value={String(d.id)}>
                    {d.name}
                  </MenuItem>
                ))}
              </AppSelect>
            )}
          />
        </Box>
      </AppDialog>

      <AppDialog
        open={Boolean(deleteTarget)}
        onClose={remove.isPending ? () => {} : closeDeleteDialog}
        title="Delete staff"
        maxWidth="sm"
        actions={
          <>
            <AppButton onClick={closeDeleteDialog} disabled={remove.isPending}>
              Cancel
            </AppButton>
            <AppButton
              variant="contained"
              color="error"
              onClick={confirmDelete}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </AppButton>
          </>
        }
      >
        {deleteError ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeleteError('')}>
            {deleteError}
          </Alert>
        ) : null}
        <Typography variant="body2">
          Delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.
        </Typography>
      </AppDialog>

      <AppDialog
        open={credentialsOpen}
        onClose={() => setCredentialsOpen(false)}
        title="Staff login credentials"
        maxWidth="sm"
        actions={
          <AppButton variant="contained" onClick={() => setCredentialsOpen(false)}>
            I've saved these
          </AppButton>
        }
      >
        <Alert severity="info" sx={{ mb: 2 }}>
          Share these with the staff member once. They may not be shown again.
        </Alert>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <AppTextField
            label="Login email"
            value={credentials.loginEmail}
            fullWidth
            InputProps={{ readOnly: true }}
          />
          <AppTextField
            label="Initial password"
            value={credentials.initialPassword}
            fullWidth
            InputProps={{ readOnly: true }}
            inputProps={{ autoComplete: 'off' }}
            sx={{ '& .MuiInputBase-input': { fontFamily: 'ui-monospace, monospace' } }}
          />
        </Box>
      </AppDialog>
    </Box>
  );
}

