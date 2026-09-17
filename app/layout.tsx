import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";

import "./globals.css";

/**
 * The two families, self-hosted.
 *
 * index.html fetched these from fonts.googleapis.com with a pair of
 * `preconnect`s and a blocking stylesheet. `next/font` serves them from this
 * origin instead, so there is no third-party request on the critical path and
 * no chance of a flash of unstyled text while it lands.
 *
 * `variable` emits a CSS custom property, applied to <html> below.
 * app/globals.css reads both and adds the fallback chain.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--next-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--next-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "jev demo",
  description: "Node editor and live test bench for a jev-routed support agent",
};

/**
 * Runs before paint, so the page never flashes the wrong theme. "system" means
 * follow the OS; anything else is the user's explicit pick.
 *
 * It has to be inline and it has to be here. A module in the bundle would run
 * after first paint, and a server component cannot read localStorage, so this
 * is the only place the attribute can be set early enough to matter. It is a
 * constant string built at compile time, never anything a request carries,
 * which is what makes `dangerouslySetInnerHTML` safe on this one line.
 *
 * `read` is wrapped because reading storage can throw rather than come back
 * empty: Safari with cookies blocked, and any third-party-blocked iframe,
 * refuse the whole API. components/ThemeToggle.tsx guards the same read.
 */
const THEME_SCRIPT = `(function () {
  try {
    var p = localStorage.getItem("jev-theme") || "system";
    var d = p === "dark" || (p === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = d ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-theme` is rendered as "light" and then corrected by the script
    // above before React ever sees the document, which is a mismatch by
    // design rather than a bug: the prerendered HTML cannot know the
    // preference. suppressHydrationWarning silences it on this element only.
    <html
      lang="en"
      data-theme="light"
      className={`h-full antialiased ${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
