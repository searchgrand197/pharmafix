import React from 'react'
import Box from '@mui/material/Box'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import LocalHospitalIcon from '@mui/icons-material/LocalHospital'
import LogoutIcon from '@mui/icons-material/Logout'
import { useAuthStore } from '../stores/authStore'

const GRADIENT_MAP = {
  blue: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
  green: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)',
  purple: 'linear-gradient(135deg, #9333ea 0%, #ec4899 100%)',
}

export default function Layout({ title, subtitle, color = 'blue', children, tabs, activeTab, onTab, headerExtra, noScroll }) {
  function logout() {
    useAuthStore.getState().logoutSilent()
    window.location.replace('/login')
  }

  const handleTabChange = (_, newValue) => {
    if (onTab) onTab(newValue)
  }

  return (
    <Box sx={{ height: '100vh', overflow: 'hidden', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <AppBar
        position="static"
        elevation={1}
        sx={{ background: GRADIENT_MAP[color] || GRADIENT_MAP.blue }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 44, px: 2, gap: 1 }}>
          <LocalHospitalIcon sx={{ fontSize: 18, mr: 0.5 }} />
          <Typography variant="subtitle2" fontWeight={800} sx={{ fontSize: 14, lineHeight: 1 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" sx={{ opacity: 0.8, ml: 1, fontSize: 10, lineHeight: 1 }}>
              {subtitle}
            </Typography>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {headerExtra}
          <Button
            size="small"
            onClick={logout}
            startIcon={<LogoutIcon sx={{ fontSize: 12 }} />}
            sx={{
              color: 'common.white',
              fontSize: 11,
              fontWeight: 700,
              bgcolor: 'rgba(255,255,255,0.2)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' },
              px: 1.5,
              py: 0.25,
              borderRadius: 1,
              textTransform: 'none',
            }}
          >
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      {/* Tab bar */}
      {tabs && (
        <Box sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', px: 2 }}>
          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 36,
              '& .MuiTab-root': {
                minHeight: 36,
                px: 2.5,
                py: 0.75,
                fontSize: 12,
                fontWeight: 700,
                textTransform: 'none',
                gap: 0.75,
              },
            }}
          >
            {tabs.map(t => (
              <Tab
                key={t.id}
                value={t.id}
                label={t.label}
                icon={t.icon ? <t.icon sx={{ fontSize: 14 }} /> : undefined}
                iconPosition="start"
              />
            ))}
          </Tabs>
        </Box>
      )}

      <Box
        component="main"
        sx={{
          flex: 1,
          p: 2,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: noScroll ? 'hidden' : 'auto',
        }}
      >
        {children}
      </Box>
    </Box>
  )
}
