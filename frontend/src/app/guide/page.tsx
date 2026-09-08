import type { Metadata } from "next";
import { OnboardingGuide } from "@/features/systems/onboarding-guide";

export const metadata: Metadata = { title: "Import guide" };

export default function GuidePage() {
  return <OnboardingGuide />;
}
