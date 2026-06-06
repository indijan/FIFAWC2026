import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "World Cup Championship Match Win Calculator",
  description:
    "Live World Cup match centre, group tables, and informational AI match outcome estimates.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

