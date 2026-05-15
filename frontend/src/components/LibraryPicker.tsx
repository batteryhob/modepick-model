import { imageUrl } from "@/api/client";
import type { Character, WardrobeItem, MoodReference } from "@/types";

interface Props {
  type: string; // "character" | wardrobe category | "mood"
  characters: Character[];
  wardrobeItems: WardrobeItem[];
  moods: MoodReference[];
  onSelect: (id: string) => void;
  onClose: () => void;
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
}: Props) {
  let title = "";
  let items: PickerEntry[] = [];

  if (type === "character") {
    title = "캐릭터 선택";
    items = characters.map((c) => ({
      id: c.id,
      name: c.name,
      image_id: c.base_image_id,
      sub: c.persona?.style,
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
    // Wardrobe category
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            x
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
                  onClick={() => onSelect(item.id)}
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
                        {item.imageCount} imgs
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
