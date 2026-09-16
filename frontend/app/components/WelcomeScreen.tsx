"use client";

import Image from "next/image";
import { ArrowRight, CreditCard, Gauge, Radio, Wrench } from "lucide-react";
type WelcomeScreenProps = { onStart?: () => void; onPrompt: (prompt: string) => void };
const categories = [{ icon: Gauge, title: "Fibre & Home Broadband", text: "Check FTTH plans, download caps, night bonuses, and new connections.", tags: ["Unlimited Plans", "Line Feasibility"], tone: "blue" }, { icon: Radio, title: "Mobile & Roaming Services", text: "Manage prepaid reloads, postpaid data, 5G trials, and roaming activation.", tags: ["Data Passes", "#999# Portal"], tone: "green" }, { icon: CreditCard, title: "Billing & Fast Online Pay", text: "Download your e-bill, check your balance, or make an instant payment.", tags: ["Instant Receipt", "Auto-Debit"], tone: "slate" }, { icon: Wrench, title: "Fault Diagnostics & Tickets", text: "Test fibre signal levels, reset your ONT router, or file a trouble ticket.", tags: ["ONT Remote Reset", "Track Ticket"], tone: "dark" }];
export function WelcomeScreen({ onPrompt }: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-heading">
        <div className="welcome-icon">
          <Image src="/images/logo.svg" alt="SLT-MOBITEL" width={180} height={68} priority />
        </div>
        <h2>Welcome! How can we help today?</h2>
        <p>Ask questions about SLT Fibre broadband, Mobitel 4G/5G mobile plans, roaming packages, bill payments, and troubleshooting.</p>
      </div>
      <div className="category-grid">
        {categories.map(({ icon: Icon, title, text, tags, tone }) => (
          <button className="category-card" key={title} onClick={() => onPrompt(title)}>
            <div className="category-top">
              <span className={`category-icon ${tone}`}><Icon size={22} /></span>
              <ArrowRight size={18} />
            </div>
            <h3>{title}</h3>
            <p>{text}</p>
            <div className="tag-row">
              {tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

