/**
 * AuthPage - Login/Signup/Verification for ALIN
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

  // Resend cooldown timer
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
    if (!/^\d*$/.test(value)) return; // digits only
    const newCode = [...code];
    newCode[index] = value.slice(-1); // single digit
    setCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      codeRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
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
      const newCode = pasted.split('');
      setCode(newCode);
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
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="text-4xl font-bold text-text-primary tracking-tight">ALIN</h1>
            <p className="mt-2 text-sm text-text-tertiary">Verify your email</p>
          </div>

          <div className="rounded-xl border border-border-primary bg-background-secondary p-6 shadow-lg">
            <p className="mb-1 text-sm text-text-secondary text-center">
              We sent a 6-digit code to
            </p>
            <p className="mb-6 text-sm font-medium text-text-primary text-center">
              {verificationEmail}
            </p>

            {error && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 text-center">
                {error}
              </div>
            )}

            {/* 6-digit code input */}
            <div className="flex justify-center gap-2 mb-6" onPaste={handleCodePaste}>
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
                  className="w-12 h-14 rounded-lg border border-border-primary bg-background-primary text-center text-xl font-bold text-text-primary outline-none transition-colors focus:border-brand-primary"
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
                className="text-xs text-text-tertiary hover:text-brand-primary transition-colors disabled:opacity-40"
              >
                {resendCooldown > 0
                  ? `Resend code in ${resendCooldown}s`
                  : "Didn't get the code? Resend"}
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
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-text-primary tracking-tight">ALIN</h1>
          <p className="mt-2 text-sm text-text-tertiary">
            Artificial Life Intelligence Network
          </p>
        </div>

        <div className="rounded-xl border border-border-primary bg-background-secondary p-6 shadow-lg">
          <h2 className="mb-6 text-lg font-semibold text-text-primary">
            {isSignup ? 'Create Account' : 'Welcome Back'}
          </h2>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2.5 text-sm text-text-primary placeholder-text-quaternary outline-none transition-colors focus:border-brand-primary"
                  placeholder="Your name"
                  required
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2.5 text-sm text-text-primary placeholder-text-quaternary outline-none transition-colors focus:border-brand-primary"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2.5 pr-10 text-sm text-text-primary placeholder-text-quaternary outline-none transition-colors focus:border-brand-primary"
                  placeholder="Min 6 characters"
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              className="w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-primary-hover disabled:opacity-50"
            >
              {isLoading ? 'Please wait...' : isSignup ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={toggleMode}
              className="text-xs text-text-tertiary hover:text-brand-primary transition-colors"
            >
              {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-text-quaternary">
          <p>Free tier: 10 messages/hour with Claude 3.5 Sonnet</p>
          <p className="mt-1">Upgrade to Pro for unlimited access</p>
        </div>
      </div>
    </div>
  );
}