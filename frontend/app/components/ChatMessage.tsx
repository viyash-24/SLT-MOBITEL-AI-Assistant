"use client";

import Image from "next/image";
import { CheckCheck, ChevronDown, Copy, FileText, Globe2, RefreshCw, Share2, ThumbsDown, ThumbsUp, Verified } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import type { ChatMessageData } from "../types/chat";

type ChatMessageProps = {
  message: ChatMessageData;
  openSource: boolean;
  onToggleSource: () => void;
  onCopy: (text: string) => void;
};

const plans = [
  ["Flagship", "100 Mbps", "Fibre Unlimited Flash", "Truly unlimited download with no speed throttling.", "LKR 6,890", "blue"],
  ["Popular", "250 GB", "Fibre Family Plus", "125 GB Standard + 125 GB Free Night Quota. Up to 100 Mbps.", "LKR 3,990", "green"],
  ["Standard", "120 GB", "Fibre Web Booster", "60 GB Anytime + 60 GB Night Bonus. High-speed optical line.", "LKR 2,290", "slate"],
];

function formatInlineText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function FormattedResponse({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  return <div className="response-content">
    {lines.map((line, index) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return <div className="response-spacer" key={`spacer-${index}`} />;

      const heading = trimmedLine.match(/^#{1,3}\s+(.+)$/);
      if (heading) return <h3 key={index}>{formatInlineText(heading[1])}</h3>;

      const bullet = trimmedLine.match(/^[-*]\s+(.+)$/);
      if (bullet) return <div className="response-list-item" key={index}><span className="response-bullet">•</span><span>{formatInlineText(bullet[1])}</span></div>;

      const numbered = trimmedLine.match(/^(\d+)[.)]\s+(.+)$/);
      if (numbered) return <div className="response-list-item" key={index}><span className="response-number">{numbered[1]}.</span><span>{formatInlineText(numbered[2])}</span></div>;

      return <p key={index}>{formatInlineText(trimmedLine)}</p>;
    })}
  </div>;
}

export function ChatMessage({ message, openSource, onToggleSource, onCopy }: ChatMessageProps) {
  const [copyDone, setCopyDone] = useState(false);

  const handleCopy = () => {
    onCopy(message.content);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 1600);
  };

  if (message.role === "user") {
    return (
      <div className="message-row user-message">
        <div>
          <div className="user-bubble">{message.content}</div>
          <div className="message-meta user-meta">
            {message.time}
            <CheckCheck size={14} />
          </div>
        </div>
      </div>
    );
  }

  const apiSources = message.sources ?? [];
  const hasSources = apiSources.length > 0 || message.kind != null;
  const sourceCount = apiSources.length > 0 ? apiSources.length : message.kind === "fibre" ? 2 : 1;

  return (
    <div className="message-row assistant-message">
      <div className="assistant-avatar">
        <Image src="/images/logo.svg" alt="SLT-MOBITEL" width={23} height={23} />
        <i />
      </div>
      <div className="assistant-column">
        <div className="assistant-bubble">
          <FormattedResponse content={message.content} />

          {message.kind === "fibre" && (
            <>
              <div className="plan-grid">
                {plans.map(([tag, quota, title, description, price, tone]) => (
                  <div className="plan-card" key={title}>
                    <div className="plan-top">
                      <span className={`plan-tag ${tone}`}>{tag}</span>
                      <span>{quota}</span>
                    </div>
                    <h4>{title}</h4>
                    <small>{description}</small>
                    <div className="plan-price">
                      <strong>{price}</strong>
                      <span>/mo + tax</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="benefits-box">
                <span className="eyebrow">Key benefits included with every fibre line</span>
                <ul>
                  <li><span>✓</span><b>Free SLT Digital Voice</b> connection with zero monthly voice rental.</li>
                  <li><span>✓</span><b>Ultra-low latency streaming</b> optimized for Netflix, YouTube &amp; PeoTV.</li>
                  <li><span>✓</span><b>24/7 technical support</b> via quick helpline 1212.</li>
                </ul>
              </div>
              <p>Would you like me to check Fibre line availability for your specific area or calculate exact installation fees?</p>
            </>
          )}

          {message.kind === "roaming" && (
            <div className="roaming-details">
              <div>
                <h4><span className="dot blue-dot" />1. Postpaid Subscribers</h4>
                <ul>
                  <li><b>Activation:</b> Dial <code>#999#</code> or use the SLT-MOBITEL Selfcare App.</li>
                  <li><b>Required deposit:</b> LKR 10,000 for standard voice &amp; data roaming.</li>
                  <li><b>Special Singapore combo:</b> Unlimited Data Roaming Booster at <b>USD $5 / day</b>.</li>
                </ul>
              </div>
              <div>
                <h4><span className="dot green-dot" />2. Prepaid Subscribers</h4>
                <ul>
                  <li><b>Activation:</b> Dial <code>#999#</code> and select Prepaid Roaming Activation.</li>
                  <li><b>Required deposit:</b> <em>Zero deposit required.</em> Maintain LKR 1,000 balance.</li>
                </ul>
              </div>
              <div className="travel-tip">
                <Globe2 size={20} />
                <span><b>Important travel tip:</b> Switch on data roaming after landing. Your device can connect to Singtel or StarHub.</span>
              </div>
            </div>
          )}

          {hasSources && (
            <>
              <button className="source-toggle" onClick={onToggleSource}>
                <span>
                  <Verified size={17} />
                  {sourceCount} Verified Source{sourceCount !== 1 ? "s" : ""} from SLT-MOBITEL Knowledge Base
                </span>
                <ChevronDown size={18} className={openSource ? "rotated" : ""} />
              </button>
              {openSource && (
                <div className="source-list">
                  {apiSources.map((src, i) => (
                    <div key={i}>
                      <FileText size={16} />
                      <span>{src.title}</span>
                      <small>{src.category}</small>
                    </div>
                  ))}
                  {apiSources.length === 0 && message.kind === "fibre" && (
                    <>
                      <div>
                        <FileText size={16} />
                        <span>Official Broadband Tariff Guide 2024</span>
                        <small>p. 18</small>
                      </div>
                      <div>
                        <FileText size={16} />
                        <span>Voice &amp; PeoTV Bundle Guidelines</span>
                        <small>p. 04</small>
                      </div>
                    </>
                  )}
                  {apiSources.length === 0 && message.kind === "roaming" && (
                    <div>
                      <FileText size={16} />
                      <span>Global Roaming Tariffs &amp; Partner Directory</span>
                      <small>Live API</small>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="message-actions">
          <button aria-label="Copy response" onClick={handleCopy}>
            <Copy size={15} />
            {copyDone && <span style={{ fontSize: "11px", marginLeft: "4px" }}>Copied!</span>}
          </button>
          <button aria-label="Helpful response"><ThumbsUp size={15} /></button>
          <button aria-label="Not helpful"><ThumbsDown size={15} /></button>
          <button aria-label="Regenerate"><RefreshCw size={15} /></button>
          <button aria-label="Share"><Share2 size={15} /></button>
          {message.confidence && <span>Confidence: {message.confidence}</span>}
        </div>
      </div>
    </div>
  );
}

