/**
 * AuthPage - Login/Signup/Verification for ALIN
 *
 * Clean, professional auth screen. No flashy gradients or gimmicks.
 */

import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '@store/authStore';

export default function AuthPage() {
  const {
    signup, login, verifyEmail, resendCode,
    isLoading, error, clearError,
    needsVerification, verificationEmail,
  } = useAuthStore();

  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Verification code — 6 individual inputs
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isSignup) {
        await signup(email, password, displayName);
      } else {
        await login(email, password);
      }
    } catch {
      // Error is set in store
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);
    if (value && index < 5) codeRefs.current[index + 1]?.focus();
    if (newCode.every(d => d !== '') && newCode.join('').length === 6) {
      handleVerify(newCode.join(''));
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      codeRefs.current[index - 1]?.focus();
    }
  };

  const handleCodePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setCode(pasted.split(''));
      handleVerify(pasted);
    }
  };

  const handleVerify = async (fullCode: string) => {
    try {
      await verifyEmail(fullCode);
    } catch {
      setCode(['', '', '', '', '', '']);
      codeRefs.current[0]?.focus();
    }
  };

  const handleResend = async () => {
    await resendCode();
    setResendCooldown(60);
  };

  const toggleMode = () => {
    setIsSignup(!isSignup);
    clearError();
  };

  // ── Verification Screen ──
  if (needsVerification) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-primary p-4">
        <div className="w-full max-w-sm">
          <div className="mb-10 text-center">
            <h1 className="text-2xl font-semibold text-text-primary tracking-tight">ALIN</h1>
          </div>

          <div className="rounded-lg border border-border-primary bg-background-secondary p-8">
            <h2 className="mb-2 text-base font-medium text-text-primary text-center">Check your email</h2>
            <p className="mb-1 text-sm text-text-tertiary text-center">
              Enter the 6-digit code sent to
            </p>
            <p className="mb-8 text-sm font-medium text-text-primary text-center">
              {verificationEmail}
            </p>

            {error && (
              <div className="mb-6 rounded border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex justify-center gap-2 mb-8" onPaste={handleCodePaste}>
              {code.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { codeRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(i, e.target.value)}
                  onKeyDown={(e) => handleCodeKeyDown(i, e)}
                  className="w-11 h-12 rounded border border-border-primary bg-background-primary text-center text-lg font-mono text-text-primary outline-none transition-colors focus:border-text-secondary focus:ring-1 focus:ring-text-secondary/20"
                  autoFocus={i === 0}
                />
              ))}
            </div>

            {isLoading && (
              <p className="text-sm text-text-tertiary text-center mb-4">Verifying...</p>
            )}

            <div className="text-center">
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="text-sm text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-40"
              >
                {resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : "Resend code"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Login / Signup Screen ──
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-primary p-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">ALIN</h1>
          <p className="mt-1 text-sm text-text-tertiary">
            {isSignup ? 'Create your account' : 'Sign in to your account'}
          </p>
        </div>

        <div className="rounded-lg border border-border-primary bg-background-secondary p-8">
          {error && (
            <div className="mb-6 rounded border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {isSignup && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary placeholder-text-quaternary outline-none transition-colors focus:border-text-secondary focus:ring-1 focus:ring-text-secondary/20"
                  placeholder="Your name"
                  required
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary placeholder-text-quaternary outline-none transition-colors focus:border-text-secondary focus:ring-1 focus:ring-text-secondary/20"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded border border-border-primary bg-background-primary px-3 py-2 pr-10 text-sm text-text-primary placeholder-text-quaternary outline-none transition-colors focus:border-text-secondary focus:ring-1 focus:ring-text-secondary/20"
                  placeholder={isSignup ? 'Min 6 characters' : 'Password'}
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-quaternary hover:text-text-secondary transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded bg-text-primary px-4 py-2 text-sm font-medium text-background-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isLoading ? 'Please wait...' : isSignup ? 'Create account' : 'Continue'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-border-primary text-center">
            <button
              onClick={toggleMode}
              className="text-sm text-text-tertiary hover:text-text-primary transition-colors"
            >
              {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-text-quaternary">
          By continuing, you agree to ALIN's Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
