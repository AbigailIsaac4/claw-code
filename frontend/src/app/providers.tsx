'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { ThemeProvider } from '@lobehub/ui';
import { StyleProvider } from '@ant-design/cssinjs';

import { App } from 'antd';

const emptySubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function Providers({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(emptySubscribe, clientSnapshot, serverSnapshot);

  if (!mounted) return null;

  return (
    <StyleProvider hashPriority="high">
      <ThemeProvider themeMode="light" customTheme={{ primaryColor: 'blue' }}>
        <App>
          {children}
        </App>
      </ThemeProvider>
    </StyleProvider>
  );
}
