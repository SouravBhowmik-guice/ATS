import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATS-Buster | Human-led application automation",
  description: "Prepare internship applications with a transparent human review gate.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
