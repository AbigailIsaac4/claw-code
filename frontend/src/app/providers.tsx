'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { StyleProvider } from '@ant-design/cssinjs';
import { ConfigProvider, App } from 'antd';

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
          token: {
            colorPrimary: '#eb6f4b',
            borderRadius: 8,
          },
        }}
      >
        <App>
          {children}
        </App>
      </ConfigProvider>
    </StyleProvider>
  );
}
