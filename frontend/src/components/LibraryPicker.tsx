import { useState } from "react";
import { imageUrl } from "@/api/client";
import type { Character, WardrobeItem, MoodReference } from "@/types";

interface Props {
  type: string; // "character" | wardrobe category | "mood"
  characters: Character[];
  wardrobeItems: WardrobeItem[];
  moods: MoodReference[];
  // For character: id is the character id, referenceIds is the explicit
  // list the user chose (may be empty — backend falls back to FACE_FRONT).
  // For wardrobe / mood: referenceIds is omitted.
  onSelect: (id: string, referenceIds?: string[]) => void;
  onClose: () => void;
  // When a character is already active, pass its id + currently selected refs
  // so the drill-in view opens with that state pre-populated.
  initialCharacterId?: string | null;
  initialReferenceIds?: string[];
}

interface PickerEntry {
  id: string;
  name: string;
  image_id: string | null;
  sub?: string;
  imageCount?: number;
}

export default function LibraryPicker({
  type,
  characters,
  wardrobeItems,
  moods,
  onSelect,
  onClose,
  initialCharacterId = null,
  initialReferenceIds = [],
}: Props) {
  // Character drill-in: when type === "character" and a character is picked,
  // we swap to a view that lets the user toggle which of that character's
  // references to use. Initial state respects the currently-active character.
  const [drillId, setDrillId] = useState<string | null>(
    type === "character" ? initialCharacterId : null,
  );

  if (type === "character" && drillId) {
    const drillChar = characters.find((c) => c.id === drillId);
    if (!drillChar) {
      // Race / stale id — bounce back to the grid.
      setDrillId(null);
      return null;
    }
    return (
      <CharacterDrillView
        char={drillChar}
        // If we drilled in via the slot's currently-active character, keep
        // their existing selection. Otherwise default to ALL refs for max
        // identity preservation; the user can uncheck for cost/limit.
        initialSelected={
          drillChar.id === initialCharacterId && initialReferenceIds.length > 0
            ? initialReferenceIds
            : drillChar.references.map((r) => r.id)
        }
        onBack={() => setDrillId(null)}
        onConfirm={(refIds) => onSelect(drillChar.id, refIds)}
        onClose={onClose}
      />
    );
  }

  let title = "";
  let items: PickerEntry[] = [];

  if (type === "character") {
    title = "캐릭터 선택";
    items = characters.map((c) => ({
      id: c.id,
      name: c.name,
      image_id: c.base_image_id,
      sub: c.persona?.style,
      imageCount: c.references?.length || 0,
    }));
  } else if (type === "mood") {
    title = "무드 레퍼런스 선택";
    items = moods.map((m) => ({
      id: m.id,
      name: m.name,
      image_id: m.image_id,
      sub: m.tags,
    }));
  } else {
    title = `${type.toUpperCase()} 선택`;
    items = wardrobeItems
      .filter((i) => i.category === type)
      .map((i) => ({
        id: i.id,
        name: i.name,
        image_id: i.images[0]?.image_id ?? null,
        sub: i.notes || undefined,
        imageCount: i.images.length,
      }));
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <h3 className="font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="text-center text-gray-400 py-8">
              사용 가능한 아이템이 없습니다. 먼저 추가해주세요.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    if (type === "character") {
                      setDrillId(item.id);
                    } else {
                      onSelect(item.id);
                    }
                  }}
                  className="text-left border rounded-lg overflow-hidden hover:ring-2 hover:ring-gray-900 transition-all"
                >
                  <div className="aspect-square bg-gray-50 relative">
                    {item.image_id ? (
                      <img
                        src={imageUrl(item.image_id)}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-xs">
                        no image
                      </div>
                    )}
                    {item.imageCount !== undefined && item.imageCount > 1 && (
                      <span className="absolute top-1.5 left-1.5 text-[10px] font-mono px-1.5 py-0.5 bg-black/70 text-white rounded">
                        {type === "character"
                          ? `${item.imageCount} refs`
                          : `${item.imageCount} imgs`}
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    {item.sub && (
                      <p className="text-xs text-gray-400 truncate">{item.sub}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface CharacterDrillProps {
  char: Character;
  initialSelected: string[];
  onBack: () => void;
  onConfirm: (refIds: string[]) => void;
  onClose: () => void;
}

function CharacterDrillView({
  char,
  initialSelected,
  onBack,
  onConfirm,
  onClose,
}: CharacterDrillProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected),
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(char.references.map((r) => r.id)));
  const clearAll = () => setSelected(new Set());

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onBack}
              className="text-gray-400 hover:text-gray-700 text-base leading-none flex-shrink-0"
              aria-label="뒤로"
            >
              ‹
            </button>
            <img
              src={imageUrl(char.base_image_id)}
              alt={char.name}
              className="w-9 h-9 rounded object-cover flex-shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{char.name}</p>
              <p className="text-xs text-gray-400">
                사용할 레퍼런스 선택 ({selected.size} / {char.references.length})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none flex-shrink-0"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {char.references.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">
              <p>이 캐릭터에는 레퍼런스가 없습니다.</p>
              <p className="mt-1 text-xs">캐릭터 페이지에서 확장으로 추가해주세요.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3 text-xs">
                <button
                  onClick={selectAll}
                  className="px-2 py-1 border rounded-md hover:bg-gray-50"
                >
                  전체
                </button>
                <button
                  onClick={clearAll}
                  className="px-2 py-1 border rounded-md hover:bg-gray-50"
                >
                  해제
                </button>
                <span className="text-gray-400 ml-1">
                  많을수록 인물 일관성 ↑, 다른 슬롯 사용 가능 한도 ↓
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {char.references.map((ref) => {
                  const isOn = selected.has(ref.id);
                  return (
                    <button
                      key={ref.id}
                      onClick={() => toggle(ref.id)}
                      className={`relative text-left border rounded-lg overflow-hidden transition-all ${
                        isOn
                          ? "ring-2 ring-gray-900 border-gray-900"
                          : "hover:ring-2 hover:ring-gray-300"
                      }`}
                    >
                      <div className="aspect-square bg-gray-50">
                        <img
                          src={imageUrl(ref.image_id)}
                          alt={ref.role}
                          className={`w-full h-full object-cover transition-opacity ${
                            isOn ? "" : "opacity-60"
                          }`}
                        />
                      </div>
                      <div className="p-1.5">
                        <p className="text-[11px] font-mono text-gray-500 truncate">
                          {ref.role}
                        </p>
                      </div>
                      <span
                        className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
                          isOn
                            ? "bg-gray-900 text-white"
                            : "bg-white/90 text-gray-500 border"
                        }`}
                      >
                        {isOn ? "✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t flex-shrink-0 gap-2">
          <p className="text-xs text-gray-500">
            {selected.size === 0
              ? "선택 없음 — 정면 기본 1장 사용"
              : `${selected.size}장 사용`}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onBack}
              className="px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={() => onConfirm(Array.from(selected))}
              className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800"
            >
              적용
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
