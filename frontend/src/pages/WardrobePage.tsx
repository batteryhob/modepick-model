import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { api, imageUrl } from "@/api/client";
import PageHeader from "@/components/PageHeader";
import type { WardrobeCategory, WardrobeItem, WardrobeItemImage } from "@/types";

const CATEGORIES: { value: WardrobeCategory | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "top", label: "상의" },
  { value: "bottom", label: "하의" },
  { value: "outerwear", label: "아우터" },
  { value: "dress", label: "원피스" },
  { value: "bag", label: "가방" },
  { value: "shoes", label: "신발" },
];

const MAX_IMAGES_PER_ITEM = 8;

export default function WardrobePage() {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState<WardrobeCategory>("top");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadSize, setUploadSize] = useState("");
  const [detailItem, setDetailItem] = useState<WardrobeItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["wardrobe", { category: activeCategory }],
    queryFn: () =>
      api.wardrobe.list(activeCategory === "all" ? undefined : activeCategory),
  });

  const createMutation = useMutation({
    mutationFn: (formData: FormData) => api.wardrobe.create(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wardrobe"] });
      resetUpload();
    },
  });

  const addImageMutation = useMutation({
    mutationFn: ({ itemId, formData }: { itemId: string; formData: FormData }) =>
      api.wardrobe.addImage(itemId, formData),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["wardrobe"] });
      setDetailItem(updated);
    },
  });

  const removeImageMutation = useMutation({
    mutationFn: ({ itemId, imageRecordId }: { itemId: string; imageRecordId: string }) =>
      api.wardrobe.removeImage(itemId, imageRecordId),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wardrobe"] });
      setDetailItem((current) =>
        current && current.id === vars.itemId
          ? { ...current, images: current.images.filter((img) => img.id !== vars.imageRecordId) }
          : current,
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.wardrobe.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wardrobe"] });
      setDetailItem(null);
    },
  });

  const onDrop = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setUploadFiles((prev) => [...prev, ...files].slice(0, MAX_IMAGES_PER_ITEM));
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
    setUploadCategory("top");
    setUploadNotes("");
    setUploadSize("");
  };

  const handleCreate = () => {
    if (uploadFiles.length === 0 || !uploadName.trim()) return;
    const fd = new FormData();
    uploadFiles.forEach((f) => fd.append("files", f));
    fd.append("name", uploadName);
    fd.append("category", uploadCategory);
    fd.append("notes", uploadNotes);
    if (uploadCategory === "bag" && uploadSize.trim()) {
      fd.append("size", uploadSize.trim());
    }
    createMutation.mutate(fd);
  };

  const handleAddImage = (item: WardrobeItem, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    addImageMutation.mutate({ itemId: item.id, formData: fd });
  };

  const items = data?.items || [];

  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} />

      <PageHeader
        title="옷장"
        subtitle="판매 상품 사진 라이브러리"
        action={
          <button
            onClick={() => setShowUpload(true)}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800"
          >
            + 업로드
          </button>
        }
      />

      <div className="flex gap-1 mb-4 overflow-x-auto">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setActiveCategory(cat.value)}
            className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap ${
              activeCategory === cat.value
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {isDragActive && (
        <div className="border-2 border-dashed border-gray-400 rounded-lg p-12 text-center mb-4">
          <p className="text-gray-500">이미지를 여기에 놓으세요 (여러 장 가능)</p>
        </div>
      )}

      {isLoading && <p className="text-gray-500">로딩 중...</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {items.map((item) => {
          const cover = item.images[0];
          return (
            <button
              key={item.id}
              onClick={() => setDetailItem(item)}
              className="text-left border rounded-lg overflow-hidden bg-white group hover:shadow-md transition-shadow"
            >
              <div className="aspect-square bg-gray-50 relative">
                {cover ? (
                  <img
                    src={imageUrl(cover.image_id)}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-xs">
                    no image
                  </div>
                )}
                {item.images.length > 1 && (
                  <span className="absolute top-2 left-2 text-[10px] font-mono px-1.5 py-0.5 bg-black/70 text-white rounded">
                    {item.images.length} imgs
                  </span>
                )}
              </div>
              <div className="p-2">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <span className="text-xs text-gray-400 uppercase">
                  {item.category}
                  {item.category === "bag" && item.size && ` · ${item.size}`}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {items.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-400">
          <p>아직 아이템이 없습니다. 이미지를 업로드하거나 드래그하세요.</p>
        </div>
      )}

      {detailItem && (
        <ItemDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onAddImage={(file) => handleAddImage(detailItem, file)}
          onRemoveImage={(imageRecordId) =>
            removeImageMutation.mutate({ itemId: detailItem.id, imageRecordId })
          }
          onDelete={() => {
            if (confirm(`"${detailItem.name}" 를 삭제하시겠습니까?`)) {
              deleteMutation.mutate(detailItem.id);
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
          category={uploadCategory}
          setCategory={setUploadCategory}
          notes={uploadNotes}
          setNotes={setUploadNotes}
          size={uploadSize}
          setSize={setUploadSize}
          isPending={createMutation.isPending}
          error={createMutation.isError ? (createMutation.error as Error).message : null}
          onCancel={resetUpload}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}

interface ItemDetailModalProps {
  item: WardrobeItem;
  onClose: () => void;
  onAddImage: (file: File) => void;
  onRemoveImage: (imageRecordId: string) => void;
  onDelete: () => void;
  isAdding: boolean;
  isRemoving: boolean;
}

function ItemDetailModal({
  item,
  onClose,
  onAddImage,
  onRemoveImage,
  onDelete,
  isAdding,
  isRemoving,
}: ItemDetailModalProps) {
  const atMax = item.images.length >= MAX_IMAGES_PER_ITEM;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed header */}
        <div className="flex items-start justify-between p-5 border-b">
          <div>
            <h3 className="text-lg font-semibold">{item.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5 uppercase">
              {item.category}
              {item.category === "bag" && item.size && ` · 사이즈 ${item.size}`}
            </p>
            {item.notes && <p className="text-sm text-gray-500 mt-1">{item.notes}</p>}
            <p className="text-xs text-gray-400 mt-2">
              이미지 {item.images.length} / {MAX_IMAGES_PER_ITEM} 장
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50"
            >
              아이템 삭제
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
            >
              닫기
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {item.images.map((img: WardrobeItemImage, idx: number) => (
              <div key={img.id} className="border rounded-lg overflow-hidden bg-white relative">
                <div className="aspect-square bg-gray-50">
                  <img
                    src={imageUrl(img.image_id)}
                    alt={`${item.name} ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-1.5 text-[10px] font-mono text-gray-400 flex justify-between">
                  <span>#{idx + 1}</span>
                  {item.images.length > 1 && (
                    <button
                      onClick={() => {
                        if (confirm("이 이미지를 삭제하시겠습니까?")) {
                          onRemoveImage(img.id);
                        }
                      }}
                      disabled={isRemoving}
                      className="text-gray-400 hover:text-red-500 disabled:opacity-50"
                    >
                      삭제
                    </button>
                  )}
                </div>
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
            같은 제품의 여러 각도/디테일을 추가하면 합성 시 색상·로고·텍스처 재현이 좋아집니다.
          </p>
        </div>
      </div>
    </div>
  );
}

interface UploadModalProps {
  files: File[];
  setFiles: (files: File[]) => void;
  name: string;
  setName: (s: string) => void;
  category: WardrobeCategory;
  setCategory: (c: WardrobeCategory) => void;
  notes: string;
  setNotes: (s: string) => void;
  size: string;
  setSize: (s: string) => void;
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
  category,
  setCategory,
  notes,
  setNotes,
  size,
  setSize,
  isPending,
  error,
  onCancel,
  onSubmit,
}: UploadModalProps) {
  const canSubmit = files.length > 0 && name.trim().length > 0 && !isPending;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">아이템 업로드</h3>

        {files.length === 0 ? (
          <label className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  setFiles(Array.from(e.target.files).slice(0, MAX_IMAGES_PER_ITEM));
                }
              }}
            />
            <p className="text-gray-500">클릭하여 이미지 선택 (여러 장 가능)</p>
            <p className="text-xs text-gray-400 mt-1">최대 {MAX_IMAGES_PER_ITEM}장</p>
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
                  <button
                    onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full text-xs flex items-center justify-center hover:bg-black/80"
                  >
                    ×
                  </button>
                </div>
              ))}
              {files.length < MAX_IMAGES_PER_ITEM && (
                <label className="aspect-square border-2 border-dashed border-gray-300 rounded-md flex items-center justify-center cursor-pointer hover:border-gray-400 text-gray-400 text-xs">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) {
                        const incoming = Array.from(e.target.files);
                        setFiles([...files, ...incoming].slice(0, MAX_IMAGES_PER_ITEM));
                      }
                    }}
                  />
                  + 추가
                </label>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {files.length} / {MAX_IMAGES_PER_ITEM} 장
            </p>
          </div>
        )}

        <div className="space-y-3 mt-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="아이템 이름"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as WardrobeCategory)}
            className="w-full px-3 py-2 border rounded-md text-sm"
          >
            {CATEGORIES.filter((c) => c.value !== "all").map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {category === "bag" && (
            <input
              type="text"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="사이즈 (예: small, 미디엄 토트, W30 x H20cm)"
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          )}
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="메모 (선택사항)"
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
