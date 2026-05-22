import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, imageUrl } from "@/api/client";
import IconButton from "@/components/IconButton";
import PageHeader from "@/components/PageHeader";
import { useConfirm } from "@/components/Confirm";
import type { Character } from "@/types";

const PERSONA_FIELDS = [
  { key: "age", label: "나이", placeholder: "25" },
  { key: "heritage", label: "출신", placeholder: "한국-일본" },
  { key: "appearance", label: "외모", placeholder: "날카로운 턱선, 큰 눈, 밝은 피부" },
  { key: "body_type", label: "체형", placeholder: "슬림, 170cm" },
  { key: "style", label: "스타일", placeholder: "모던 미니멀, 클린 라인" },
  { key: "color_palette", label: "컬러 팔레트", placeholder: "베이지, 크림, 차분한 어스톤" },
  { key: "location", label: "위치", placeholder: "도쿄 / 서울" },
  { key: "personality", label: "성격", placeholder: "차분한, 예술적인, 사려깊은" },
];

const REFERENCE_LEVELS = [
  { value: 1, label: "1장", subtitle: "빠른 생성" },
  { value: 3, label: "3장", subtitle: "기본 세트" },
  { value: 5, label: "5장", subtitle: "룩 합성용" },
  { value: 8, label: "8장", subtitle: "전체 레퍼런스" },
];

function levelLabelFor(count: number): string {
  const m = REFERENCE_LEVELS.find((l) => l.value === count);
  return m ? `${m.label} · ${m.subtitle}` : `${count}장`;
}

export default function CharactersPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState<Record<string, string>>({});
  const [provider] = useState<"openai" | "gemini">("openai");
  const [referenceCount, setReferenceCount] = useState(1);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createJobId, setCreateJobId] = useState<string | null>(null);
  const [anchorCharacterId, setAnchorCharacterId] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [expandJobId, setExpandJobId] = useState<string | null>(null);
  const [expandTargetCount, setExpandTargetCount] = useState<number>(0);
  const [expandInitialRefCount, setExpandInitialRefCount] = useState<number>(0);
  const [expandError, setExpandError] = useState<string | null>(null);

  const { data: characters = [], isLoading } = useQuery({
    queryKey: ["characters"],
    queryFn: api.characters.list,
  });

  // Live lookup so the detail modal auto-refreshes when refs are added during expansion.
  const selectedCharacter: Character | null = selectedCharacterId
    ? characters.find((c: Character) => c.id === selectedCharacterId) ?? null
    : null;

  const { data: createJob } = useQuery({
    queryKey: ["jobs", createJobId],
    queryFn: () => api.jobs.get(createJobId!),
    enabled: !!createJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "success" || status === "failed" ? false : 3000;
    },
  });

  const { data: expandJob } = useQuery({
    queryKey: ["jobs", expandJobId],
    queryFn: () => api.jobs.get(expandJobId!),
    enabled: !!expandJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "success" || status === "failed" ? false : 5000;
    },
  });

  useEffect(() => {
    if (!expandJob || expandJob.status === "success" || expandJob.status === "failed") return;
    queryClient.invalidateQueries({ queryKey: ["characters"] });
  }, [expandJob, queryClient]);

  useEffect(() => {
    if (!expandJob) return;
    if (expandJob.status === "success" || expandJob.status === "failed") {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (expandJob.status === "failed") {
        setExpandError(expandJob.error_message || "확장에 실패했습니다.");
      } else {
        setExpandError(null);
      }
      setExpandJobId(null);
    }
  }, [expandJob, queryClient]);

  const expandMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: number }) =>
      api.characters.expandReferences(id, target),
    onSuccess: (data) => {
      setExpandJobId(data.job_id);
      setExpandError(null);
    },
    onError: (err: Error) => {
      setExpandError(err.message);
    },
  });

  useEffect(() => {
    if (!creating || !createJob) return;

    if (createJob.status === "success") {
      setCreating(false);
      setCreateJobId(null);
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setShowCreate(false);
      setName("");
      setPersona({});
      setReferenceCount(1);
      setAnchorCharacterId(null);
    }

    if (createJob.status === "failed") {
      setCreating(false);
      setCreateJobId(null);
      setCreateError(createJob.error_message || "캐릭터 생성에 실패했습니다.");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    }
  }, [createJob, creating, queryClient]);

  const openCreateModal = () => {
    setName("");
    setPersona({});
    setReferenceCount(1);
    setAnchorCharacterId(null);
    setCreateError(null);
    setShowCreate(true);
  };

  const openRemakeModal = (char: Character) => {
    setName(char.name);
    setPersona((char.persona as unknown as Record<string, string>) || {});
    setReferenceCount(char.references?.length || 1);
    setAnchorCharacterId(char.id);
    setCreateError(null);
    setSelectedCharacterId(null);
    setShowCreate(true);
  };

  const anchorCharacter: Character | null = anchorCharacterId
    ? characters.find((c: Character) => c.id === anchorCharacterId) ?? null
    : null;

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await api.characters.create({
        name,
        persona,
        provider,
        reference_count: referenceCount,
      });
      setCreateJobId(result.job_id);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (e) {
      setCreateError((e as Error).message);
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    const char = characters.find((c) => c.id === id);
    const ok = await confirm({
      message: char
        ? `"${char.name}" 캐릭터를 삭제하시겠습니까?`
        : "이 캐릭터를 삭제하시겠습니까?",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.characters.delete(id);
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      if (selectedCharacterId === id) setSelectedCharacterId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleExpand = async (char: Character, target: number) => {
    const current = char.references?.length || 0;
    const missing = target - current;
    if (missing <= 0) return;
    const estCost = (missing * 0.02).toFixed(2);
    const estMin = Math.max(1, Math.round((missing * 70) / 60));
    const ok = await confirm({
      title: `${target}장으로 확장`,
      message:
        `${missing}장 추가 생성 (~$${estCost}, 약 ${estMin}분 소요)\n\n` +
        "현재 캐릭터의 base 이미지를 참조해 같은 인물의 다른 각도/표정을 만듭니다.",
      confirmLabel: "계속",
    });
    if (!ok) return;
    setExpandTargetCount(target);
    setExpandInitialRefCount(current);
    setExpandError(null);
    expandMutation.mutate({ id: char.id, target });
  };

  return (
    <div>
      <PageHeader
        title="캐릭터"
        subtitle="피드에 등장할 가상 페르소나"
        action={
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 transition-colors"
          >
            + 새 캐릭터
          </button>
        }
      />

      {isLoading && <p className="text-gray-500">로딩 중...</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {characters.map((char: Character) => {
          const refCount = char.references?.length || 0;
          return (
            <div
              key={char.id}
              className="border rounded-lg p-4 bg-white cursor-pointer transition-all hover:shadow-md"
              onClick={() => setSelectedCharacterId(char.id)}
            >
              <div className="flex items-start gap-3">
                <img
                  src={imageUrl(char.base_image_id)}
                  alt={char.name}
                  className="w-16 h-16 rounded-md object-cover bg-gray-100"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900 truncate">{char.name}</h3>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {char.persona?.style || "스타일 미설정"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{levelLabelFor(refCount)}</p>
                </div>
                <IconButton
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(char.id);
                  }}
                  aria-label="캐릭터 삭제"
                  variant="danger"
                  size="sm"
                >
                  ×
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>

      {selectedCharacter && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedCharacterId(null)}
        >
          <div
            className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const refCount = selectedCharacter.references?.length || 0;
              const isExpandingThis =
                !!expandJobId && expandJob?.character_id === selectedCharacter.id;
              const expandableTargets = REFERENCE_LEVELS
                .map((l) => l.value)
                .filter((v) => v > refCount);
              return (
                <>
                  {/* Fixed header */}
                  <div className="flex items-start justify-between gap-4 p-6 border-b">
                    <div>
                      <h3 className="text-lg font-semibold">{selectedCharacter.name}</h3>
                      <p className="text-sm text-gray-500 mt-1">{levelLabelFor(refCount)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                      {isExpandingThis ? (
                        <span className="px-3 py-2 text-sm bg-gray-100 text-gray-600 rounded-md">
                          확장 중 ({expandJob?.output_image_ids?.length || 0}/
                          {Math.max(1, expandTargetCount - expandInitialRefCount)})
                        </span>
                      ) : (
                        expandableTargets.map((target) => (
                          <button
                            key={target}
                            onClick={() => handleExpand(selectedCharacter, target)}
                            disabled={expandMutation.isPending}
                            className="px-3 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
                          >
                            {target}장으로 확장
                          </button>
                        ))
                      )}
                      <button
                        onClick={() => openRemakeModal(selectedCharacter)}
                        disabled={isExpandingThis}
                        className="px-3 py-2 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50"
                      >
                        다시만들기
                      </button>
                      <button
                        onClick={() => setSelectedCharacterId(null)}
                        className="px-3 py-2 text-sm border rounded-md hover:bg-gray-50"
                      >
                        닫기
                      </button>
                    </div>
                  </div>

                  {/* Scrollable body */}
                  <div className="flex-1 overflow-y-auto p-6">
                    {expandError && expandJob?.character_id === selectedCharacter.id && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">
                        {expandError}
                      </div>
                    )}

                    {/* Persona */}
                    {(() => {
                      const persona = (selectedCharacter.persona as unknown as Record<string, string>) || {};
                      const filled = PERSONA_FIELDS.filter((f) => (persona[f.key] || "").trim());
                      if (filled.length === 0) return null;
                      return (
                        <div className="mb-5">
                          <p className="text-xs font-mono text-gray-400 mb-2">페르소나</p>
                          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                            {filled.map((f) => (
                              <div key={f.key} className="min-w-0">
                                <dt className="text-[11px] text-gray-400">{f.label}</dt>
                                <dd className="text-sm text-gray-800 truncate" title={persona[f.key]}>
                                  {persona[f.key]}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      );
                    })()}

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      <div className="border rounded-lg overflow-hidden bg-white">
                        <div className="aspect-square bg-gray-50">
                          <img
                            src={imageUrl(selectedCharacter.base_image_id)}
                            alt={`${selectedCharacter.name} base`}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="p-2">
                          <p className="text-xs font-mono text-gray-400">BASE</p>
                        </div>
                      </div>

                      {selectedCharacter.references?.map((ref) => (
                        <div key={ref.id} className="border rounded-lg overflow-hidden bg-white">
                          <div className="aspect-square bg-gray-50">
                            <img
                              src={imageUrl(ref.image_id)}
                              alt={ref.role}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="p-2">
                            <p className="text-xs font-mono text-gray-400 truncate">{ref.role}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-2">
              {anchorCharacterId ? "다시 만들기" : "새 캐릭터"}
            </h3>
            {anchorCharacter && (
              <div className="mb-4 flex items-center gap-2 p-2 rounded-md bg-gray-50 border">
                <img
                  src={imageUrl(anchorCharacter.base_image_id)}
                  alt={anchorCharacter.name}
                  className="w-8 h-8 rounded object-cover"
                />
                <div className="text-xs text-gray-600 leading-snug">
                  <p>
                    <span className="font-medium">{anchorCharacter.name}</span> 의 페르소나를 가져왔습니다
                  </p>
                  <p className="text-gray-400">수정해서 새 인물로 다시 생성됩니다</p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Mika"
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>

              {PERSONA_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={persona[field.key] || ""}
                    onChange={(e) =>
                      setPersona((p) => ({ ...p, [field.key]: e.target.value }))
                    }
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                  />
                </div>
              ))}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  생성할 레퍼런스 수
                </label>
                <select
                  value={referenceCount}
                  onChange={(e) => setReferenceCount(Number(e.target.value))}
                  disabled={creating}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                >
                  {REFERENCE_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label} - {l.subtitle}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !name.trim()}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
              >
                {creating ? "생성 중..." : "캐릭터 생성"}
              </button>
            </div>

            {creating && (
              <div className="mt-4 p-3 bg-gray-50 rounded-md">
                <p className="text-sm text-gray-600">
                  백그라운드에서 캐릭터 레퍼런스 {referenceCount}장을 생성 중...
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  작업 ID: {createJobId || "요청 중"}
                </p>
              </div>
            )}

            {createError && (
              <div className="mt-4 p-3 bg-red-50 rounded-md">
                <p className="text-sm text-red-600">{createError}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
