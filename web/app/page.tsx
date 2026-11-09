import { SiteHeader } from "@/components/customer/SiteHeader";
import { HomeHero } from "@/components/customer/HomeHero";
import { LandingSections } from "@/components/customer/LandingSections";
import { LandingBuilder } from "@/components/customer/LandingBuilder";
import "@/components/customer/home-theme.css";
import "@/components/customer/components-theme.css";

export default function Home() {
  return (
    <main className="customer-page hb-themed">
      <div className="hb-checker" aria-hidden="true" />
      <SiteHeader />
      <HomeHero />
      <LandingSections />
      <LandingBuilder />
    </main>
  );
}
