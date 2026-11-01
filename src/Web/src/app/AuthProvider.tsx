import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { request, setCsrfToken } from '../api/client';

type Session = { authenticationEnabled: boolean; authenticated: boolean; user: string | null; csrfToken: string | null };
type AuthContextValue = { session: Session };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');

  async function refreshSession() {
    setError('');
    try {
      const value = await request<Session>('/auth/session');
      setCsrfToken(value.csrfToken);
      setSession(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not check the sign-in session.');
    }
  }

  useEffect(() => { void refreshSession(); }, []);

  const value = useMemo<AuthContextValue>(() => ({ session: session! }), [session]);

  if (!session) return <AuthMessage title={error ? 'Unable to connect' : 'Checking sign-in…'} detail={error || 'Preparing your secure session.'} retry={error ? () => void refreshSession() : undefined} />;
  if (session.authenticationEnabled && !session.authenticated) {
    const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return <AuthMessage title="Sign in to KRO Studio" detail="Use your organization’s identity provider to continue." action={<a className="btn" href={`/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`}>Sign in</a>} />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

function AuthMessage({ title, detail, action, retry }: { title: string; detail: string; action?: ReactNode; retry?: () => void }) {
  return <main style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
    <h1 style={{ margin: 0 }}>{title}</h1><p style={{ margin: 0, color: '#777' }}>{detail}</p>
    {action}{retry && <button className="btn" onClick={retry}>Try again</button>}
  </main>;
}
