"use client";

import Image from "next/image";
import { ArrowRight, CreditCard, Gauge, Radio, Wrench } from "lucide-react";
type WelcomeScreenProps = { onStart?: () => void; onPrompt: (prompt: string) => void };
const categories = [{ icon: Gauge, title: "Fibre & Home Broadband", text: "Check FTTH plans, download caps, night bonuses, and new connections.", tags: ["Unlimited Plans", "Line Feasibility"], tone: "blue" }, { icon: Radio, title: "Mobile & Roaming Services", text: "Manage prepaid reloads, postpaid data, 5G trials, and roaming activation.", tags: ["Data Passes", "#999# Portal"], tone: "green" }, { icon: CreditCard, title: "Billing & Fast Online Pay", text: "Download your e-bill, check your balance, or make an instant payment.", tags: ["Instant Receipt", "Auto-Debit"], tone: "slate" }, { icon: Wrench, title: "Fault Diagnostics & Tickets", text: "Test fibre signal levels, reset your ONT router, or file a trouble ticket.", tags: ["ONT Remote Reset", "Track Ticket"], tone: "dark" }];
export function WelcomeScreen({ onPrompt }: WelcomeScreenProps) {
  