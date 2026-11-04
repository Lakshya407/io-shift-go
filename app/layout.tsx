import type { Metadata } from "next";
import "./globals.css";
import "./theme-dark.css";

export const metadata: Metadata = {
  title: "ShiftGo · A safer way home",
  description: "Simple cab check-ins, safe arrivals and an extra line of care for your night shift team.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/io-logo.png",
  },
};

// Applies the saved (or system) light/night theme before first paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem('nightshift-theme');if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
