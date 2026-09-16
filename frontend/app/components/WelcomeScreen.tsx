"use client";

import Image from "next/image";
import { ArrowRight, CreditCard, Gauge, Radio, Wrench } from "lucide-react";
type WelcomeScreenProps = { onStart?: () => void; onPrompt: (prompt: string) => void };
