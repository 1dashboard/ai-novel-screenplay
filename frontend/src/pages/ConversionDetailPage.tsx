import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getTask, getScreenplay, getEvaluation, downloadYaml, updateScreenplay, getYamlContent } from '../api/conversion';
import type { TaskResponse, ScreenplayData, EvaluationData } from '../types';
import StatusBadge from '../components/common/StatusBadge';
import ProgressBar from '../components/common/ProgressBar';
import SplitScreenplayPreview from '../components/conversion/SplitScreenplayPreview';
import EvaluationReport from '../components/conversion/EvaluationReport';
import YamlViewer from '../components/conversion/YamlViewer';
import CharacterGraph from '../components/conversion/CharacterGraph';
import ChatSidebar from '../components/conversion/ChatSidebar';
import ExportMenu from '../components/conversion/ExportMenu';
import { DetailSkeleton } from '../components/common/Skeleton';
import { useToast } from '../contexts/ToastContext';

type Tab = 'screenplay' | 'evaluation' | 'graph' | 'yaml';

interface LogLine {
  id: number;
  text: string;
}

interface SSEData {
  type: string;
  [key: string]: unknown;
}

export default function ConversionDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { error: toastError } = useToast();
  const [task, setTask] = useState<TaskResponse | null>(null);
  const [screenplay, setScreenplay] = useState<ScreenplayData | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('screenplay');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [yamlStream, setYamlStream] = useState('');
  const [liveProgress, setLiveProgress] = useState(0);
  const [liveMessage, setLiveMessage] = useState('');
  const [streamActive, setStreamActive] = useState(false);
  const [resultsReady, setResultsReady] = useState(false);
  const [highlightCharacter, setHighlightCharacter] = useState<string | undefined>(undefined);
  const [showChat, setShowChat] = useState(false);
  const [chatYaml, setChatYaml] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef(0);
  const abortRef = useRef(false);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, yamlStream]);

  const loadResults = useCallback(async (id: number) => {
    try {
      const [sp, ev] = await Promise.all([
        getScreenplay(id),
        getEvaluation(id).catch(() => null),
      ]);
      setScreenplay(sp);
      setEvaluation(ev);
      const t = await getTask(id);
      setTask(t);
      setResultsReady(true);
    } catch {
      toastError('加载剧本数据失败');
    }
  }, [toastError]);

  const handleScreenplaySave = useCallback(async (yaml: string, _stats: { character_count: number; act_count: number; scene_count: number }) => {
    await updateScreenplay(parseInt(taskId!), yaml);
    // Re-fetch screenplay so all exports reflect edits
    const sp = await getScreenplay(parseInt(taskId!));
    setScreenplay(sp);
  }, [taskId]);

  const handleCharacterClick = useCallback((characterName: string) => {
    setHighlightCharacter(characterName);
    setActiveTab('screenplay');
  }, []);

  const handleClearHighlight = useCallback(() => {
    setHighlightCharacter(undefined);
  }, []);

  const handleOpenChat = useCallback(async () => {
    if (!taskId) return;
    setShowChat(true);
    // Fetch the current YAML for the chat context
    if (!chatYaml) {
      try {
        const yamlText = await getYamlContent(parseInt(taskId));
        setChatYaml(yamlText);
      } catch {
        // If fetch fails, generate from current screenplay data
        if (screenplay) {
          const { screenplayToYaml } = await import('../utils/screenplayToYaml');
          setChatYaml(screenplayToYaml(screenplay));
        }
      }
    }
  }, [taskId, chatYaml, screenplay]);

  const handleApplyChatChanges = useCallback(async (yaml: string) => {
    await updateScreenplay(parseInt(taskId!), yaml);
    setChatYaml(yaml);
    // Re-fetch screenplay so all views update
    const sp = await getScreenplay(parseInt(taskId!));
    setScreenplay(sp);
  }, [taskId]);

  function handleSSEComplete(data: { screenplay_id?: number; score?: number; chapter_count?: number; character_count?: number; scene_count?: number }) {
    console.log('[SSE] handleSSEComplete called');
    setStreamActive(false);
    setLiveProgress(100);
    setLiveMessage('转换完成');
    setTask(prev => prev ? {
      ...prev,
      status: 'completed' as const,
      progress: 100,
      progress_message: '转换完成',
      screenplay_id: data.screenplay_id ?? prev.screenplay_id ?? null,
      score: data.score ?? prev.score ?? null,
      chapter_count: data.chapter_count ?? prev.chapter_count ?? null,
    } : null);
    // Load results after a brief delay to ensure DB is committed
    setTimeout(() => {
      const id = parseInt(taskId!);
      loadResults(id);
    }, 500);
  }

  // Initial task load
  useEffect(() => {
    if (!taskId) return;
    const id = parseInt(taskId);

    (async () => {
      try {
        const t = await getTask(id);
        setTask(t);
        setLoading(false);

        if (t.status === 'pending' || t.status === 'processing') {
          setStreamActive(true);
        } else if (t.status === 'completed' && t.screenplay_id) {
          setLogs([
            { id: 1, text: `[完成] 剧本转换完毕！章节数：${t.chapter_count || '?'}，评分：${t.score ?? '?'}/100\n` },
          ]);
          setLiveProgress(100);
          setLiveMessage('转换完成');
          loadResults(id);
        } else if (t.status === 'failed') {
          setLogs([{ id: 1, text: `[错误] ${t.error_message || '转换失败'}\n` }]);
        }
      } catch {
        setError('加载任务失败');
        setLoading(false);
        toastError('加载任务信息失败');
      }
    })();
  }, [taskId, loadResults, toastError]);

  // SSE streaming via fetch + ReadableStream
  useEffect(() => {
    if (!streamActive || !taskId) return;
    const id = parseInt(taskId);
    const token = localStorage.getItem('access_token') || '';

    console.log('[SSE] Connecting to stream for task', id);
    abortRef.current = false;

    async function connect() {
      if (abortRef.current) return;

      const baseUrl = import.meta.env.DEV ? 'http://localhost:8003' : '';
      const url = `${baseUrl}/api/v1/conversion/tasks/${id}/stream`;

      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        console.log('[SSE] Response status:', response.status);

        if (!response.ok) {
          const errText = await response.text();
          console.error('[SSE] HTTP error:', response.status, errText);
          setTask(prev => prev ? {
            ...prev,
            status: 'failed',
            error_message: `连接失败 (HTTP ${response.status})`,
          } : null);
          setStreamActive(false);
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          if (abortRef.current) {
            reader.cancel();
            break;
          }

          const { done, value } = await reader.read();
          if (done) {
            console.log('[SSE] Stream ended');
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events: split by \n\n (event boundary), then parse \n lines
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || ''; // keep incomplete event in buffer

          for (const part of parts) {
            const lines = part.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data: SSEData = JSON.parse(line.slice(6));
                  handleSSEEvent(data);
                } catch { /* ignore malformed JSON */ }
              }
            }
          }
        }
      } catch (err) {
        console.error('[SSE] Connection error:', err);
        if (!abortRef.current) {
          counterRef.current += 1;
          setLogs(prev => [...prev.slice(-300), { id: counterRef.current, text: '\n[提示] 连接中断，3秒后重连...\n' }]);
          // Auto-reconnect after 3s
          await new Promise(r => setTimeout(r, 3000));
          connect();
        }
      }
    }

    function handleSSEEvent(data: SSEData) {
      switch (data.type) {
        case 'snapshot': {
          console.log('[SSE] snapshot:', data.task);
          const t = data.task as Record<string, unknown> | undefined;
          if (t) {
            setLiveProgress((t.progress as number) || 0);
            setLiveMessage((t.progress_message as string) || '');
            if (t.status === 'completed') {
              handleSSEComplete(t as unknown as { screenplay_id?: number; score?: number; chapter_count?: number; character_count?: number; scene_count?: number });
            }
          }
          break;
        }
        case 'progress':
          console.log('[SSE] progress:', data.progress, data.message);
          setLiveProgress(data.progress as number);
          setLiveMessage(data.message as string);
          break;
        case 'log':
          counterRef.current += 1;
          setLogs(prev => [...prev.slice(-300), { id: counterRef.current, text: data.text as string }]);
          break;
        case 'yaml_chunk':
          setYamlStream(data.text as string);
          break;
        case 'complete':
          console.log('[SSE] complete:', data);
          handleSSEComplete(data as unknown as { screenplay_id?: number; score?: number; chapter_count?: number; character_count?: number; scene_count?: number });
          break;
        case 'error':
          setTask(prev => prev ? { ...prev, status: 'failed', error_message: data.message as string } : null);
          setStreamActive(false);
          break;
        case 'heartbeat':
          // ignore keep-alive pings
          break;
      }
    }

    connect();

    return () => {
      console.log('[SSE] Cleanup, aborting connection');
      abortRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamActive, taskId]);

  if (loading) {
    return <div className="max-w-4xl mx-auto"><DetailSkeleton /></div>;
  }
  if (error || !task) return <div className="text-red-600 py-12 text-center">{error || '任务不存在'}</div>;

  // Only show terminal for tasks that are actually in progress
  const showTerminal = streamActive || task.status === 'pending' || task.status === 'processing';

  // For completed tasks, wait for results silently (no terminal flash)
  if (task.status === 'completed' && !resultsReady) {
    return <div className="max-w-4xl mx-auto"><DetailSkeleton /></div>;
  }

  // ======================== PROCESSING / STREAMING VIEW ========================
  if (showTerminal) {
    return (
      <div>
        <Link to="/dashboard" className="text-sm text-blue-600 hover:underline mb-4 inline-block">&larr; 返回任务列表</Link>

        <div className="flex items-center gap-4 mb-4 p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
          <h1 className="font-bold truncate flex-1">{task.original_filename}</h1>
          <StatusBadge status={task.status === 'pending' ? 'processing' : task.status} />
          {streamActive && (
            <span className="text-xs text-green-600 font-mono animate-pulse">● LIVE</span>
          )}
        </div>
        <ProgressBar progress={liveProgress || task.progress} message={liveMessage || task.progress_message || '准备中...'} />

        <div className="mt-4 bg-gray-950 rounded-lg border border-gray-800 overflow-hidden shadow-xl">
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-800">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500" />
              <span className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="text-xs text-gray-500 ml-2">实时转换日志</span>
            {streamActive ? (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-green-400">
                <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                实时输出中
              </span>
            ) : (
              <span className="ml-auto text-xs text-gray-500">转换完成</span>
            )}
          </div>
          <div className="p-4 font-mono text-sm leading-relaxed h-[60vh] overflow-auto bg-gray-950">
            {logs.length === 0 && streamActive && (
              <div className="text-gray-600 animate-pulse">等待转换开始...</div>
            )}
            {logs.map(entry => (
              <div key={entry.id} className="text-green-400 whitespace-pre-wrap">
                {entry.text}
              </div>
            ))}
            {yamlStream && (
              <div className="mt-4 pt-4 border-t border-gray-800">
                <div className="text-cyan-400 text-xs mb-2">╔══════════ YAML 输出 ══════════╗</div>
                <pre className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">{yamlStream}</pre>
                <div className="text-cyan-400 text-xs mt-2">╚══════════════════════════════╝</div>
              </div>
            )}
            {streamActive && (
              <span className="inline-block w-2 h-4 bg-green-400 ml-0.5 animate-pulse" />
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    );
  }

  // ======================== COMPLETED VIEW ========================
  return (
    <div>
      <Link to="/dashboard" className="text-sm text-blue-600 hover:underline mb-4 inline-block">&larr; 返回</Link>
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">{task.original_filename}</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (showChat) {
                  setShowChat(false);
                } else {
                  handleOpenChat();
                }
              }}
              className={`text-sm px-4 py-2 rounded-lg transition-all font-medium flex items-center gap-1.5 ${
                showChat
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/40'
              }`}
            >
              <span>{showChat ? '🤖' : '💬'}</span>
              AI 助理
            </button>
            <ExportMenu
              taskId={task.id}
              title={task.original_filename}
              screenplay={screenplay}
              yamlAvailable
              onDownloadYaml={() => downloadYaml(task.id, task.original_filename.replace(/\.[^.]+$/, '') + '_screenplay.yaml')}
            />
            <StatusBadge status={task.status} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm text-gray-600 dark:text-gray-400 mb-4">
          <div>创建: {new Date(task.created_at).toLocaleString('zh-CN')}</div>
          {task.completed_at && <div>完成: {new Date(task.completed_at).toLocaleString('zh-CN')}</div>}
          {task.chapter_count != null && <div>章节: {task.chapter_count}</div>}
          {screenplay && <div>角色: {screenplay.characters.length}</div>}
          {screenplay && <div>场景: {screenplay.meta.total_scenes}</div>}
          {task.score != null && <div>评分: <span className="font-bold text-green-600">{task.score}/100</span></div>}
        </div>
        {task.status === 'failed' && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-4">
            <p className="text-red-700 dark:text-red-400 font-medium">转换失败</p>
            <pre className="text-xs mt-2 text-red-600 dark:text-red-300 whitespace-pre-wrap">{task.error_message}</pre>
          </div>
        )}
      </div>

      {task.status === 'completed' && screenplay && (
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-6">
              {([
                ['screenplay', '剧本预览'],
                ['graph', '角色关系'],
                ['evaluation', '评估报告'],
                ['yaml', '原始 YAML'],
              ] as [Tab, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setActiveTab(key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
                    ${activeTab === key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}>
                  {label}
                </button>
              ))}
            </div>
            {activeTab === 'screenplay' && <SplitScreenplayPreview data={screenplay} onSave={handleScreenplaySave} highlightCharacter={highlightCharacter} onClearHighlight={handleClearHighlight} />}
            {activeTab === 'graph' && <CharacterGraph characters={screenplay.characters} onCharacterClick={handleCharacterClick} />}
            {activeTab === 'evaluation' && <EvaluationReport data={evaluation} />}
            {activeTab === 'yaml' && <YamlViewer taskId={task.id} />}
          </div>
          {showChat && (
            <ChatSidebar
              taskId={task.id}
              currentYaml={chatYaml}
              onApplyChanges={handleApplyChatChanges}
              onClose={() => setShowChat(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
