import type { ReactNode } from 'react';

interface HeroTitleProps {
  children: ReactNode;
  className?: string;
}

/**
 * Marketing hero H1. Font-size/line-height shorthand sets both per breakpoint,
 * so `text-6xl`'s own line-height cannot override the intended leading.
 * Usage: <HeroTitle className="mb-4">Title</HeroTitle>
 */
export function HeroTitle({ children, className = '' }: HeroTitleProps) {
  return (
    <h1
      className={`text-[2rem]/[1.2] sm:text-5xl/[1.15] md:text-6xl/[1.15] font-extrabold tracking-tight text-balance hyphens-auto break-words ${className}`.trim()}
    >
      {children}
    </h1>
  );
}
