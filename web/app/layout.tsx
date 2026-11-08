import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Playfair_Display } from "next/font/google";
import { AppProviders } from "@/components/AppProviders";
import "./globals.css";
import "leaflet/dist/leaflet.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-plus-jakarta-sans" });
const script = Playfair_Display({ subsets: ["latin"], style: "italic", weight: "500", variable: "--font-playfair-display" });

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
    <html lang="en" data-scroll-behavior="smooth" className={`${sans.variable} ${script.variable} ${sans.className}`}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
