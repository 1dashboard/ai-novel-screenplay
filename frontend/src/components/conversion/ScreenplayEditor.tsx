import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getYamlContent, updateScreenplay } from '../../api/conversion';
import type { UpdateScreenplayResult } from '../../api/conversion';
import { useToast } from '../../contexts/ToastContext';

interface ParsedStats {
  title: string;
  characterCount: number;
  actCount: number;
  sceneCount: number;
  characters: string[];
  error: string | null;
}

function parseYamlStats(yaml: string): ParsedStats {
  try {
    const titleMatch = yaml.match(/^\s*title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].replace(/['"]/g, '').trim() : '（未知）';

    // Count character entries (lines starting with "  - id: char_" at the right level)
    const charMatches = yaml.match(/^\s{2}- id:\s*char_/gm);
    const characterCount = charMatches ? charMatches.length : 0;

    // Extract character names
    const nameMatches = yaml.matchAll(/^\s{4}name:\s*(.+)$/gm);
    const characters = Array.from(nameMatches).map(m => m[1].replace(/['"]/g, '').trim());

    // Count acts
    const actMatches = yaml.match(/^\s{2}- act_number:/gm);
    const actCount = actMatches ? actMatches.length : 0;

    // Count scenes
    const sceneMatches = yaml.match(/^\s{6}- scene_number:/gm);
    const sceneCount = sceneMatches ? sceneMatches.length : 0;

    return { title, characterCount, actCount, sceneCount, characters, error: null };
  } catch (e) {
    return { title: '解析失败', characterCount: 0, actCount: 0, sceneCount: 0, characters: [], error: (e as Error).message };
  }
}

export default function ScreenplayEditor({
  taskId,
  onEdited,
}: {
  taskId: number;
  onEdited?: (content: string, stats: UpdateScreenplayResult) => void;
}) {
  const { success, error: toastError } = useToast();
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [parseError, setParseError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);

  // Keep ref in sync
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Load initial content
  useEffect(() => {
    getYamlContent(taskId)
      .then((text) => {
        setContent(text);
        setOriginalContent(text);
        setLoading(false);
      })
      .catch(() => {
        setContent('加载失败');
        setLoading(false);
        toastError('加载 YAML 内容失败');
      });
  }, [taskId, toastError]);

  const stats = useMemo(() => parseYamlStats(content), [content]);

  const doSave = useCallback(async (text: string) => {
    if (text === originalContent) {
      setSaveStatus('saved');
      return;
    }
    setSaveStatus('saving');
    try {
      const result = await updateScreenplay(taskId, text);
      setOriginalContent(text);
      setSaveStatus('saved');
      setParseError(null);
      onEdited?.(text, result);
      success('剧本已保存');
    } catch (err: unknown) {
      setSaveStatus('error');
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '保存失败';
      setParseError(msg);
      toastError(msg);
    }
  }, [taskId, originalContent, onEdited, success, toastError]);

  const handleChange = (value: string) => {
    setContent(value);
    setSaveStatus('unsaved');
    // Clear any previous parse error when user types
    if (parseError) {
      try {
        parseYamlStats(value);
        setParseError(null);
      } catch { /* still invalid, keep error */ }
    }
    // Debounced save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      doSave(contentRef.current);
    }, 2000);
  };

  // Save on Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        doSave(contentRef.current);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doSave]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin h-6 w-6 border-3 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const lineCount = content.split('\n').length;

  const hasChanges = content !== originalContent;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 rounded-lg border border-gray-800">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-300">剧本编辑器</span>
          <div className="flex items-center gap-2 text-xs">
            {saveStatus === 'saved' && (
              <span className="text-green-400 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                已保存
              </span>
            )}
            {saveStatus === 'saving' && (
              <span className="text-yellow-400 flex items-center gap-1">
                <span className="animate-spin w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full" />
                保存中...
              </span>
            )}
            {saveStatus === 'unsaved' && (
              <span className="text-gray-400 flex items-center gap-1">
                <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                未保存
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-red-400">保存失败</span>
            )}
          </div>
          {hasChanges && (
            <span className="text-xs text-gray-500">（Ctrl+S 手动保存）</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <button
            onClick={() => doSave(content)}
            disabled={saveStatus === 'saving' || !hasChanges}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 transition-colors font-medium"
          >
            保存
          </button>
        </div>
      </div>

      {/* Split pane */}
      <div className="flex gap-4 h-[65vh]">
        {/* Left: Editor */}
        <div className="flex-1 flex flex-col bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
          <div className="flex items-center px-3 py-1.5 bg-gray-900 border-b border-gray-800">
            <span className="text-xs text-gray-500">screenplay.yaml</span>
          </div>
          <div className="flex flex-1 overflow-hidden">
            {/* Line numbers */}
            <div className="select-none text-right px-3 py-3 bg-gray-900/50 border-r border-gray-800 text-xs text-gray-600 font-mono leading-[1.7] overflow-hidden">
              {Array.from({ length: Math.max(lineCount, 1) }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            {/* Text area */}
            <textarea
              value={content}
              onChange={(e) => handleChange(e.target.value)}
              className="flex-1 p-3 bg-transparent text-gray-300 font-mono text-xs leading-[1.7] resize-none outline-none border-0 overflow-auto"
              spellCheck={false}
              style={{ tabSize: 2 }}
            />
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="w-80 shrink-0 flex flex-col gap-3">
          {/* Stats */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">实时统计</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatItem label="角色" value={stats.characterCount} />
              <StatItem label="幕" value={stats.actCount} />
              <StatItem label="场景" value={stats.sceneCount} />
              <StatItem label="标题" value={stats.title} isTitle />
            </div>
            {stats.characters.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                <div className="text-xs text-gray-500 mb-2">角色列表</div>
                <div className="flex flex-wrap gap-1.5">
                  {stats.characters.slice(0, 20).map((name, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 text-xs rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                    >
                      {name}
                    </span>
                  ))}
                  {stats.characters.length > 20 && (
                    <span className="text-xs text-gray-400">+{stats.characters.length - 20} 更多</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Errors */}
          {parseError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">格式错误</h3>
              <p className="text-xs text-red-500 dark:text-red-300">{parseError}</p>
            </div>
          )}

          {/* Tips */}
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <h3 className="text-xs font-semibold text-gray-500 mb-2">快捷操作</h3>
            <ul className="text-xs text-gray-400 space-y-1">
              <li><kbd className="px-1 py-0.5 bg-gray-200 dark:bg-gray-800 rounded text-[10px]">Ctrl+S</kbd> 手动保存</li>
              <li>停止输入 2 秒后自动保存</li>
              <li>修改后所有导出自动同步</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value, isTitle }: { label: string; value: string | number; isTitle?: boolean }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-semibold ${isTitle ? 'text-sm text-blue-600 dark:text-blue-400 truncate' : 'text-lg text-gray-800 dark:text-gray-200'}`}>
        {value}
      </div>
    </div>
  );
}
