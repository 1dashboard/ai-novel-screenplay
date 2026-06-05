import { useState, useRef, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';

const VALID_EXTS = ['.txt', '.md', '.markdown', '.docx', '.doc', '.pdf'];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

export default function FileUploader({ onUploaded }: { onUploaded?: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const navigate = useNavigate();

  const handleFile = async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!VALID_EXTS.includes(ext)) {
      setError(`不支持的文件格式 "${ext}"。支持: ${VALID_EXTS.join(', ')}`);
      return;
    }
    if (file.size > MAX_SIZE) {
      setError('文件大小超过 50MB 限制');
      return;
    }
    setError('');
    setUploading(true);
    setUploadProgress(0);

    const form = new FormData();
    form.append('file', file);
    if (customPrompt.trim()) {
      form.append('prompt', customPrompt.trim());
    }

    const token = localStorage.getItem('access_token') || '';
    const baseUrl = import.meta.env.DEV ? 'http://localhost:8003' : '';

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.open('POST', `${baseUrl}/api/v1/conversion/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);
      setUploadProgress(100);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          navigate(`/tasks/${res.task_id}`);
          onUploaded?.();
        } catch {
          setError('服务器响应异常');
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          setError(err.detail || '上传失败');
        } catch {
          setError(`上传失败 (HTTP ${xhr.status})`);
        }
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setError('网络连接失败，请检查网络后重试');
    };

    xhr.send(form);
  };

  const cancelUpload = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="mb-8">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all select-none
          ${uploading
            ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/10 pointer-events-none'
            : dragging
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-[1.01] shadow-lg shadow-blue-500/10'
              : 'border-gray-300 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-900/50'
          }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={VALID_EXTS.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto">
            <div className="w-full">
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-gray-600 dark:text-gray-400 font-medium">上传中...</span>
                <span className="text-blue-600 dark:text-blue-400 font-bold">{uploadProgress}%</span>
              </div>
              <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cancelUpload();
              }}
              className="pointer-events-auto text-xs text-gray-400 hover:text-red-500 transition-colors underline underline-offset-2"
            >
              取消上传
            </button>
          </div>
        ) : (
          <>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
              拖拽文件到此处，或<span className="text-blue-600 dark:text-blue-400">点击选择</span>
            </p>
            <p className="text-sm text-gray-500 mt-2">支持 TXT / Markdown / Word (.docx/.doc) / PDF，最大 50MB</p>
          </>
        )}
      </div>

      {/* Advanced options */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <svg
            className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          高级选项
        </button>
        {showAdvanced && (
          <div className="mt-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              自定义分析 Prompt
            </label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="可选：输入自定义的剧本分析提示词，覆盖默认 Prompt。支持 {'{character_context}'} 占位符。"
              rows={4}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y transition-colors font-mono"
            />
            <p className="text-xs text-gray-400 mt-1.5">
              留空则使用默认提示词。占位符 <code className="text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-1 rounded">{'{character_context}'}</code> 会被自动替换为已识别的角色信息。
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-4 py-2.5 rounded-xl">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
