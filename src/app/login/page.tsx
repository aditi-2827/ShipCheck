'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, ClientApiError } from '@/lib/api';

type Status = 'idle' | 'submitting' | 'error';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'submitting') return;
    if (!password) {
      setStatus('error');
      setError('Please enter the ShipCheck password.');
      return;
    }
    setStatus('submitting');
    setError('');
    try {
      await login(password);
      router.replace('/');
    } catch (err) {
      const message =
        err instanceof ClientApiError
          ? err.code === 'INTERNAL'
            ? 'Server error: SHIPCHECK_PASSWORD may not be configured.'
            : err.message
          : 'Unable to reach the server. Try again.';
      setStatus('error');
      setError(message);
    }
  };

  return (
    <main className="min-h-screen">
      <div className="shell">
        <header className="topbar">
          <a href="/" className="brand">
            <span className="brand-mark">SC</span>
            <span>SHIPCHECK</span>
            <small>LOCAL-FIRST / v1.0</small>
          </a>
          <div className="local-state">
            <i /> LOCAL
          </div>
        </header>

        <div style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
          <aside className="issue-panel" style={{ maxWidth: 460, width: '100%', borderTop: '2px solid #36D9FF' }}>
            <div className="instrument-head">
              <p className="eyebrow">
                <span className="signal" /> AUTHENTICATION REQUIRED
              </p>
              <span className="live">
                <i /> LOCKED
              </span>
            </div>

            <h1
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '0',
                margin: '22px 0 16px',
                color: '#E7EAF0',
                fontSize: 'clamp(40px, 6vw, 64px)',
                lineHeight: '.84',
                letterSpacing: '-.06em',
              }}
            >
              <strong>SHIP</strong>
              <em
                style={{
                  marginLeft: '13%',
                  color: '#9aa3ad',
                  font: 'italic 400 22px Georgia, serif',
                  letterSpacing: 0,
                  lineHeight: 1.3,
                }}
              >
                with
              </em>
              <strong className="accent-text">CONFIDENCE.</strong>
            </h1>

            <p className="hero-lede">
              This deployment-readiness analyzer is private. Enter the local password to continue.
            </p>

            <form onSubmit={submit} style={{ display: 'grid', gap: '12px', marginTop: '26px' }}>
              <label className="eyebrow" htmlFor="password">
                PASSWORD
              </label>
              <input
                id="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: '#0D0F12',
                  border: '1px solid #20252B',
                  color: '#E7EAF0',
                  font: '500 13px "JetBrains Mono", Consolas, monospace',
                  letterSpacing: '.05em',
                }}
              />
              {status === 'error' && (
                <p
                  className="red-text"
                  style={{
                    font: '500 10px "JetBrains Mono", monospace',
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    margin: 0,
                  }}
                >
                  {error}
                </p>
              )}
              <button className="primary-button" type="submit" disabled={status === 'submitting'}>
                <span>{status === 'submitting' ? '↻' : '▶'}</span>
                {status === 'submitting' ? 'AUTHENTICATING...' : 'SIGN IN'}
              </button>
            </form>
          </aside>
        </div>
      </div>
    </main>
  );
}
