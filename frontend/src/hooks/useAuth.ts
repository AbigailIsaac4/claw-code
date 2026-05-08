import { useState, useEffect } from 'react';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

interface AuthState {
  token: string | null;
  showLogin: boolean;
  email: string;
  password: string;
  loginLoading: boolean;
}

interface AuthActions {
  setEmail: (email: string) => void;
  setPassword: (password: string) => void;
  handleLogin: () => Promise<void>;
  handleLogout: () => void;
  setShowLogin: (show: boolean) => void;
}

export function useAuth(onLoginSuccess: (token: string) => void): AuthState & AuthActions {
  const [token, setToken] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Initialize auth state from localStorage
  useEffect(() => {
    const savedToken = localStorage.getItem('claw_token');
    if (savedToken) {
      setToken(savedToken);
      setShowLogin(false);
      onLoginSuccess(savedToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async () => {
    if (!email || !password) return;
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
        onLoginSuccess(data.token);
      } else {
        throw new Error(data.message || 'Login failed');
      }
    } catch (err) {
      throw err;
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('claw_token');
    setToken(null);
    setShowLogin(true);
  };

  return {
    token,
    showLogin,
    email,
    password,
    loginLoading,
    setEmail,
    setPassword,
    handleLogin,
    handleLogout,
    setShowLogin,
  };
}
