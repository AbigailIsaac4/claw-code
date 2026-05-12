'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { StyleProvider } from '@ant-design/cssinjs';
import { ConfigProvider, App, theme } from 'antd';
import { XProvider } from '@ant-design/x';

const emptySubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function Providers({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(emptySubscribe, clientSnapshot, serverSnapshot);

  if (!mounted) return null;

  return (
    <StyleProvider hashPriority="high">
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#1677ff',
            borderRadius: 8,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          },
        }}
      >
        <XProvider>
          <App>
            {children}
          </App>
        </XProvider>
      </ConfigProvider>
    </StyleProvider>
  );
}
