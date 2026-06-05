import { useState, useEffect, useMemo } from 'react';
import { getYamlContent, downloadYaml } from '../../api/conversion';
import { useToast } from '../../contexts/ToastContext';

function highlightYaml(text: string): { html: string; lineCount: number } {
  const lines = text.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    // Comment-only line
    if (/^\s*#/.test(line)) {
      result.push(`<span class="text-gray-500 dark:text-gray-600 italic">${esc(line)}</span>`);
      continue;
    }

    // Key-value line
    const kvMatch = line.match(/^(\s*)([^:]+?)(\s*:\s*)(.*)$/);
    if (kvMatch) {
      const [, indent, key, colon, value] = kvMatch;
      const keyHtml = `<span class="text-cyan-400 dark:text-cyan-300">${esc(key)}</span>`;
      const colonHtml = esc(colon);

      let valueHtml: string;
      const trimmed = value.trim();

      if (trimmed === 'true' || trimmed === 'false') {
        valueHtml = `<span class="text-orange-400 dark:text-orange-300">${esc(value)}</span>`;
      } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        valueHtml = `<span class="text-yellow-400 dark:text-yellow-300">${esc(value)}</span>`;
      } else if (trimmed === 'null' || trimmed === '~') {
        valueHtml = `<span class="text-gray-500">${esc(value)}</span>`;
      } else if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        valueHtml = `<span class="text-emerald-400 dark:text-emerald-300">${esc(value)}</span>`;
      } else if (trimmed === '|' || trimmed === '>' || trimmed === '|-' || trimmed === '>-') {
        valueHtml = `<span class="text-purple-400 dark:text-purple-300">${esc(value)}</span>`;
      } else if (trimmed) {
        valueHtml = `<span class="text-emerald-400 dark:text-emerald-300">${esc(value)}</span>`;
      } else {
        valueHtml = esc(value);
      }

      // Inline comment in value
      const commentMatch = valueHtml.match(/^(.*?)(\s+#\s.*)$/);
      if (commentMatch) {
        valueHtml = `${commentMatch[1]}<span class="text-gray-500 dark:text-gray-600 italic">${commentMatch[2]}</span>`;
      }

      result.push(`${esc(indent)}${keyHtml}${colonHtml}${valueHtml}`);
      continue;
    }

    // List item
    const listMatch = line.match(/^(\s*)(-\s)(.*)$/);
    if (listMatch) {
      const [, indent, dash, rest] = listMatch;
      result.push(`${esc(indent)}<span class="text-purple-400 dark:text-purple-300">${esc(dash)}</span>${esc(rest)}`);
      continue;
    }

    // Default
    result.push(esc(line));
  }

  return { html: result.join('\n'), lineCount: lines.length };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default function YamlViewer({ taskId }: { taskId: number }) {
  const { error: toastError } = useToast();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  useEffect(() => {
    getYamlContent(taskId)
      .then(setContent)
      .catch(() => {
        setContent('加载失败');
        toastError('加载 YAML 内容失败');
      })
      .finally(() => setLoading(false));
  }, [taskId, toastError]);

  const highlighted = useMemo(() => highlightYaml(content), [content]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadYaml(taskId, `screenplay_${taskId}.yaml`);
    } catch {
      toastError('下载 YAML 文件失败');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin h-6 w-6 border-3 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="bg-gray-950 dark:bg-gray-950 rounded-xl border border-gray-800 overflow-hidden shadow-xl">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-xs text-gray-500 font-mono">screenplay_{taskId}.yaml</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              showLineNumbers
                ? 'text-blue-400 bg-blue-500/10'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            行号
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(content).then(() => {}).catch(() => {})}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-gray-800"
            title="复制内容"
          >
            <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="text-xs px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors font-medium"
          >
            {downloading ? '下载中...' : '下载 YAML'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex">
        {showLineNumbers && (
          <div className="select-none text-right px-3 py-3 bg-gray-900/50 border-r border-gray-800 text-xs text-gray-600 font-mono leading-[1.7]">
            {Array.from({ length: highlighted.lineCount }).map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}
        <pre
          className="flex-1 p-4 overflow-auto max-h-[65vh] text-xs leading-[1.7] font-mono m-0 bg-transparent text-gray-300"
          dangerouslySetInnerHTML={{ __html: highlighted.html }}
        />
      </div>
    </div>
  );
}
