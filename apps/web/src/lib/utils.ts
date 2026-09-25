import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function messageBodyPreview(body: string, maxLength = 80): string {
  const plainText = body
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plainText.length > maxLength ? `${plainText.slice(0, maxLength)}...` : plainText;
}
