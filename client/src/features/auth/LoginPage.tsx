import { Leaf } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { SUPPORTED_LANGUAGES } from '@/shared/i18n';

import { useAuthStore } from './auth.store';

export function LoginPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const signIn = useAuthStore((state) => state.signIn);
  const [phone, setPhone] = useState('');

  // Placeholder until the auth module lands on the server.
  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    signIn('dev-token', { id: 'dev-user', name: phone || 'Demo Farmer', role: 'farmer' });
    navigate('/farms', { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2">
        <Leaf className="h-10 w-10 text-primary" aria-hidden />
        <h1 className="text-2xl font-semibold">{t('app.name', 'AgriSense')}</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {t('auth.phone', 'Phone number')}
          <input
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="min-h-touch rounded-lg border border-muted-300 px-3"
          />
        </label>
        <button type="submit" className="btn-primary">
          {t('auth.signIn', 'Sign in')}
        </button>
      </form>

      <div className="flex justify-center gap-2">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => {
              void i18n.changeLanguage(lang.code);
            }}
            className={[
              'btn-ghost px-3',
              i18n.language === lang.code ? 'text-primary font-medium' : '',
            ].join(' ')}
          >
            {lang.label}
          </button>
        ))}
      </div>
    </div>
  );
}
