'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 touch:after:absolute touch:after:left-1/2 touch:after:top-1/2 touch:after:h-full touch:after:min-h-11 touch:after:w-full touch:after:min-w-11 touch:after:-translate-x-1/2 touch:after:-translate-y-1/2 touch:after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        mounted
          ? isDark
            ? 'bg-slate-700 border-slate-600'
            : 'bg-sky-100 border-sky-200'
          : 'bg-muted border-border'
      }`}
    >
      {/* Track icons */}
      <Sun
        className={`absolute left-1.5 h-3 w-3 transition-opacity duration-150 ease-out ${
          mounted && !isDark ? 'text-amber-500 opacity-100' : 'opacity-0'
        }`}
      />
      <Moon
        className={`absolute right-1.5 h-3 w-3 transition-opacity duration-150 ease-out ${
          mounted && isDark ? 'text-blue-300 opacity-100' : 'opacity-0'
        }`}
      />

      {/* Thumb */}
      <span
        className={`pointer-events-none block h-5 w-5 rounded-full shadow-sm transition-[transform,background-color] duration-150 ease-out ${
          mounted
            ? isDark
              ? 'translate-x-[22px] bg-slate-900'
              : 'translate-x-[3px] bg-white'
            : 'translate-x-[3px] bg-muted-foreground/20'
        }`}
      >
        {mounted && (
          isDark ? (
            <Moon className="h-3 w-3 m-1 text-blue-300" />
          ) : (
            <Sun className="h-3 w-3 m-1 text-amber-500" />
          )
        )}
      </span>
    </button>
  );
}
