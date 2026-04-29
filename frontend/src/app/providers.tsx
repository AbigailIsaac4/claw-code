'use client';

import { ThemeProvider } from '@lobehub/ui';
import { StyleProvider } from '@ant-design/cssinjs';

import { App } from 'antd';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <StyleProvider hashPriority="high">
      <ThemeProvider>
        <App>
          {children}
        </App>
      </ThemeProvider>
    </StyleProvider>
  );
}
