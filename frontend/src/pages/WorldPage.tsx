import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { api, imageUrl } from "@/api/client";
import IconButton from "@/components/IconButton";
import { ImageLightbox } from "@/components/ImageLightbox";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import type { WorldLocation, WorldLocationImage } from "@/types";

const MAX_IMAGES_PER_LOCATION = 8;

export default function WorldPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadName, setUploadName] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [detail, setDetail] = useState<WorldLocation | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["world"],
    queryFn: api.world.list,
  });

  const createMutation = useMutation({
    mutationFn: (formData: FormData) => api.world.create(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["world"] });
      resetUpload();
      toast.success("장소 추가됨");
    },
    onError: (err: Error) => toast.error(`업로드 실패: ${err.message}`),
  });

  const addImageMutation = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api.world.addImage(id, formData),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["world"] });
      setDetail(updated);
      toast.success("이미지 추가됨");
    },
    onError: (err: Error) => toast.error(`추가 실패: ${err.message}`),
  });

  const removeImageMutation = useMutation({
    mutationFn: ({ id, imageRecordId }: { id: string; imageRecordId: string }) =>
      api.world.removeImage(id, imageRecordId),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["world"] });
      setDetail((current) =>
        current && current.id === vars.id
          ? { ...current, images: current.images.filter((img) => img.id !== vars.imageRecordId) }
          : current,
      );
    },
    onError: (err: Error) => toast.error(`삭제 실패: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: api.world.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["world"] });
      setDetail(null);
      toast.success("장소 삭제됨");
    },
  });

  const onDrop = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setUploadFiles((prev) => [...prev, ...files].slice(0, MAX_IMAGES_PER_LOCATION));
    setShowUpload(true);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    multiple: true,
    noClick: true,
  });

  const resetUpload = () => {
    setShowUpload(false);
    setUploadFiles([]);
    setUploadName("");
    setUploadNotes("");
  };

  const handleCreate = () => {
    if (uploadFiles.length === 0 || !uploadName.trim()) return;
    const fd = new FormData();
    uploadFiles.forEach((f) => fd.append("files", f));
    fd.append("name", uploadName);
    fd.append("notes", uploadNotes);
    createMutation.mutate(fd);
  };

  const handleAddImage = (loc: WorldLocation, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    addImageMutation.mutate({ id: loc.id, formData: fd });
  };

  const items = data?.items || [];

  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} />

      <PageHeader
        title="세계관"
        subtitle="캐릭터가 자주 가는 장소 — 집·카페·거리. 매번 같은 공간으로 합성됨"
        action={
          <button
            onClick={() => setShowUpload(true)}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800"
          >
            + 업로드
          </button>
        }
      />

      {isDragActive && (
        <div className="border-2 border-dashed border-gray-400 rounded-lg p-12 text-center mb-4">
          <p className="text-gray-500">이미지를 여기에 놓으세요 (여러 장 가능)</p>
        </div>
      )}

      {isLoading && <p className="text-gray-500">로딩 중...</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {items.map((loc) => {
          const cover = loc.images[0];
          return (
            <button
              key={loc.id}
              onClick={() => setDetail(loc)}
              className="text-left border rounded-lg overflow-hidden bg-white group hover:shadow-md transition-shadow"
            >
              <div className="aspect-square bg-gray-50 relative">
                {cover ? (
                  <img
                    src={imageUrl(cover.image_id)}
                    alt={loc.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-xs">
                    no image
                  </div>
                )}
                {loc.images.length > 1 && (
                  <span className="absolute top-2 left-2 text-[10px] font-mono px-1.5 py-0.5 bg-black/70 text-white rounded">
                    {loc.images.length} imgs
                  </span>
                )}
              </div>
              <div className="p-2">
                <p className="text-sm font-medium truncate">{loc.name}</p>
                {loc.notes && (
                  <p className="text-xs text-gray-400 truncate">{loc.notes}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {items.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-400">
          <p>아직 장소가 없습니다.</p>
          <p className="text-xs mt-1">집·카페·거리·작업실 사진을 올려두면 합성 시 같은 공간으로 재현됩니다.</p>
        </div>
      )}

      {detail && (
        <LocationDetailModal
          loc={detail}
          onClose={() => setDetail(null)}
          onAddImage={(file) => handleAddImage(detail, file)}
          onRemoveImage={(imageRecordId) =>
            removeImageMutation.mutate({ id: detail.id, imageRecordId })
          }
          onDelete={() => {
            if (confirm(`"${detail.name}" 을 삭제하시겠습니까?`)) {
              deleteMutation.mutate(detail.id);
            }
          }}
          isAdding={addImageMutation.isPending}
          isRemoving={removeImageMutation.isPending}
        />
      )}

      {showUpload && (
        <UploadModal
          files={uploadFiles}
          setFiles={setUploadFiles}
          name={uploadName}
          setName={setUploadName}
          notes={uploadNotes}
          setNotes={setUploadNotes}
          isPending={createMutation.isPending}
          error={createMutation.isError ? (createMutation.error as Error).message : null}
          onCancel={resetUpload}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}

interface DetailProps {
  loc: WorldLocation;
  onClose: () => void;
  onAddImage: (file: File) => void;
  onRemoveImage: (imageRecordId: string) => void;
  onDelete: () => void;
  isAdding: boolean;
  isRemoving: boolean;
}

function LocationDetailModal({
  loc,
  onClose,
  onAddImage,
  onRemoveImage,
  onDelete,
  isAdding,
  isRemoving,
}: DetailProps) {
  const atMax = loc.images.length >= MAX_IMAGES_PER_LOCATION;
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b">
          <div>
            <h3 className="text-lg font-semibold">{loc.name}</h3>
            {loc.notes && <p className="text-sm text-gray-500 mt-1">{loc.notes}</p>}
            <p className="text-xs text-gray-400 mt-2">
              이미지 {loc.images.length} / {MAX_IMAGES_PER_LOCATION} 장
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50"
            >
              삭제
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
            >
              닫기
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {loc.images.map((img: WorldLocationImage, idx: number) => (
              <div
                key={img.id}
                className="border rounded-lg overflow-hidden bg-white relative group"
              >
                <div className="aspect-square bg-gray-50">
                  <img
                    src={imageUrl(img.image_id)}
                    alt={`${loc.name} ${idx + 1}`}
                    onClick={() =>
                      setLightbox({
                        src: imageUrl(img.image_id),
                        alt: `${loc.name} ${idx + 1}`,
                      })
                    }
                    className="w-full h-full object-cover cursor-zoom-in"
                  />
                </div>
                <div className="p-1.5 text-[10px] font-mono text-gray-400">
                  #{idx + 1}
                </div>
                {loc.images.length > 1 && (
                  <button
                    aria-label="이미지 삭제"
                    onClick={() => {
                      if (confirm("이 이미지를 삭제하시겠습니까?")) {
                        onRemoveImage(img.id);
                      }
                    }}
                    disabled={isRemoving}
                    className="absolute top-1.5 right-1.5 w-8 h-8 bg-white/90 rounded-full text-gray-500 hover:text-red-600 hover:bg-white text-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-sm disabled:opacity-30"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            {!atMax && (
              <label className="aspect-square border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 text-gray-400 text-sm">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={isAdding}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onAddImage(file);
                    e.target.value = "";
                  }}
                />
                <span className="text-2xl mb-1">+</span>
                <span>{isAdding ? "추가 중..." : "이미지 추가"}</span>
              </label>
            )}
          </div>

          <p className="text-xs text-gray-400 mt-4">
            같은 공간의 여러 각도(전경·디테일·창문 등)를 추가하면 합성에서 그 공간이 더 일관되게 재현됩니다.
          </p>
        </div>
      </div>

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

interface UploadProps {
  files: File[];
  setFiles: (files: File[]) => void;
  name: string;
  setName: (s: string) => void;
  notes: string;
  setNotes: (s: string) => void;
  isPending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}

function UploadModal({
  files,
  setFiles,
  name,
  setName,
  notes,
  setNotes,
  isPending,
  error,
  onCancel,
  onSubmit,
}: UploadProps) {
  const canSubmit = files.length > 0 && name.trim().length > 0 && !isPending;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">장소 추가</h3>

        {files.length === 0 ? (
          <label className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  setFiles(Array.from(e.target.files).slice(0, MAX_IMAGES_PER_LOCATION));
                }
              }}
            />
            <p className="text-gray-500">클릭하여 이미지 선택 (여러 장 가능)</p>
            <p className="text-xs text-gray-400 mt-1">최대 {MAX_IMAGES_PER_LOCATION}장</p>
          </label>
        ) : (
          <div className="mb-3">
            <div className="grid grid-cols-3 gap-2">
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="relative">
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="w-full aspect-square object-cover rounded-md bg-gray-50"
                  />
                  <IconButton
                    aria-label="이미지 제거"
                    size="sm"
                    variant="overlay"
                    onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1"
                  >
                    ×
                  </IconButton>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {files.length} / {MAX_IMAGES_PER_LOCATION} 장
            </p>
          </div>
        )}

        <div className="space-y-3 mt-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="장소 이름 (예: 마이의 집 거실)"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="메모 (예: 도쿄 시부야, 단골 카페 창가 자리)"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>

        {error && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md"
          >
            취소
          </button>
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? "업로드 중..." : "업로드"}
          </button>
        </div>
      </div>
    </div>
  );
}
