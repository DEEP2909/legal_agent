import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Legal Agent",
  description: "Legal workflow automation platform for Indian law firms"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
