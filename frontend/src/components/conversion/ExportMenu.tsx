import { useState, useRef, useEffect } from 'react';
import type { ScreenplayData } from '../../types';
import { exportTxt, exportHtml, exportDocx } from '../../utils/export';

interface ExportMenuProps {
  taskId: number;
  title: string;
  screenplay?: ScreenplayData | null;
  yamlAvailable?: boolean;
  onDownloadYaml?: () => void;
}

export default function ExportMenu({ taskId, title, screenplay, yamlAvailable, onDownloadYaml }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handle = async (action: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const safeTitle = title.replace(/\.[^.]+$/, '');

  return (
    <div ref={menuRef} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        disabled={busy}
        className="text-sm px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 active:scale-95 transition-all font-medium flex items-center gap-1.5 disabled:opacity-50"
      >
        {busy ? (
          <>
            <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            导出中...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            导出
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-48 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl z-50 py-1.5">
          <div className="px-3 py-1.5 text-xs text-gray-400 font-medium">选择导出格式</div>

          {yamlAvailable && onDownloadYaml && (
            <button
              onClick={() => handle(onDownloadYaml)}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 transition-colors"
            >
              <span className="w-8 h-5 rounded bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-[10px] font-bold text-amber-700 dark:text-amber-300">YAML</span>
              YAML 原始数据
            </button>
          )}

          {screenplay && (
            <>
              <div className="px-3 py-1.5 text-[10px] text-gray-400 font-medium uppercase tracking-wider mt-1">剧本导出</div>

              <button
                onClick={() => handle(() => exportTxt(screenplay, safeTitle))}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 transition-colors"
              >
                <span className="w-8 h-5 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-400">TXT</span>
                纯文本剧本 (.txt)
              </button>

              <button
                onClick={() => handle(() => exportHtml(screenplay, safeTitle))}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 transition-colors"
              >
                <span className="w-8 h-5 rounded bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-[10px] font-bold text-red-700 dark:text-red-300">PDF</span>
                打印导出 PDF (.html)
              </button>

              <button
                onClick={() => handle(async () => { await exportDocx(screenplay, safeTitle); })}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 transition-colors"
              >
                <span className="w-8 h-5 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px] font-bold text-blue-700 dark:text-blue-300">DOC</span>
                Word 文档 (.docx)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
