export const colors = {
  accent: '#eb6f4b',
  accentHover: '#d4603f',
  accentLight: 'rgba(235,111,75,0.08)',

  bgPrimary: '#ffffff',
  bgSecondary: '#f8f6f3',
  bgTertiary: '#fafafa',
  bgHover: 'rgba(0,0,0,0.03)',
  bgActive: 'rgba(0,0,0,0.06)',
  bgCode: '#f8f9fa',

  textPrimary: '#000000',
  textSecondary: '#888888',
  textTertiary: '#aaaaaa',
  textMuted: '#666666',

  success: '#52c41a',
  successBg: '#f6ffed',
  successBorder: '#b7eb8f',

  error: '#ff4d4f',

  info: '#1677ff',
  infoBg: '#e6f4ff',
  infoBorder: '#91caff',

  warning: '#faad14',

  border: '#f0f0f0',
  borderLight: 'rgba(0,0,0,0.04)',
  borderMedium: 'rgba(0,0,0,0.06)',
  borderDark: 'rgba(0,0,0,0.08)',

  shadow: 'rgba(0,0,0,0.02)',
  shadowMedium: '0 2px 8px rgba(0,0,0,0.06)',
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 15,
  xl: 16,
  xxl: 20,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
