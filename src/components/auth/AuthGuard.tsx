/**
 * AuthGuard - Wraps app, shows AuthPage if not authenticated
 */

import { useEffect, useState, lazy, Suspense } from 'react';
import { useAuthStore } from '@store/authStore';
import { LoadingScreen } from '@components/ui/LoadingScreen';

const AuthPage = lazy(() => import('./AuthPage'));

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, token, fetchProfile } = useAuthStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (token) {
      fetchProfile().finally(() => setChecked(true));
    } else {
      setChecked(true);
    }
  }, []);

  if (!checked) {
    return <LoadingScreen message="Checking authentication..." />;
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<LoadingScreen message="Loading..." />}>
        <AuthPage />
      </Suspense>
    );
  }

  return <>{children}</>;
}
