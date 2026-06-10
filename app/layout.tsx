import type { Metadata } from "next";

import "@/app/globals.css";

const title = "World Cup Championship Match Win Calculator";
const description =
  "Live World Cup match centre, group tables, and informational AI match outcome estimates.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    siteName: "World Cup Match Centre",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  other: {
    "theme-color": "#07111d",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}

