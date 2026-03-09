import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "The Hundred Years' Medley — Marvin's Arranger",
  description: 'Plan and arrange a 100-year music medley',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
