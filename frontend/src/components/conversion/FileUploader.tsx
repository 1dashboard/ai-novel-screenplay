import { useState, useRef, useReducer, type DragEvent } from 'react';
import { deleteTask } from '../../api/conversion';
import { TEMPLATES, getTemplatesByCategory, type ScriptTemplate } from '../../utils/templates';

const VALID_EXTS = ['.txt', '.md', '.markdown', '.docx', '.doc', '.pdf'];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

const TEMPLATE_CATEGORIES = getTemplatesByCategory();

// ---------------------------------------------------------------------------
// Upload state machine
// ---------------------------------------------------------------------------

interface UploadState {
  uploading: boolean;
  progress: number;
  phase: 'cos' | 'server';
  error: string;
}

type UploadAction =
  | { type: 'START' }
  | { type: 'PROGRESS'; progress: number }
  | { type: 'PHASE_SERVER' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

const initialUpload: UploadState = {
  uploading: false,
  progress: 0,
  phase: 'cos',
  error: '',
};

function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case 'START':
      return { uploading: true, progress: 0, phase: 'cos', error: '' };
    case 'PROGRESS':
      return { ...state, progress: action.progress };
    case 'PHASE_SERVER':
      return { ...state, phase: 'server', progress: 100 };
    case 'ERROR':
      return { uploading: false, progress: 0, phase: 'cos', error: action.error };
    case 'RESET':
      return initialUpload;
  }
}

// ---------------------------------------------------------------------------

export default function FileUploader({ onUploaded }: { onUploaded?: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [upload, dispatch] = useReducer(uploadReducer, initialUpload);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<ScriptTemplate | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelRequestedRef = useRef(false);
  const currentPhaseRef = useRef<'cos' | 'server'>('cos');

  const handleFile = async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!VALID_EXTS.includes(ext)) {
      dispatch({ type: 'ERROR', error: `不支持的文件格式 "${ext}"。支持: ${VALID_EXTS.join(', ')}` });
      return;
    }
    if (file.size > MAX_SIZE) {
      dispatch({ type: 'ERROR', error: '文件大小超过 50MB 限制' });
      return;
    }
    dispatch({ type: 'START' });

    const token = localStorage.getItem('access_token') || '';
    const baseUrl = import.meta.env.DEV ? 'http://localhost:8003' : '';

    try {
      // Phase 1: Get presigned upload URL from backend
      const presignRes = await fetch(`${baseUrl}/api/v1/conversion/presign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename: file.name }),
      });

      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || '获取上传凭证失败');
      }

      const { upload_url, key } = await presignRes.json() as { upload_url: string; key: string };

      // Phase 2: Upload directly to COS
      currentPhaseRef.current = 'cos';
      cancelRequestedRef.current = false;
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open('PUT', upload_url);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          dispatch({ type: 'PROGRESS', progress: Math.round((e.loaded / e.total) * 100) });
        }
      };

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`COS 上传失败 (HTTP ${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error('COS 网络连接失败'));
        xhr.send(file);
      });

      if (cancelRequestedRef.current) return;

      // Phase 3: Register with backend
      currentPhaseRef.current = 'server';
      dispatch({ type: 'PHASE_SERVER' });

      const form = new FormData();
      form.append('key', key);
      form.append('filename', file.name);
      form.append('size', String(file.size));
      const combinedPrompt = [selectedTemplate?.prompt, customPrompt.trim()]
        .filter(Boolean)
        .join('\n\n---\n\n');
      if (combinedPrompt) {
        form.append('prompt', combinedPrompt);
      }

      const res = await fetch(`${baseUrl}/api/v1/conversion/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || '创建任务失败');
      }

      const data = await res.json() as { task_id: number; status: string };

      if (cancelRequestedRef.current) {
        try { await deleteTask(data.task_id); } catch { /* ignore */ }
        dispatch({ type: 'RESET' });
        return;
      }

      // Use setTimeout to escape the microtask — React 19 defers
      // microtask-based state updates, so the re-render never fires
      setTimeout(() => {
        dispatch({ type: 'RESET' });
        setSelectedTemplate(null);
        setCustomPrompt('');
        setShowAdvanced(false);
        setShowTemplates(false);
        if (inputRef.current) inputRef.current.value = '';
        onUploaded?.();
      }, 0);
    } catch (err: unknown) {
      if (cancelRequestedRef.current) return;
      dispatch({ type: 'ERROR', error: (err as Error).message || '上传失败' });
    }
  };

  const cancelUpload = () => {
    cancelRequestedRef.current = true;
    xhrRef.current?.abort();
    dispatch({ type: 'RESET' });
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
        onClick={() => !upload.uploading && inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all select-none
          ${upload.uploading
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

        {upload.uploading ? (
          <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto">
            <div className="w-full">
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-gray-600 dark:text-gray-400 font-medium">
                  {upload.phase === 'cos' ? '上传到云存储...' : '创建任务...'}
                </span>
                <span className="text-blue-600 dark:text-blue-400 font-bold">{upload.progress}%</span>
              </div>
              <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${upload.progress}%` }}
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

      {/* Template selector */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowTemplates(!showTemplates)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <svg
            className={`w-3 h-3 transition-transform ${showTemplates ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          选择剧本模板
          {selectedTemplate && (
            <span className="text-blue-500">
              — {selectedTemplate.icon} {selectedTemplate.name}
            </span>
          )}
        </button>
        {showTemplates && (
          <div className="mt-2 space-y-3">
            {Array.from(TEMPLATE_CATEGORIES.entries()).map(([category, templates]) => (
              <div key={category}>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 ml-1">
                  {category}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {templates.map((tpl) => {
                    const isSelected = selectedTemplate?.id === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setSelectedTemplate(isSelected ? null : tpl);
                          if (!isSelected) setShowTemplates(false);
                        }}
                        className={`text-left p-3 rounded-xl border-2 transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md shadow-blue-500/10'
                            : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 bg-white dark:bg-gray-900'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-base">{tpl.icon}</span>
                          <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                            {tpl.name}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">
                          {tpl.description}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {tpl.features.slice(0, 3).map((f) => (
                            <span
                              key={f}
                              className="px-1.5 py-0.5 text-[9px] rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {selectedTemplate && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    {selectedTemplate.icon} {selectedTemplate.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedTemplate(null)}
                    className="text-xs text-blue-500 hover:text-red-500 transition-colors"
                  >
                    移除
                  </button>
                </div>
                <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
                  {selectedTemplate.description}
                </p>
                <details className="text-xs">
                  <summary className="text-gray-500 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                    预览模板 Prompt
                  </summary>
                  <pre className="mt-1 p-2 bg-gray-950 text-gray-400 rounded text-[10px] leading-relaxed max-h-32 overflow-auto whitespace-pre-wrap">
                    {selectedTemplate.prompt.slice(0, 500)}...
                  </pre>
                </details>
              </div>
            )}
          </div>
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

      {upload.error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-4 py-2.5 rounded-xl">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {upload.error}
        </div>
      )}
    </div>
  );
}
