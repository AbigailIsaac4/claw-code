import { useState, useEffect, useCallback } from 'react';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

interface UseAuthCallbacks {
  onLoginSuccess?: (token: string, fullName: string) => void;
  onLogout?: () => void;
  onError?: (msg: string) => void;
}

export function useAuth(callbacks: UseAuthCallbacks = {}) {
  const [token, setToken] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const handleLogin = useCallback(async () => {
    if (!email || !password) {
      callbacks.onError?.('Enter email and password');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await fetch(apiUrl('/v1/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem('claw_token', data.token);
        setToken(data.token);
        setShowLogin(false);
        callbacks.onLoginSuccess?.(data.token, data.full_name);
      } else {
        callbacks.onError?.(data.message || 'Login failed. Check your credentials.');
      }
    } catch {
      callbacks.onError?.('Network error');
    } finally {
      setLoginLoading(false);
    }
  }, [email, password, callbacks]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('claw_token');
    setToken(null);
    setShowLogin(true);
    callbacks.onLogout?.();
  }, [callbacks]);

  return {
    token,
    setToken,
    showLogin,
    setShowLogin,
    email,
    setEmail,
    password,
    setPassword,
    loginLoading,
    handleLogin,
    handleLogout,
  };
}
