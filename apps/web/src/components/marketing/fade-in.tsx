'use client';

import { useEffect, useRef, useState } from 'react';

// Fade-in states (styles live in globals.css under `[data-fade]`):
// - 'pending': server render, before hydration. Hidden, with a CSS failsafe that shows the
//   content after a short delay, so it never stays invisible when JS is slow or missing.
// - 'waiting': hydrated and below the fold. Hidden until the IntersectionObserver fires.
// - 'in': visible.
type FadeState = 'pending' | 'waiting' | 'in';

export function FadeIn({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<FadeState>('pending');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined' || el.getBoundingClientRect().top < window.innerHeight) {
      setState('in');
      return;
    }
    setState('waiting');
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState('in');
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      data-fade={state}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
