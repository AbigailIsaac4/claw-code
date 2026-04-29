'use client';

import { ThemeProvider } from '@lobehub/ui';
import { StyleProvider } from '@ant-design/cssinjs';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <StyleProvider hashPriority="high">
      <ThemeProvider>
        {children}
      </ThemeProvider>
    </StyleProvider>
  );
}
