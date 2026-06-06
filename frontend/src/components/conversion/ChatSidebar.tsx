import { useState, useRef, useEffect, useCallback } from 'react';
import { chatEdit, getChatSession, exportChatSession } from '../../api/conversion';
import type { ChatMessage, ChangeItem, ChatEditResponse, ChatMessageResponse } from '../../api/conversion';
import { useToast } from '../../contexts/ToastContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  pendingEdit?: {
    modifiedYaml: string;
    changeSummary: string;
    changes: ChangeItem[];
  };
  accepted?: boolean;
  rejected?: boolean;
}

// ---------------------------------------------------------------------------
// Simple line diff
// ---------------------------------------------------------------------------

interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
  lineNum?: number;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  let oi = 0;
  let ni = 0;
  const MAX = Math.max(oldLines.length, newLines.length) * 2;

  while ((oi < oldLines.length || ni < newLines.length) && result.length < MAX) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      result.push({ type: 'same', text: oldLines[oi] });
      oi++;
      ni++;
    } else if (ni < newLines.length && (oi >= oldLines.length || newLines[ni] !== oldLines[oi])) {
      const aheadInNew = newLines.indexOf(oldLines[oi], ni);
      const aheadInOld = oldLines.indexOf(newLines[ni], oi);
      if (aheadInOld !== -1 && (aheadInNew === -1 || aheadInOld <= aheadInNew)) {
        result.push({ type: 'removed', text: oldLines[oi] });
        oi++;
      } else if (aheadInNew !== -1) {
        result.push({ type: 'added', text: newLines[ni] });
        ni++;
      } else {
        result.push({ type: 'removed', text: oldLines[oi] });
        result.push({ type: 'added', text: newLines[ni] });
        oi++;
        ni++;
      }
    } else if (oi < oldLines.length) {
      result.push({ type: 'removed', text: oldLines[oi] });
      oi++;
    } else if (ni < newLines.length) {
      result.push({ type: 'added', text: newLines[ni] });
      ni++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Change type badge
// ---------------------------------------------------------------------------

function changeBadge(type: string) {
  switch (type) {
    case 'modify':
      return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', label: '修改' };
    case 'add':
      return { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', label: '新增' };
    case 'delete':
      return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: '删除' };
    default:
      return { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400', label: type };
  }
}

// ---------------------------------------------------------------------------
// Convert API message to local Message
// ---------------------------------------------------------------------------

function apiToMessage(api: ChatMessageResponse): Message {
  return {
    id: api.id,
    role: api.role as 'user' | 'assistant' | 'system',
    content: api.content,
    pendingEdit: api.change_summary
      ? {
          modifiedYaml: '', // not stored in DB for history display
          changeSummary: api.change_summary,
          changes: api.changes || [],
        }
      : undefined,
    accepted: api.accepted ?? undefined,
    rejected: api.rejected ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ChatSidebarProps {
  taskId: number;
  currentYaml: string;
  onApplyChanges: (yaml: string) => Promise<void>;
  onClose: () => void;
}

let nextMsgId = 1000; // Start high to avoid colliding with DB IDs

export default function ChatSidebar({ taskId, currentYaml, onApplyChanges, onClose }: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextMsgId++,
      role: 'system',
      content: '你好！我是 AI 编剧助理。你可以用自然语言描述想要的修改，例如：\n\n• "把第二幕萧炎的台词改得更愤怒一点"\n• "增加一个过场戏，展示萧媚的心理活动"\n• "把场景3的对白缩短一些"',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { error: toastError } = useToast();

  // Load chat history on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getChatSession(taskId);
        if (cancelled) return;
        setSessionId(session.session_id);

        if (session.messages && session.messages.length > 0) {
          const historyMsgs: Message[] = session.messages.map(apiToMessage);
          setMessages((prev) => {
            // Keep the system welcome, append history after it
            const systemMsgs = prev.filter((m) => m.role === 'system');
            return [...systemMsgs, ...historyMsgs];
          });
        }
      } catch {
        // No session yet — that's fine, one will be created on first message
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Build conversation history for API (deprecated — backend loads from DB now)
  const buildHistory = useCallback((): ChatMessage[] => {
    return messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.role === 'assistant' && m.pendingEdit
          ? `[修改完成] ${m.pendingEdit.changeSummary}`
          : m.content,
      }));
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);

    const userMsg: Message = {
      id: nextMsgId++,
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const history = buildHistory();
      const result: ChatEditResponse = await chatEdit(
        taskId,
        text,
        currentYaml,
        history,
        sessionId ?? undefined,
      );

      // Persist session ID for subsequent requests
      if (result.session_id) {
        setSessionId(result.session_id);
      }

      const assistantMsg: Message = {
        id: nextMsgId++,
        role: 'assistant',
        content: result.change_summary,
        pendingEdit: {
          modifiedYaml: result.modified_yaml,
          changeSummary: result.change_summary,
          changes: result.changes,
        },
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      let msg = 'AI 请求失败';
      if (err && typeof err === 'object' && 'response' in err) {
        const detail = (err as Record<string, any>).response?.data?.detail;
        if (typeof detail === 'string') {
          msg = detail;
        } else if (Array.isArray(detail)) {
          msg = detail.map((d: Record<string, any>) => d.msg || JSON.stringify(d)).join('; ');
        }
      } else if (err instanceof Error) {
        msg = err.message;
      }
      toastError(msg);
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId++, role: 'system', content: `错误: ${msg}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async (msgId: number) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg?.pendingEdit) return;
    setBusy(true);
    try {
      await onApplyChanges(msg.pendingEdit.modifiedYaml);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, accepted: true, rejected: false, content: m.content + '\n\n✓ 已应用修改' }
            : m,
        ),
      );
    } catch (err: unknown) {
      toastError((err as Error).message || '应用修改失败');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = (msgId: number) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, rejected: true, accepted: false, content: m.content + '\n\n✗ 已拒绝修改' }
          : m,
      ),
    );
  };

  const toggleDiff = (msgId: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.pendingEdit) return m;
        const showing = (m as any).showDiff;
        return { ...m, showingDiff: !showing };
      }),
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleExport = async (format: 'json' | 'markdown') => {
    setShowExportMenu(false);
    try {
      await exportChatSession(taskId, format);
    } catch {
      toastError('导出对话失败');
    }
  };

  return (
    <div className="w-[420px] shrink-0 h-[75vh] flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <span className="font-bold text-sm text-gray-900 dark:text-white">AI 编剧助理</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-medium">
            Beta
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Export button */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
              title="导出对话"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-30 min-w-[100px]">
                <button
                  onClick={() => handleExport('json')}
                  className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  导出 JSON
                </button>
                <button
                  onClick={() => handleExport('markdown')}
                  className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  导出 Markdown
                </button>
                <button
                  onClick={() => setShowExportMenu(false)}
                  className="block w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  取消
                </button>
              </div>
            )}
            {/* Click-outside to close */}
            {showExportMenu && (
              <div className="fixed inset-0 z-20" onClick={() => setShowExportMenu(false)} />
            )}
          </div>
          {/* Close button */}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id}>
            {/* System message */}
            {msg.role === 'system' && (
              <div className="text-center text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed">
                {msg.content}
              </div>
            )}

            {/* User message */}
            {msg.role === 'user' && (
              <div className="flex justify-end">
                <div className="max-w-[85%] bg-blue-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            )}

            {/* Assistant message */}
            {msg.role === 'assistant' && (
              <div className="flex justify-start">
                <div className={`max-w-[90%] rounded-2xl rounded-bl-md px-4 py-3 text-sm leading-relaxed ${
                  msg.accepted
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800'
                    : msg.rejected
                      ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 opacity-60'
                      : 'bg-gray-100 dark:bg-gray-800'
                }`}>
                  {/* Change summary text */}
                  <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{msg.content}</p>

                  {/* Changes list */}
                  {msg.pendingEdit && msg.pendingEdit.changes.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {msg.pendingEdit.changes.map((ch, i) => {
                        const badge = changeBadge(ch.type);
                        return (
                          <div key={i} className="flex items-start gap-1.5 text-xs">
                            <span className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-medium ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                            <span className="text-gray-500 dark:text-gray-400">{ch.target}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Action buttons — only if we have pendingEdit with modifiedYaml */}
                  {msg.pendingEdit && msg.pendingEdit.modifiedYaml && !msg.accepted && !msg.rejected && (
                    <div className="mt-3 flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      <button
                        onClick={() => toggleDiff(msg.id)}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-purple-600 hover:border-purple-300 transition-colors"
                      >
                        {(msg as any).showingDiff ? '隐藏差异' : '查看差异'}
                      </button>
                      <button
                        onClick={() => handleReject(msg.id)}
                        disabled={busy}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-red-600 hover:border-red-300 transition-colors disabled:opacity-50"
                      >
                        拒绝
                      </button>
                      <button
                        onClick={() => handleApply(msg.id)}
                        disabled={busy}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors ml-auto"
                      >
                        接受修改
                      </button>
                    </div>
                  )}

                  {/* For history messages without modifiedYaml, show simpler actions */}
                  {msg.pendingEdit && !msg.pendingEdit.modifiedYaml && msg.accepted === undefined && msg.rejected === undefined && (
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      <span className="text-[10px] text-gray-400">历史消息 — 无法重新应用</span>
                    </div>
                  )}

                  {/* Diff view */}
                  {(msg as any).showingDiff && msg.pendingEdit && msg.pendingEdit.modifiedYaml && (() => {
                    const diff = computeDiff(currentYaml, msg.pendingEdit.modifiedYaml);
                    const display = diff.slice(0, 80);
                    const truncated = diff.length > 80;
                    return (
                      <div className="mt-3 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                        <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 font-mono flex items-center justify-between">
                          <span>YAML 差异对比</span>
                          <span>
                            <span className="text-red-400">-删除</span> / <span className="text-green-500">+新增</span>
                          </span>
                        </div>
                        <div className="max-h-48 overflow-auto bg-gray-950 p-2 font-mono text-[11px] leading-[1.6]">
                          {display.map((line, i) => (
                            <div
                              key={i}
                              className={`whitespace-pre ${
                                line.type === 'added'
                                  ? 'bg-green-900/40 text-green-300'
                                  : line.type === 'removed'
                                    ? 'bg-red-900/40 text-red-300'
                                    : 'text-gray-500'
                              }`}
                            >
                              <span className="select-none inline-block w-4 text-gray-600 mr-2 text-right">
                                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                              </span>
                              {line.text}
                            </div>
                          ))}
                          {truncated && (
                            <div className="text-gray-500 italic text-center py-1">
                              ... 差异过长，仅显示前 80 行
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-xs text-gray-400">AI 正在思考...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/50">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={currentYaml ? '输入修改指令，如「把第一幕的对话改得更简洁」...' : '正在加载剧本数据...'}
            disabled={busy || !currentYaml}
            className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-gray-900 dark:text-white placeholder-gray-400 disabled:opacity-50 transition-colors"
          />
          <button
            onClick={sendMessage}
            disabled={busy || !input.trim() || !currentYaml}
            className="px-4 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 text-center">
          按 Enter 发送，AI 会返回修改建议供你确认
        </p>
      </div>
    </div>
  );
}
