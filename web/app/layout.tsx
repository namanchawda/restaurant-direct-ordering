import type { Metadata } from "next";
import { DM_Sans, Archivo_Black, Bagel_Fat_One, Caveat } from "next/font/google";
import { AppProviders } from "@/components/AppProviders";
import "./globals.css";
import "leaflet/dist/leaflet.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const heading = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-archivo-black" });
const display = Bagel_Fat_One({ subsets: ["latin"], weight: "400", variable: "--font-bagel" });
const hand = Caveat({ subsets: ["latin"], variable: "--font-caveat" });

export const metadata: Metadata = {
  title: "Hyderabad Biryani | Order direct",
  description: "Fresh biryani and Hyderabadi favorites, delivered from a nearby kitchen.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${sans.variable} ${heading.variable} ${display.variable} ${hand.variable} ${sans.className}`}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
