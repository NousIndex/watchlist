"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();

  const submit = async () => {
    setErr("");
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (r.ok) router.replace("/");
    else setErr("Wrong password");
  };

  return (
    <div className="login">
      <h1>StockWatch</h1>
      <input
        type="password"
        placeholder="Password"
        value={pw}
        autoFocus
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <div className="err">{err}</div>
      <button onClick={submit}>Unlock</button>
    </div>
  );
}
