"use client";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useWatchlist, ALL_TAB_ID } from "@/lib/store";

function TabChip({ id, name, active, onSelect }: { id: string; name: string; active: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`tab${active ? " on" : ""}${isDragging ? " dragging" : ""}`}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      {name}
    </button>
  );
}

export function TabBar({ onAddTab }: { onAddTab: () => void }) {
  const { tabs, activeTabId, setActiveTab, reorderTabs } = useWatchlist();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) reorderTabs(String(active.id), String(over.id));
  };

  return (
    <div className="tabs">
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          {tabs.map((t) => (
            <TabChip
              key={t.id}
              id={t.id}
              name={t.name}
              active={t.id === activeTabId}
              onSelect={() => setActiveTab(t.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        className={`tab all${activeTabId === ALL_TAB_ID ? " on" : ""}`}
        onClick={() => setActiveTab(ALL_TAB_ID)}
      >
        All
      </button>
      <button className="tab" onClick={onAddTab} aria-label="Add tab">
        +
      </button>
    </div>
  );
}
