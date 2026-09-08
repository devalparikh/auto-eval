import type { Metadata } from "next";
import { OnboardingGuide } from "@/features/systems/onboarding-guide";

export const metadata: Metadata = { title: "Connect your agent" };

export default function GuidePage() {
  return <OnboardingGuide />;
}
