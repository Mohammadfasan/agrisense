import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/features/auth';

export function ProfilePage(): ReactElement {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('profile.title', 'Profile')}</h2>
      {user && (
        <div className="flex flex-col gap-1">
          <p className="font-medium">{user.name}</p>
          <p className="text-sm text-muted">{user.phone}</p>
        </div>
      )}
      <button type="button" className="btn-ghost self-start" onClick={logout}>
        {t('auth.signOut', 'Sign out')}
      </button>
    </section>
  );
}
