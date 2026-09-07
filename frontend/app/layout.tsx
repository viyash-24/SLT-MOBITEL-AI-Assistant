import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "SLT-MOBITEL AI Assistant", description: "Customer support assistant for SLT-MOBITEL services" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) 
          { return <html lang="en">
                    <body>{children}</body></html>; }
