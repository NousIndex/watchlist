"use client";
import { useEffect, useState } from "react";
import { useWatchlist, buildAllTab, ALL_TAB_ID } from "@/lib/store";
import { engine } from "@/lib/engine";
import { TabBar } from "@/components/TabBar";
import { WatchList } from "@/components/WatchList";
import { Earnings } from "@/components/Earnings";
import { AddSheet } from "@/components/AddSheet";
import { ChartModal } from "@/components/ChartModal";
import { RenameModal } from "@/components/RenameModal";

type Rename =
  | { kind: "new-tab" }
  | { kind: "tab"; id: string; current: string }
  | { kind: "new-section" }
  | { kind: "section"; id: string; current: string }
  | null;

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const {
    tabs,
    activeTabId,
    currency,
    editMode,
    setCurrency,
    setEditMode,
    setActiveTab,
    addTab,
    renameTab,
    deleteTab,
    addSection,
    renameSection,
  } = useWatchlist();

  const [showAdd, setShowAdd] = useState(false);
  const [chartSym, setChartSym] = useState<string | null>(null);
  const [rename, setRename] = useState<Rename>(null);
  const [showEarnings, setShowEarnings] = useState(false);

  useEffect(() => {
    setMounted(true);
    engine.start();
  }, []);

  useEffect(() => {
    if (mounted && activeTabId !== ALL_TAB_ID && !tabs.some((t) => t.id === activeTabId)) {
      setActiveTab(tabs[0]?.id ?? "");
    }
  }, [mounted, tabs, activeTabId, setActiveTab]);

  if (!mounted) return null;

  const isAll = activeTabId === ALL_TAB_ID;
  const tab = isAll ? buildAllTab(tabs) : tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  if (!tab) return null;

  return (
    <div className="app">
      <header className="hdr">
        <div className="hdr-row">
          <div className="hdr-left">
            <div className="seg">
              <button className={currency === "USD" ? "on" : ""} onClick={() => setCurrency("USD")}>
                USD
              </button>
              <button className={currency === "SGD" ? "on" : ""} onClick={() => setCurrency("SGD")}>
                SGD
              </button>
            </div>
            <button
              className={`icon-btn${showEarnings ? " on" : ""}`}
              onClick={() => setShowEarnings((v) => !v)}
              aria-label="Earnings calendar"
              aria-pressed={showEarnings}
              title="Earnings calendar"
            >
              📅
            </button>
          </div>
          <div className="hdr-actions">
            {!isAll && !showEarnings && (
              <button className="text-btn" onClick={() => setEditMode(!editMode)}>
                {editMode ? "Done" : "Edit"}
              </button>
            )}
            <button className="icon-btn" onClick={() => setShowAdd(true)} aria-label="Add symbol">
              +
            </button>
          </div>
        </div>
        {showEarnings ? (
          <div className="tabs">
            <button className="tab on">Earnings</button>
          </div>
        ) : (
          <TabBar onAddTab={() => setRename({ kind: "new-tab" })} />
        )}
        {!showEarnings && editMode && !isAll && (
          <div className="edit-toolbar">
            <button onClick={() => setRename({ kind: "tab", id: tab.id, current: tab.name })}>
              Rename tab
            </button>
            <button
              className="danger"
              onClick={() => {
                if (confirm(`Delete tab "${tab.name}"?`)) deleteTab(tab.id);
              }}
            >
              Delete tab
            </button>
            <button onClick={() => setRename({ kind: "new-section" })}>Add section</button>
          </div>
        )}
      </header>

      {showEarnings ? (
        <Earnings />
      ) : (
        <WatchList
          tab={tab}
          editMode={editMode && !isAll}
          onOpen={(s) => setChartSym(s)}
          onRenameSection={(id, current) => setRename({ kind: "section", id, current })}
        />
      )}

      {showAdd && (
        <AddSheet
          tab={isAll ? tabs[0] : tab}
          pickTab={isAll ? tabs : undefined}
          onClose={() => setShowAdd(false)}
        />
      )}
      {chartSym && <ChartModal symbol={chartSym} onClose={() => setChartSym(null)} />}
      {rename && (
        <RenameModal
          title={
            rename.kind === "new-tab"
              ? "New tab"
              : rename.kind === "new-section"
              ? "New section"
              : rename.kind === "tab"
              ? "Rename tab"
              : "Rename section"
          }
          initial={"current" in rename ? rename.current : ""}
          onClose={() => setRename(null)}
          onSave={(name) => {
            if (rename.kind === "new-tab") addTab(name);
            else if (rename.kind === "new-section") addSection(tab.id, name);
            else if (rename.kind === "tab") renameTab(rename.id, name);
            else renameSection(tab.id, rename.id, name);
          }}
        />
      )}
    </div>
  );
}
