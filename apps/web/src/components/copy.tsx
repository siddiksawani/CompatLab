"use client";
import { useEffect, useState } from "react";
export function Copy({ value, label }: { value: string; label: string }) {
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copied.");
    } catch {
      setMessage("Select and copy the text below.");
    }
  }
  return (
    <div className="copy">
      <button type="button" className="secondary" disabled={!ready} onClick={() => void copy()}>
        {label}
      </button>
      <span className="fine" role="status">
        {message}
      </span>
      {message.startsWith("Select") && (
        <input
          aria-label={label}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}
