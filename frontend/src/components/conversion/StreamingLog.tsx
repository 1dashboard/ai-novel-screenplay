import { useEffect, useRef, useState } from 'react';

interface LogEntry {
  text: string;
  id: number;
}

interface Props {
  taskId: number;
  onProgress: (progress: number, message: string) => void;
  onComplete: (data: { screenplay_id: number; score: number; chapter_count: number; character_count: number; scene_count: number }) => void;
  onError: (message: string) => void;
  onYamlChunk: (yaml: string) => void;
}

export default function StreamingLog({ taskId, onProgress, onComplete, onError, onYamlChunk }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [yamlContent, setYamlContent] = useState('');
  const [finished, setFinished] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef(0);

  useEffect(() => {
    const token = localStorage.getItem('access_token') || '';
    const url = `/api/v1/conversion/tasks/${taskId}/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener('log', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      counterRef.current += 1;
      setLogs(prev => [...prev.slice(-200), { text: data.text, id: counterRef.current }]);
    });

    es.addEventListener('progress', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      onProgress(data.progress, data.message);
    });

    es.addEventListener('snapshot', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      if (data.task?.status === 'completed') {
        onProgress(100, '已完成');
      }
    });

    es.addEventListener('yaml_chunk', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setYamlContent(data.text);
      onYamlChunk(data.text);
    });

    es.addEventListener('complete', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      onComplete(data);
      setFinished(true);
      es.close();
    });

    es.addEventListener('error', (e: MessageEvent) => {
      if (e.data) {
        try {
          const data = JSON.parse(e.data);
          onError(data.message || '转换失败');
        } catch {
          onError('连接中断');
        }
      }
      setFinished(true);
      es.close();
    });

    es.onerror = () => {
      if (!finished) {
        setLogs(prev => [...prev.slice(-200), { text: '\n[提示] 连接断开，正在重连...\n', id: counterRef.current++ }]);
      }
    };

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="bg-gray-950 rounded-lg border border-gray-800 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500" />
          <span className="w-3 h-3 rounded-full bg-yellow-500" />
          <span className="w-3 h-3 rounded-full bg-green-500" />
        </div>
        <span className="text-xs text-gray-500 ml-2">转换日志</span>
        {!finished && (
          <span className="ml-auto flex items-center gap-1 text-xs text-green-400">
            <span className="inline-block w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            处理中
          </span>
        )}
      </div>
      <div className="p-4 font-mono text-sm leading-relaxed h-80 overflow-auto bg-gray-950">
        {/* Show streaming log */}
        {logs.map(entry => (
          <div key={entry.id} className="text-green-400 whitespace-pre-wrap">
            {entry.text}
          </div>
        ))}
        {/* Show YAML content directly in the terminal style */}
        {yamlContent && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <div className="text-cyan-400 text-xs mb-2">╔══════════════════════ YAML 输出 ══════════════════════╗</div>
            <pre className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">{yamlContent}</pre>
            <div className="text-cyan-400 text-xs mt-2">╚══════════════════════════════════════════════════════╝</div>
          </div>
        )}
        {!finished && (
          <span className="inline-block w-2 h-4 bg-green-400 ml-0.5 animate-pulse" />
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
