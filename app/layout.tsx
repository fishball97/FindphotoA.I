import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FindMyFrame — Local event photo finder",
  description: "Find yourself in an event gallery without uploading photos to a server.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
