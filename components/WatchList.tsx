"use client";
import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Tab } from "@/lib/types";
import { useWatchlist } from "@/lib/store";
import { Row } from "./Row";

interface Props {
  tab: Tab;
  editMode: boolean;
  onOpen: (symbol: string) => void;
  onRenameSection: (sectionId: string, current: string) => void;
}

function SectionBody({
  sectionId,
  children,
}: {
  sectionId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: sectionId });
  return <div ref={setNodeRef}>{children}</div>;
}

export function WatchList({ tab, editMode, onOpen, onRenameSection }: Props) {
  const { moveSymbol, removeSymbol, moveSection, deleteSection } = useWatchlist();
  const [activeSym, setActiveSym] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } })
  );

  const findContainer = (id: string): string | undefined => {
    if (tab.sections.some((s) => s.id === id)) return id;
    return tab.sections.find((s) => s.symbols.includes(id))?.id;
  };

  const onDragStart = (e: DragStartEvent) => setActiveSym(String(e.active.id));

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const from = findContainer(String(active.id));
    const to = findContainer(String(over.id));
    if (!from || !to || from === to) return;
    const toSec = tab.sections.find((s) => s.id === to)!;
    const overIndex = toSec.symbols.indexOf(String(over.id));
    const idx = overIndex >= 0 ? overIndex : toSec.symbols.length;
    moveSymbol(tab.id, String(active.id), to, idx);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveSym(null);
    const { active, over } = e;
    if (!over) return;
    const from = findContainer(String(active.id));
    const to = findContainer(String(over.id));
    if (!from || !to || from !== to) return;
    const sec = tab.sections.find((s) => s.id === to)!;
    const oldIndex = sec.symbols.indexOf(String(active.id));
    let newIndex = sec.symbols.indexOf(String(over.id));
    if (newIndex < 0) newIndex = sec.symbols.length - 1;
    if (oldIndex !== newIndex) moveSymbol(tab.id, String(active.id), to, newIndex);
  };

  const totalSymbols = tab.sections.reduce((n, s) => n + s.symbols.length, 0);

  const body = tab.sections.map((sec, i) => (
    <div key={sec.id}>
      {(sec.name !== null || editMode) && (
        <div className="section-hdr">
          {editMode ? (
            <>
              <button onClick={() => moveSection(tab.id, sec.id, -1)} disabled={i === 0} aria-label="Move section up">
                ↑
              </button>
              <button
                onClick={() => moveSection(tab.id, sec.id, 1)}
                disabled={i === tab.sections.length - 1}
                aria-label="Move section down"
              >
                ↓
              </button>
              <button className="grow" style={{ textAlign: "left" }} onClick={() => onRenameSection(sec.id, sec.name ?? "")}>
                {sec.name ?? "(unnamed section)"} ✎
              </button>
              <button
                className="danger"
                aria-label="Delete section"
                onClick={() => {
                  if (
                    sec.symbols.length === 0 ||
                    confirm(`Delete section "${sec.name ?? "unnamed"}" and its ${sec.symbols.length} tickers?`)
                  )
                    deleteSection(tab.id, sec.id);
                }}
              >
                ✕
              </button>
            </>
          ) : (
            <span>{sec.name}</span>
          )}
        </div>
      )}
      <SectionBody sectionId={sec.id}>
        <SortableContext items={sec.symbols} strategy={verticalListSortingStrategy}>
          {sec.symbols.map((sym) => (
            <Row
              key={sym}
              symbol={sym}
              editMode={editMode}
              onOpen={onOpen}
              onRemove={(s) => removeSymbol(tab.id, s)}
            />
          ))}
        </SortableContext>
      </SectionBody>
    </div>
  ));

  return (
    <>
      {totalSymbols === 0 && !editMode && (
        <div className="empty-hint">
          This list is empty.
          <br />
          Tap + to search and add tickers.
        </div>
      )}
      {editMode ? (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveSym(null)}
        >
          {body}
          <DragOverlay>{activeSym ? <div className="row">{activeSym}</div> : null}</DragOverlay>
        </DndContext>
      ) : (
        body
      )}
    </>
  );
}
