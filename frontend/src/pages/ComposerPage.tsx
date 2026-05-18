import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, imageUrl } from "@/api/client";
import { useComposerStore } from "@/stores/composer";
import { useToast } from "@/components/Toast";
import type {
  Character,
  WardrobeItem,
  MoodReference,
  ComposerSlots,
  ComposeView,
} from "@/types";
import IconButton from "@/components/IconButton";
import LibraryPicker from "@/components/LibraryPicker";

const WARDROBE_SLOTS: { key: keyof ComposerSlots; label: string; color: string }[] = [
  { key: "top", label: "TOP", color: "border-l-emerald-500" },
  { key: "bottom", label: "BOTTOM", color: "border-l-emerald-500" },
  { key: "outerwear", label: "OUTERWEAR", color: "border-l-emerald-500" },
  { key: "dress", label: "DRESS", color: "border-l-emerald-500" },
  { key: "bag", label: "BAG", color: "border-l-emerald-500" },
  { key: "shoes", label: "SHOES", color: "border-l-emerald-500" },
];

const VIEW_OPTIONS: { value: ComposeView; label: string }[] = [
  { value: "RANDOM", label: "랜덤 (Random)" },
  { value: "FULL_BODY", label: "전신 (Full Shot)" },
  { value: "HALF_BODY", label: "반신 (Medium Shot)" },
  { value: "THREE_QUARTER", label: "3/4 샷 (Medium Long)" },
  { value: "CLOSE_UP", label: "클로즈업 (Close-up)" },
  { value: "PROFILE", label: "측면 프로필 (Profile)" },
  { value: "BACK", label: "뒷모습 (Back)" },
  { value: "HIGH_ANGLE", label: "하이앵글 (High Angle)" },
  { value: "LOW_ANGLE", label: "로우앵글 (Low Angle)" },
];

// Rough mean per-image generation time at quality=medium with several refs,
// based on observed jobs. Used to display an ETA during compose so the user
// has a sense of "how long left" instead of a bare spinner.
const ESTIMATED_COMPOSE_SECONDS = 50;

export default function ComposerPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const {
    activeCharacterId,
    selectedReferenceIds,
    setActiveCharacter,
    setSelectedReferenceIds,
    slots,
    setSlot,
    scene,
    setScene,
    provider,
    setProvider,
    quality,
    setQuality,
    view,
    setView,
  } = useComposerStore();

  const [pickerOpen, setPickerOpen] = useState<string | null>(null);
  const [resultImageId, setResultImageId] = useState<string | null>(null);
  const [resultCost, setResultCost] = useState<number>(0);
  const [resultJobId, setResultJobId] = useState<string | null>(null);
  const [composeJobId, setComposeJobId] = useState<string | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);

  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: api.characters.list,
  });

  const { data: wardrobeData } = useQuery({
    queryKey: ["wardrobe", {}],
    queryFn: () => api.wardrobe.list(),
  });

  const { data: moods = [] } = useQuery({
    queryKey: ["mood"],
    queryFn: api.mood.list,
  });

  const composeMutation = useMutation({
    mutationFn: api.compose,
    onSuccess: (data) => {
      setResultJobId(data.job_id);
      setComposeJobId(data.job_id);
    },
  });

  const { data: composeJob } = useQuery({
    queryKey: ["jobs", composeJobId],
    queryFn: () => api.jobs.get(composeJobId!),
    enabled: !!composeJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "success" || status === "failed" ? false : 3000;
    },
  });

  const saveFeedMutation = useMutation({
    mutationFn: api.feed.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      toast.success("피드에 저장됨");
    },
    onError: (err: Error) => toast.error(`저장 실패: ${err.message}`),
  });

  const activeChar = characters.find((c: Character) => c.id === activeCharacterId);
  const wardrobeItems = wardrobeData?.items || [];

  // Keep selectedReferenceIds aligned with the active character — drop any
  // ids that no longer belong (e.g. character was deleted or refs changed).
  useEffect(() => {
    if (!activeChar) {
      if (selectedReferenceIds.length > 0) setSelectedReferenceIds([]);
      return;
    }
    const valid = new Set(activeChar.references.map((r) => r.id));
    const filtered = selectedReferenceIds.filter((id) => valid.has(id));
    if (filtered.length !== selectedReferenceIds.length) {
      setSelectedReferenceIds(filtered);
    }
  }, [activeChar, selectedReferenceIds, setSelectedReferenceIds]);

  useEffect(() => {
    if (!composeJob) return;

    if (composeJob.status === "success") {
      setResultImageId(composeJob.output_image_ids[0] || null);
      setResultCost(composeJob.cost_estimate_usd || 0);
      setComposeJobId(null);
      setComposeError(null);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("합성 완료");
    }

    if (composeJob.status === "failed") {
      const msg = composeJob.error_message || "합성에 실패했습니다.";
      setComposeError(msg);
      setComposeJobId(null);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.error(`합성 실패: ${msg.slice(0, 100)}`);
    }
  }, [composeJob, queryClient, toast]);

  // Elapsed time during compose for the progress indicator.
  const composeStartedAtRef = useRef<number | null>(null);
  const [composeElapsed, setComposeElapsed] = useState(0);
  const inProgress = composeMutation.isPending || !!composeJobId;

  useEffect(() => {
    if (!inProgress) {
      composeStartedAtRef.current = null;
      setComposeElapsed(0);
      return;
    }
    if (composeStartedAtRef.current === null) {
      composeStartedAtRef.current = Date.now();
    }
    const tick = () => {
      if (composeStartedAtRef.current === null) return;
      setComposeElapsed(Math.floor((Date.now() - composeStartedAtRef.current) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [inProgress]);

  // Get item details for filled slots
  const getSlotItem = (key: string): WardrobeItem | undefined => {
    const id = slots[key as keyof ComposerSlots];
    if (!id) return undefined;
    return wardrobeItems.find((i: WardrobeItem) => i.id === id);
  };

  const getMoodItem = (): MoodReference | undefined => {
    if (!slots.mood) return undefined;
    return moods.find((m: MoodReference) => m.id === slots.mood);
  };

  // Count references for this call. Each wardrobe slot contributes all of the
  // selected product's images, not just one — multiple angles improve fidelity.
  // Character contributes len(selectedReferenceIds) — empty selection falls
  // back to a single FACE_FRONT on the backend, so count it as 1.
  const charRefCount = activeChar
    ? selectedReferenceIds.length > 0
      ? selectedReferenceIds.length
      : 1
    : 0;
  const productRefCount = WARDROBE_SLOTS.reduce(
    (sum, s) => sum + (getSlotItem(s.key)?.images.length ?? 0),
    0,
  );
  const moodRefCount = slots.mood ? 1 : 0;
  const totalRefs = charRefCount + productRefCount + moodRefCount;
  const maxRefs = provider === "openai" ? 16 : 14;

  const canGenerate = !!activeChar && !inProgress && totalRefs <= maxRefs;

  const handleGenerate = () => {
    const charId = activeChar?.id;
    if (!charId) return;
    if (!canGenerate) return;

    setResultImageId(null);
    setResultCost(0);
    setComposeError(null);
    composeMutation.mutate({
      character_id: charId,
      slots,
      scene,
      provider,
      quality,
      character_reference_ids: selectedReferenceIds,
      view,
    });
  };

  const handleSaveToFeed = () => {
    const charId = activeChar?.id;
    if (!charId || !resultImageId) return;
    if (saveFeedMutation.isPending) return;

    saveFeedMutation.mutate({
      character_id: charId,
      image_id: resultImageId,
      slots,
      scene,
    });
  };

  // Global keyboard shortcuts: ⌘/Ctrl+Enter generate, ⌘/Ctrl+S save to feed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleGenerate();
      } else if (e.key.toLowerCase() === "s") {
        if (resultImageId) {
          e.preventDefault();
          handleSaveToFeed();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChar, slots, scene, provider, quality, view, selectedReferenceIds, totalRefs, maxRefs, resultImageId, inProgress, saveFeedMutation.isPending]);

  const handleDiscard = () => {
    setResultImageId(null);
    setResultCost(0);
    setResultJobId(null);
    setComposeJobId(null);
    setComposeError(null);
  };

  // Estimate cost
  const baseCosts: Record<string, Record<string, number>> = {
    openai: { low: 0.02, medium: 0.07, high: 0.19 },
    gemini: { low: 0.01, medium: 0.04, high: 0.10 },
  };
  const estimatedCost = (baseCosts[provider]?.[quality] || 0.07) + totalRefs * 0.01;

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:h-[calc(100vh-8rem)]">
      {/* Left: Slots */}
      <div className="w-full lg:w-[340px] lg:flex-shrink-0 lg:overflow-y-auto space-y-2 lg:pr-1">
        {/* Character Slot */}
        <div
          className="border rounded-lg p-3 bg-white cursor-pointer hover:bg-gray-50 border-l-4 border-l-gray-900"
          onClick={() => setPickerOpen("character")}
        >
          <p className="text-xs font-mono text-gray-400 mb-1">
            캐릭터
            {activeChar && (
              <span className="ml-1 text-gray-500">· 레퍼런스 {charRefCount}장</span>
            )}
          </p>
          {activeChar ? (
            <div className="flex items-center gap-2">
              <img
                src={imageUrl(activeChar.base_image_id)}
                alt={activeChar.name}
                className="w-10 h-10 rounded object-cover"
              />
              <span className="text-sm font-medium">{activeChar.name}</span>
            </div>
          ) : (
            <p className="text-sm text-gray-400">캐릭터를 선택하세요</p>
          )}
        </div>

        {/* Wardrobe Slots */}
        {WARDROBE_SLOTS.map((slot) => {
          const item = getSlotItem(slot.key);
          const cover = item?.images[0];
          return (
            <div
              key={slot.key}
              className={`border rounded-lg p-3 bg-white cursor-pointer hover:bg-gray-50 border-l-4 ${
                item ? slot.color : "border-l-gray-200"
              }`}
              onClick={() => setPickerOpen(slot.key)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {item ? (
                    <>
                      {cover && (
                        <img
                          src={imageUrl(cover.image_id)}
                          alt={item.name}
                          className="w-10 h-10 rounded object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-gray-400">
                          {slot.label}
                          {item.images.length > 1 && (
                            <span className="ml-1 text-gray-500">· {item.images.length}장</span>
                          )}
                        </p>
                        <p className="text-sm font-medium truncate">{item.name}</p>
                      </div>
                    </>
                  ) : (
                    <div>
                      <p className="text-xs font-mono text-gray-400">{slot.label}</p>
                      <p className="text-sm text-gray-400">비어있음</p>
                    </div>
                  )}
                </div>
                {item && (
                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation();
                      setSlot(slot.key, null);
                    }}
                    aria-label={`${slot.label} 비우기`}
                    variant="danger"
                    size="sm"
                  >
                    ×
                  </IconButton>
                )}
              </div>
            </div>
          );
        })}

        {/* Mood Slot */}
        <div
          className={`border rounded-lg p-3 bg-white cursor-pointer hover:bg-gray-50 border-l-4 ${
            slots.mood ? "border-l-amber-500" : "border-l-gray-200"
          }`}
          onClick={() => setPickerOpen("mood")}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              {getMoodItem() ? (
                <>
                  <img
                    src={imageUrl(getMoodItem()!.image_id)}
                    alt={getMoodItem()!.name}
                    className="w-10 h-10 rounded object-cover"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-gray-400">무드</p>
                    <p className="text-sm font-medium truncate">{getMoodItem()!.name}</p>
                  </div>
                </>
              ) : (
                <div>
                  <p className="text-xs font-mono text-gray-400">무드 레퍼런스</p>
                  <p className="text-sm text-gray-400">Empty</p>
                </div>
              )}
            </div>
            {slots.mood && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  setSlot("mood", null);
                }}
                aria-label="무드 비우기"
                variant="danger"
                size="sm"
              >
                ×
              </IconButton>
            )}
          </div>
        </div>

        {/* View */}
        <div className="border rounded-lg p-3 bg-white">
          <p className="text-xs font-mono text-gray-400 mb-1">뷰 / 샷 타입</p>
          <select
            value={view}
            onChange={(e) => setView(e.target.value as ComposeView)}
            className="w-full text-sm border-0 p-0 focus:ring-0 focus:outline-none bg-transparent"
          >
            {VIEW_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {/* Free-form prompt (장소·소품·날씨·표정 등 무엇이든) */}
        <div className="border rounded-lg p-3 bg-white">
          <p className="text-xs font-mono text-gray-400 mb-1">프롬프트</p>
          <textarea
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            placeholder="도쿄 시부야 카페, 오후 햇살, 선글라스 착용, 커피 들고 있음..."
            className="w-full text-sm border-0 p-0 resize-none focus:ring-0 focus:outline-none"
            rows={2}
          />
        </div>

        {/* Provider / Quality */}
        <div className="flex gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as "openai" | "gemini")}
            className="flex-1 text-xs border rounded-md px-2 py-1.5"
          >
            <option value="openai">OpenAI</option>
            <option value="gemini" disabled>Gemini (준비 중)</option>
          </select>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as "low" | "medium" | "high")}
            className="flex-1 text-xs border rounded-md px-2 py-1.5"
          >
            <option value="low">낮음</option>
            <option value="medium">보통</option>
            <option value="high">높음</option>
          </select>
        </div>

        {/* Over-limit warning */}
        {totalRefs > maxRefs && (
          <div className="border border-red-200 bg-red-50 rounded-md p-2.5 text-xs text-red-600">
            합성에 쓸 이미지가 최대치({maxRefs}장)를 넘었습니다.
            캐릭터 레퍼런스 수를 줄이거나 슬롯/무드를 비우세요.
          </div>
        )}

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="w-full py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 tracking-wider uppercase"
        >
          {inProgress
            ? "합성 중..."
            : totalRefs > maxRefs
              ? "이미지 줄이세요"
              : "룩 생성 (⌘↵)"}
        </button>
      </div>

      {/* Center: Doll Display */}
      <div className="flex-1 flex flex-col items-center min-w-0 lg:overflow-y-auto">
        <div className="w-full max-w-md aspect-[4/5] bg-gray-100 rounded-lg overflow-hidden relative">
          {inProgress ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-center px-6">
                <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-700">
                  {totalRefs}개 레퍼런스로 합성 중
                </p>
                <p className="text-xs text-gray-400 mt-1 font-mono">
                  {composeElapsed}s
                  {composeElapsed < ESTIMATED_COMPOSE_SECONDS &&
                    ` / ~${ESTIMATED_COMPOSE_SECONDS}s`}
                </p>
                {/* Soft progress bar that asymptotes at ~95% until success */}
                <div className="mt-3 w-40 mx-auto h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gray-900 transition-all duration-500"
                    style={{
                      width: `${Math.min(
                        95,
                        (composeElapsed / ESTIMATED_COMPOSE_SECONDS) * 95,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ) : resultImageId ? (
            <img
              src={imageUrl(resultImageId)}
              alt="Generated look"
              className="w-full h-full object-cover"
            />
          ) : activeChar ? (
            <img
              src={imageUrl(activeChar.base_image_id)}
              alt={activeChar.name}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-gray-400 text-sm">시작하려면 캐릭터를 선택하세요</p>
            </div>
          )}
        </div>

        {/* Result Actions */}
        {resultImageId && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              다시 생성
            </button>
            <button
              onClick={handleSaveToFeed}
              disabled={saveFeedMutation.isPending}
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
            >
              {saveFeedMutation.isPending ? "저장 중..." : "피드에 저장 (⌘S)"}
            </button>
            <button
              onClick={handleDiscard}
              className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-md"
            >
              버리기
            </button>
          </div>
        )}

        {(composeMutation.isError || composeError) && (
          <div className="w-full max-w-md mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">
              {composeError || (composeMutation.error as Error).message}
            </p>
          </div>
        )}
      </div>

      {/* Right: Call Inspector */}
      <div className="w-full lg:w-[300px] lg:flex-shrink-0 lg:overflow-y-auto">
        <div className="border rounded-lg p-4 bg-white space-y-4">
          <div>
            <p className="text-xs font-mono text-gray-400 mb-2">이번 호출 레퍼런스</p>
            <div className="space-y-1 text-sm">
              {activeChar && (
                <p className="text-gray-600">
                  캐릭터 레퍼런스 x {charRefCount}
                </p>
              )}
              {productRefCount > 0 && (
                <div>
                  <p className="text-gray-600">제품 레퍼런스 x {productRefCount}</p>
                  <ul className="ml-4 text-xs text-gray-400">
                    {WARDROBE_SLOTS.filter((s) => slots[s.key]).map((s) => {
                      const item = getSlotItem(s.key);
                      const count = item?.images.length ?? 0;
                      return (
                        <li key={s.key}>
                          {item?.name || s.label} ({s.key}) x {count}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {moodRefCount > 0 && (
                <p className="text-gray-600">무드 레퍼런스 x 1</p>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-mono text-gray-400 mb-1">합계</p>
            <p className={`text-lg font-semibold ${totalRefs > maxRefs ? "text-red-500" : ""}`}>
              {totalRefs} / 최대 {maxRefs}
            </p>
          </div>

          <div>
            <p className="text-xs font-mono text-gray-400 mb-1">예상 비용</p>
            <p className="text-lg font-semibold">
              ~${estimatedCost.toFixed(2)}
            </p>
            <p className="text-xs text-gray-400">
              {provider === "openai" ? "GPT Image" : "Gemini"}, {quality}
            </p>
          </div>

          {resultCost > 0 && (
            <div>
              <p className="text-xs font-mono text-gray-400 mb-1">실제 비용</p>
              <p className="text-lg font-semibold text-emerald-600">
                ${resultCost.toFixed(4)}
              </p>
            </div>
          )}

          {resultJobId && (
            <div>
              <p className="text-xs font-mono text-gray-400 mb-1">작업 ID</p>
              <p className="text-xs text-gray-500 break-all">{resultJobId}</p>
            </div>
          )}
        </div>
      </div>

      {/* Library Picker Modal */}
      {pickerOpen && (
        <LibraryPicker
          type={pickerOpen}
          characters={characters}
          wardrobeItems={wardrobeItems}
          moods={moods}
          initialCharacterId={activeCharacterId}
          initialReferenceIds={selectedReferenceIds}
          onSelect={(id, refIds) => {
            if (pickerOpen === "character") {
              setActiveCharacter(id, refIds ?? []);
            } else {
              setSlot(pickerOpen as keyof ComposerSlots, id);
            }
            setPickerOpen(null);
          }}
          onClose={() => setPickerOpen(null)}
        />
      )}
    </div>
  );
}
