"use client";
import { useEffect, useState } from "react";
import type { NewsItem } from "@/lib/types";

/** "2h ago", "3d ago" — headlines are only useful with their age attached. */
function age(ts: number): string {
  if (!ts) return "";
  const mins = Math.round((Date.now() / 1000 - ts) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

export function NewsTab({ symbol, name }: { symbol: string; name: string }) {
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setNews(null);
    const q = `symbol=${encodeURIComponent(symbol)}${name ? `&name=${encodeURIComponent(name)}` : ""}`;
    fetch(`/api/news?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { news: NewsItem[] }) => {
        if (cancelled) return;
        setNews(d.news ?? []);
        setState("done");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [symbol, name]);

  if (state === "loading") return <div className="ov-msg">Loading news…</div>;
  if (state === "error") return <div className="ov-msg">News unavailable.</div>;
  if (!news?.length)
    return (
      <div className="ov-msg">
        No recent stories mention this ticker. Coverage is thin for many non-US
        listings and funds.
      </div>
    );

  return (
    <div className="overview">
      <div className="news-list">
        {news.map((n) => (
          <a key={n.id} className="news-item" href={n.link} target="_blank" rel="noreferrer">
            <div className="news-txt">
              <div className="news-title">{n.title}</div>
              <div className="news-meta">
                {n.publisher}
                {n.publisher && n.published ? " · " : ""}
                {age(n.published)}
              </div>
            </div>
            {n.thumbnail && <img className="news-thumb" src={n.thumbnail} alt="" loading="lazy" />}
          </a>
        ))}
      </div>
      <div className="empty-hint" style={{ padding: "18px 0 4px", textAlign: "left" }}>
        Headlines via Yahoo Finance · filtered to stories naming this company.
      </div>
    </div>
  );
}
