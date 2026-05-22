import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { api, imageUrl } from "@/api/client";
import { ImageLightbox } from "@/components/ImageLightbox";
import PageHeader from "@/components/PageHeader";
import { useConfirm } from "@/components/Confirm";
import type { MoodReference } from "@/types";

export default function MoodPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadTags, setUploadTags] = useState("");
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const { data: moods = [], isLoading } = useQuery({
    queryKey: ["mood"],
    queryFn: api.mood.list,
  });

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => api.mood.upload(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mood"] });
      resetUpload();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.mood.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mood"] }),
  });

  const onDrop = useCallback((files: File[]) => {
    if (files[0]) {
      setUploadFile(files[0]);
      setShowUpload(true);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    multiple: false,
    noClick: true,
  });

  const resetUpload = () => {
    setShowUpload(false);
    setUploadFile(null);
    setUploadName("");
    setUploadTags("");
  };

  const handleUpload = () => {
    if (!uploadFile || !uploadName.trim()) return;
    const fd = new FormData();
    fd.append("file", uploadFile);
    fd.append("name", uploadName);
    fd.append("tags", uploadTags);
    uploadMutation.mutate(fd);
  };

  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} />

      <PageHeader
        title="무드 레퍼런스"
        subtitle="조명·색감·분위기 컨셉 보드"
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
          <p className="text-gray-500">무드 레퍼런스를 여기에 놓으세요</p>
        </div>
      )}

      {isLoading && <p className="text-gray-500">로딩 중...</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {moods.map((mood: MoodReference) => (
          <div
            key={mood.id}
            className="border rounded-lg overflow-hidden bg-white group"
          >
            <div className="aspect-square bg-gray-50 relative">
              <img
                src={imageUrl(mood.image_id)}
                alt={mood.name}
                onClick={() =>
                  setLightbox({ src: imageUrl(mood.image_id), alt: mood.name })
                }
                className="w-full h-full object-cover cursor-zoom-in"
              />
              <button
                onClick={async () => {
                  if (
                    await confirm({
                      message: `"${mood.name}" 무드를 삭제하시겠습니까?`,
                      destructive: true,
                    })
                  ) {
                    deleteMutation.mutate(mood.id);
                  }
                }}
                aria-label="무드 삭제"
                className="absolute top-1.5 right-1.5 w-8 h-8 bg-white/90 rounded-full text-gray-500 hover:text-red-600 hover:bg-white text-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-sm"
              >
                ×
              </button>
            </div>
            <div className="p-2">
              <p className="text-sm font-medium truncate">{mood.name}</p>
              {mood.tags && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {mood.tags.split(",").map((tag, i) => (
                    <span
                      key={i}
                      className="text-xs px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded"
                    >
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {moods.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-400">
          <p>아직 무드 레퍼런스가 없습니다. 이미지를 업로드하거나 드래그하세요.</p>
        </div>
      )}

      {/* Upload Dialog */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">무드 레퍼런스 업로드</h3>

            {!uploadFile ? (
              <label className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) setUploadFile(e.target.files[0]);
                  }}
                />
                <p className="text-gray-500">클릭하여 이미지 선택</p>
              </label>
            ) : (
              <div className="mb-3">
                <img
                  src={URL.createObjectURL(uploadFile)}
                  alt="Preview"
                  className="w-full h-48 object-contain bg-gray-50 rounded-md"
                />
              </div>
            )}

            <div className="space-y-3 mt-3">
              <input
                type="text"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="이름 (예: 비 오는 카페)"
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
              <input
                type="text"
                value={uploadTags}
                onChange={(e) => setUploadTags(e.target.value)}
                placeholder="태그 (쉼표로 구분: 카페, 비, 따뜻한)"
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={resetUpload}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md"
              >
                취소
              </button>
              <button
                onClick={handleUpload}
                disabled={uploadMutation.isPending || !uploadFile || !uploadName.trim()}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
              >
                {uploadMutation.isPending ? "업로드 중..." : "업로드"}
              </button>
            </div>
          </div>
        </div>
      )}

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
