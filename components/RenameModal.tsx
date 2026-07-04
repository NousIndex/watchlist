"use client";
import { useState } from "react";

interface Props {
  title: string;
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

export function RenameModal({ title, initial, onSave, onClose }: Props) {
  const [v, setV] = useState(initial);
  const save = () => {
    const name = v.trim();
    if (name) onSave(name);
    onClose();
  };
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-hdr">
          <span>{title}</span>
        </div>
        <div className="rename-box">
          <input
            value={v}
            autoFocus
            placeholder="Name"
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <div className="rename-actions">
            <button className="muted-btn" onClick={onClose}>
              Cancel
            </button>
            <button onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </>
  );
}
