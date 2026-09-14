import { MapPin, Plus, Sprout, Trash2, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import {
  Button,
  Card,
  EmptyState,
  Input,
  Spinner,
  type ButtonVariant,
  type SpinnerSize,
} from '@/shared/components';

const BUTTON_VARIANTS: readonly {
  variant: ButtonVariant;
  label: string;
  icon: LucideIcon;
}[] = [
  { variant: 'primary', label: 'Save plot', icon: Plus },
  { variant: 'secondary', label: 'Cancel', icon: X },
  { variant: 'danger', label: 'Delete plot', icon: Trash2 },
];

const SPINNER_SIZES: readonly SpinnerSize[] = ['sm', 'md', 'lg'];

/**
 * Every shared primitive in every variant and state, so a change to the design
 * system can be checked by eye without Storybook. Development builds only; see
 * `app/router.tsx`. Copy here is fixture text and is not translated.
 */
export function ComponentsPage(): ReactElement {
  return (
    <div className="min-h-dvh bg-muted-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-8 lg:px-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-primary-700">Development</p>
          <h1 className="text-2xl font-semibold">Components</h1>
          <p className="text-sm text-muted">
            Primitives from <code className="font-mono">src/shared/components</code>, in every
            variant and state.
          </p>
        </header>

        <ButtonSection />
        <InputSection />
        <CardSection />
        <SpinnerSection />
        <EmptyStateSection />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A labelled example. The caption is the prop combination that produced it. */
function Specimen({ caption, children }: { caption: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs text-muted">{caption}</p>
      {children}
    </div>
  );
}

function ButtonSection(): ReactElement {
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!saving) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSaving(false);
    }, 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [saving]);

  return (
    <Section title="Button">
      <Card className="flex flex-col gap-6">
        {BUTTON_VARIANTS.map(({ variant, label, icon: Icon }) => (
          <Specimen key={variant} caption={`variant="${variant}"`}>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant={variant}>{label}</Button>
              <Button variant={variant}>
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Button>
              <Button variant={variant} disabled>
                {label}
              </Button>
              <Button variant={variant} loading>
                {label}
              </Button>
              <Button variant={variant} aria-label={label} className="px-0">
                <Icon className="h-5 w-5" aria-hidden />
              </Button>
            </div>
          </Specimen>
        ))}

        <Specimen caption="loading, toggled by click">
          <div>
            <Button
              loading={saving}
              onClick={() => {
                setSaving(true);
              }}
            >
              Save for 1.5s
            </Button>
          </div>
        </Specimen>

        <Specimen caption='className="w-full"'>
          <Button className="w-full">Full width</Button>
        </Specimen>
      </Card>
    </Section>
  );
}

function InputSection(): ReactElement {
  return (
    <Section title="Input">
      <Card className="grid gap-6 sm:grid-cols-2">
        <Input label="Plot name" placeholder="e.g. North paddy" />
        <Input
          label="Phone number"
          type="tel"
          inputMode="tel"
          hint="Include the country code, e.g. +94"
        />
        <Input
          label="Area (acres)"
          inputMode="decimal"
          defaultValue="-2"
          error="Area must be greater than zero."
        />
        <Input
          label="Verification code"
          inputMode="numeric"
          hint="Sent by SMS"
          error="That code has expired."
          className="tracking-widest"
          defaultValue="4821"
        />
        <Input label="District" defaultValue="Anuradhapura" disabled />
        <Input label="Name" required placeholder="required" />
      </Card>
    </Section>
  );
}

function CardSection(): ReactElement {
  return (
    <Section title="Card">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <Specimen caption='padding="md" (default)'>
            <p className="text-sm">Content sits on a white surface with a hairline border.</p>
          </Specimen>
        </Card>
        <Card padding="sm">
          <Specimen caption='padding="sm"'>
            <p className="text-sm">Tighter, for dense lists.</p>
          </Specimen>
        </Card>
        <Card padding="none">
          <div className="flex h-24 items-center justify-center bg-primary-100 text-primary-700">
            <Sprout className="h-8 w-8" aria-hidden />
          </div>
          <div className="p-4">
            <Specimen caption='padding="none"'>
              <p className="text-sm">Media runs to the edge and is clipped to the corners.</p>
            </Specimen>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function SpinnerSection(): ReactElement {
  return (
    <Section title="Spinner">
      <Card className="flex flex-wrap items-end gap-8">
        {SPINNER_SIZES.map((size) => (
          <Specimen key={size} caption={`size="${size}"`}>
            <Spinner size={size} className="text-primary" />
          </Specimen>
        ))}
        <Specimen caption="inherits text colour">
          <div className="flex items-center gap-4">
            <Spinner className="text-danger" />
            <Spinner className="text-muted" />
            <span className="flex rounded-lg bg-primary-700 p-2 text-white">
              <Spinner />
            </span>
          </div>
        </Specimen>
      </Card>
    </Section>
  );
}

function EmptyStateSection(): ReactElement {
  return (
    <Section title="EmptyState">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card padding="none">
          <EmptyState title="Nothing here yet" />
        </Card>
        <Card padding="none">
          <EmptyState
            icon={MapPin}
            title="No plots yet"
            description="Plots you add appear here, even when you are offline."
          />
        </Card>
        <Card padding="none">
          <EmptyState
            icon={MapPin}
            title="No plots yet"
            description="Add your first plot to start tracking crops and harvests."
            action={
              <Button>
                <Plus className="h-4 w-4" aria-hidden />
                Add plot
              </Button>
            }
          />
        </Card>
      </div>
    </Section>
  );
}
