import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ScreenplayData, SceneData, ActData, ContentElement } from '../../types';
import { screenplayToYaml, getScreenplayStats, type ScreenplayStats } from '../../utils/screenplayToYaml';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneData(data: ScreenplayData): ScreenplayData {
  return JSON.parse(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Content block renderer (view mode)
// ---------------------------------------------------------------------------

function ContentBlock({ elem, highlightCharacter }: { elem: ContentElement; highlightCharacter?: string }) {
  switch (elem.type) {
    case 'action':
      return <p className="text-gray-800 dark:text-gray-200 leading-relaxed mb-3">{elem.text}</p>;

    case 'dialogue': {
      const isLit = highlightCharacter && elem.character_name === highlightCharacter;
      return (
        <div className={`mb-3 rounded-lg transition-all ${isLit ? 'bg-yellow-100 dark:bg-yellow-900/30 ring-2 ring-yellow-400 dark:ring-yellow-600 shadow-sm' : ''}`}>
          <p className={`text-center font-semibold tracking-wide uppercase text-sm mt-4 mb-1 ${isLit ? 'text-yellow-800 dark:text-yellow-200' : 'text-gray-700 dark:text-gray-300'}`}>
            {elem.character_name || 'UNKNOWN'}
          </p>
          {elem.delivery && (
            <p className="text-center text-xs text-gray-400 dark:text-gray-500 italic mb-1">
              ({elem.delivery})
            </p>
          )}
          <p className={`text-center max-w-md mx-auto leading-relaxed px-8 pb-2 ${isLit ? 'text-yellow-900 dark:text-yellow-100 font-medium' : 'text-gray-900 dark:text-gray-100'}`}>
            {elem.text}
          </p>
        </div>
      );
    }

    case 'parenthetical':
      return (
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 italic my-1">
          ({elem.text})
        </p>
      );

    case 'transition':
      return (
        <p className="text-right text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 mt-6 mb-4 pt-2 border-t border-gray-200 dark:border-gray-700">
          {elem.text}
        </p>
      );

    case 'note':
      return (
        <div
          className={`my-3 px-4 py-2.5 rounded-lg border text-sm ${
            elem.severity === 'warning'
              ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
              : elem.severity === 'suggestion'
                ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300'
                : 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
          }`}
        >
          <span className="text-xs font-bold uppercase tracking-wide mr-2">
            [{elem.severity || 'info'}]
          </span>
          {elem.text}
        </div>
      );

    default:
      return <p className="mb-2">{elem.text}</p>;
  }
}

// ---------------------------------------------------------------------------
// Editable content block (edit mode)
// ---------------------------------------------------------------------------

function EditableContentBlock({
  elem,
  onChange,
  onDelete,
  highlightCharacter,
}: {
  elem: ContentElement;
  onChange: (updated: ContentElement) => void;
  onDelete: () => void;
  highlightCharacter?: string;
}) {
  const isLit = highlightCharacter && elem.character_name === highlightCharacter;
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (field: string, current: string) => {
    setEditingField(field);
    setEditValue(current);
  };

  const commitEdit = () => {
    if (editingField) {
      onChange({ ...elem, [editingField]: editValue });
    }
    setEditingField(null);
  };

  const typeLabel: Record<string, string> = {
    action: '动作',
    dialogue: '对白',
    parenthetical: '表演指示',
    transition: '转场',
    note: '备注',
  };

  return (
    <div className={`group/edit relative mb-3 border rounded-lg transition-colors ${isLit ? 'border-yellow-400 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-900/20' : 'border-transparent hover:border-blue-300 dark:hover:border-blue-700'}`}>
      {/* Type badge + delete */}
      <div className="flex items-center gap-2 mb-1 opacity-0 group/edit-hover:opacity-100 transition-opacity">
        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
          {typeLabel[elem.type] || elem.type}
        </span>
        {elem.type === 'dialogue' && elem.character_name && (
          <span className="text-[10px] text-purple-500 font-medium">
            {elem.character_name}
          </span>
        )}
        <button
          onClick={onDelete}
          className="ml-auto text-[10px] text-red-400 hover:text-red-600 transition-colors"
          title="删除此元素"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Character name (dialogue only) */}
      {elem.type === 'dialogue' && (
        <div className="text-center mb-1">
          {editingField === 'character_name' ? (
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingField(null); }}
              className="text-sm font-semibold uppercase text-center bg-white dark:bg-gray-800 border border-blue-400 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          ) : (
            <p
              onClick={() => startEdit('character_name', elem.character_name || '')}
              className="text-center font-semibold tracking-wide uppercase text-sm text-gray-700 dark:text-gray-300 mt-4 mb-1 cursor-pointer hover:text-blue-500 hover:underline decoration-dotted"
            >
              {elem.character_name || 'UNKNOWN'}
            </p>
          )}
        </div>
      )}

      {/* Delivery (dialogue only) */}
      {elem.type === 'dialogue' && elem.delivery !== undefined && (
        <div className="text-center mb-1">
          {editingField === 'delivery' ? (
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEditingField(null); } }}
              className="text-xs text-center bg-white dark:bg-gray-800 border border-blue-400 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-500 italic"
              autoFocus
            />
          ) : (
            <p
              onClick={() => startEdit('delivery', elem.delivery || '')}
              className="text-center text-xs text-gray-400 dark:text-gray-500 italic mb-1 cursor-pointer hover:text-blue-500"
            >
              ({elem.delivery || '点击添加语气指示'})
            </p>
          )}
        </div>
      )}

      {/* Text content (all types) */}
      <div className={
        elem.type === 'dialogue' ? 'text-center max-w-md mx-auto px-8' :
        elem.type === 'transition' ? 'text-right' :
        elem.type === 'parenthetical' ? 'text-center' : ''
      }>
        {editingField === 'text' ? (
          elem.type === 'action' || elem.type === 'note' ? (
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditingField(null);
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') commitEdit();
              }}
              className="w-full p-2 text-sm bg-white dark:bg-gray-800 border border-blue-400 rounded outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              rows={3}
              autoFocus
            />
          ) : (
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingField(null); }}
              className="w-full text-sm bg-white dark:bg-gray-800 border border-blue-400 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          )
        ) : (
          <p
            onClick={() => startEdit('text', elem.text)}
            className={`cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded px-1 -mx-1 transition-colors
              ${elem.type === 'action' ? 'text-gray-800 dark:text-gray-200 leading-relaxed' : ''}
              ${elem.type === 'dialogue' ? 'text-gray-900 dark:text-gray-100 leading-relaxed' : ''}
              ${elem.type === 'transition' ? 'text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 mt-6 mb-4 pt-2 border-t border-gray-200 dark:border-gray-700' : ''}
              ${elem.type === 'parenthetical' ? 'text-xs text-gray-400 dark:text-gray-500 italic my-1' : ''}
              ${elem.type === 'note' ? 'text-sm' : ''}
            `}
          >
            {elem.text || '（空，点击编辑）'}
          </p>
        )}
      </div>

      {/* Severity (note only) */}
      {elem.type === 'note' && (
        <div className="mt-1">
          {editingField === 'severity' ? (
            <select
              value={editValue}
              onChange={(e) => { onChange({ ...elem, severity: e.target.value }); setEditingField(null); }}
              onBlur={() => setEditingField(null)}
              className="text-xs bg-white dark:bg-gray-800 border border-blue-400 rounded px-1 py-0.5 outline-none"
              autoFocus
            >
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="suggestion">suggestion</option>
            </select>
          ) : (
            <span
              onClick={() => { setEditingField('severity'); setEditValue(elem.severity || 'info'); }}
              className="text-[10px] font-bold uppercase tracking-wide text-blue-500 cursor-pointer hover:underline ml-1"
            >
              [{elem.severity || 'info'}]
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function buildLines(ancestors: boolean[]): string {
  let result = '';
  for (let i = 0; i < ancestors.length; i++) {
    if (i === ancestors.length - 1) {
      result += ancestors[i] ? '    ' : '│   ';
    } else {
      result += ancestors[i] ? '    ' : '│   ';
    }
  }
  // Append the final branch
  if (ancestors.length > 0) {
    const last = ancestors[ancestors.length - 1];
    result += last ? '└── ' : '├── ';
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SplitScreenplayPreview({
  data,
  onSave,
  highlightCharacter,
  onClearHighlight,
}: {
  data: ScreenplayData;
  onSave?: (yaml: string, stats: ScreenplayStats) => Promise<void>;
  highlightCharacter?: string;
  onClearHighlight?: () => void;
}) {
  const { meta, characters, acts } = data;
  const [selectedScene, setSelectedScene] = useState<{ actIdx: number; sceneIdx: number }>({ actIdx: 0, sceneIdx: 0 });
  const [collapsedActs, setCollapsedActs] = useState<Set<number>>(new Set());

  // Edit state
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<ScreenplayData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const editable = !!onSave;

  const title = (meta.title as string) || '未命名剧本';

  // Use draft in edit mode, original data in view mode
  const activeData = editMode && draft ? draft : data;
  const activeActs = activeData.acts;

  const toggleAct = (actIdx: number) => {
    setCollapsedActs(prev => {
      const next = new Set(prev);
      if (next.has(actIdx)) next.delete(actIdx);
      else next.add(actIdx);
      return next;
    });
  };

  const selectScene = (actIdx: number, sceneIdx: number) => {
    setSelectedScene({ actIdx, sceneIdx });
  };

  const currentAct = activeActs[selectedScene.actIdx];
  const currentScene: SceneData | undefined = currentAct?.scenes[selectedScene.sceneIdx];

  const validSelection = useMemo(() => {
    if (activeActs.length === 0) return { actIdx: 0, sceneIdx: 0 };
    const actIdx = Math.min(selectedScene.actIdx, activeActs.length - 1);
    const sceneIdx = Math.min(selectedScene.sceneIdx, (activeActs[actIdx]?.scenes.length || 1) - 1);
    return { actIdx, sceneIdx };
  }, [activeActs, selectedScene]);

  const treeItems = useMemo(() => {
    const items: {
      label: string; depth: number; ancestors: boolean[]; isLast: boolean;
      type: 'act' | 'scene'; actIdx: number; sceneIdx?: number; sceneHeading?: string;
    }[] = [];

    activeActs.forEach((act, actIdx) => {
      const isLastAct = actIdx === activeActs.length - 1;
      items.push({
        label: `${act.title || `第${act.act_number}幕`}`,
        depth: 1, ancestors: [], isLast: isLastAct,
        type: 'act', actIdx,
      });

      const collapsed = collapsedActs.has(actIdx);
      if (!collapsed) {
        act.scenes.forEach((scene, sceneIdx) => {
          const isLastScene = sceneIdx === act.scenes.length - 1;
          items.push({
            label: `场景${scene.scene_number} ${scene.scene_heading}`,
            depth: 2, ancestors: [isLastAct], isLast: isLastScene,
            type: 'scene', actIdx, sceneIdx, sceneHeading: scene.scene_heading,
          });
        });
      }
    });

    return items;
  }, [activeActs, collapsedActs]);

  // ---- Draft mutators ----
  const updateScene = useCallback((actIdx: number, sceneIdx: number, patch: Partial<SceneData>) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = cloneData(prev);
      const scene = next.acts[actIdx]?.scenes[sceneIdx];
      if (scene) Object.assign(scene, patch);
      return next;
    });
    setDirty(true);
    setSaveError('');
  }, []);

  const updateContentElement = useCallback((actIdx: number, sceneIdx: number, elemIdx: number, updated: ContentElement) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = cloneData(prev);
      const scene = next.acts[actIdx]?.scenes[sceneIdx];
      if (scene && scene.content[elemIdx]) {
        scene.content[elemIdx] = updated;
      }
      return next;
    });
    setDirty(true);
    setSaveError('');
  }, []);

  const deleteContentElement = useCallback((actIdx: number, sceneIdx: number, elemIdx: number) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = cloneData(prev);
      const scene = next.acts[actIdx]?.scenes[sceneIdx];
      if (scene) {
        scene.content = scene.content.filter((_, i) => i !== elemIdx);
      }
      return next;
    });
    setDirty(true);
    setSaveError('');
  }, []);

  // ---- Edit mode handlers ----
  const enterEditMode = () => {
    setDraft(cloneData(data));
    setEditMode(true);
    setDirty(false);
    setSaveError('');
  };

  const cancelEdit = () => {
    if (dirty && !confirm('有未保存的修改，确定放弃？')) return;
    setEditMode(false);
    setDraft(null);
    setDirty(false);
    setSaveError('');
  };

  const handleSave = async () => {
    if (!draft || !onSave) return;
    setSaving(true);
    setSaveError('');
    try {
      const yaml = screenplayToYaml(draft);
      const stats = getScreenplayStats(draft);
      await onSave(yaml, stats);
      setDirty(false);
      setEditMode(false);
      setDraft(null);
    } catch (err: unknown) {
      setSaveError((err as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // Auto-navigate to character's first scene when highlightCharacter changes
  useEffect(() => {
    if (!highlightCharacter) return;
    const char = characters.find(
      (c) => c.name === highlightCharacter || c.aliases.includes(highlightCharacter)
    );
    if (!char?.first_appearance_scene) return;
    const targetScene = char.first_appearance_scene;
    for (let ai = 0; ai < acts.length; ai++) {
      for (let si = 0; si < acts[ai].scenes.length; si++) {
        if (acts[ai].scenes[si].scene_number === targetScene) {
          setSelectedScene({ actIdx: ai, sceneIdx: si });
          // Expand the act containing this scene
          setCollapsedActs((prev) => {
            const next = new Set(prev);
            next.delete(ai);
            return next;
          });
          return;
        }
      }
    }
  }, [highlightCharacter, characters, acts]);

  const sceneCount = activeActs.reduce((s, a) => s + a.scenes.length, 0);

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div className="flex gap-0 h-[75vh] bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
      {/* ================================================================ */}
      {/* Left: Scene Tree                                                    */}
      {/* ================================================================ */}
      <div className="w-80 shrink-0 border-r border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50/50 dark:bg-gray-950/50">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-lg">📖</span>
            <span className="font-bold text-sm text-gray-900 dark:text-white truncate">{title}</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5 ml-7">
            {activeActs.length} 幕 · {sceneCount} 场景 · {characters.length} 角色
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-auto py-2 font-mono text-sm leading-relaxed select-none">
          {treeItems.map((item, i) => {
            const isSelected =
              item.type === 'scene' &&
              validSelection.actIdx === item.actIdx &&
              validSelection.sceneIdx === item.sceneIdx;

            const prefix = item.type === 'act' ? '🎬 ' : '📝 ';

            const treePrefix = item.type === 'act'
              ? (item.isLast ? '└── ' : '├── ')
              : buildLines(item.ancestors);

            return (
              <div
                key={i}
                onClick={() => {
                  if (item.type === 'act') {
                    toggleAct(item.actIdx);
                  } else if (item.sceneIdx !== undefined) {
                    selectScene(item.actIdx, item.sceneIdx);
                  }
                }}
                className={`flex items-center px-4 py-1 cursor-pointer transition-colors whitespace-nowrap
                  ${isSelected
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : item.type === 'act'
                      ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50 font-semibold'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'
                  }`}
              >
                <span className="text-gray-300 dark:text-gray-600 shrink-0">{treePrefix}</span>
                <span className="truncate">{prefix}{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ================================================================ */}
      {/* Right: Scene Detail                                                 */}
      {/* ================================================================ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {currentScene ? (
          <>
            {/* Scene header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-xs font-bold rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                    第{currentAct?.act_number}幕 · 场景{currentScene.scene_number}
                  </span>
                  {currentScene.characters_present && currentScene.characters_present.length > 0 && (
                    <span className="text-xs text-gray-400">
                      {currentScene.characters_present.length} 位角色出场
                    </span>
                  )}
                </div>
                {/* Edit / Save / Cancel buttons */}
                {editable && (
                  <div className="flex items-center gap-1.5">
                    {editMode ? (
                      <>
                        {dirty && (
                          <span className="text-xs text-amber-500 font-medium">未保存</span>
                        )}
                        <button
                          onClick={handleSave}
                          disabled={saving || !dirty}
                          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors font-medium flex items-center gap-1"
                        >
                          {saving ? (
                            <>
                              <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                              保存中...
                            </>
                          ) : '保存'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-xs px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={enterEditMode}
                        className="text-xs px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-blue-600 hover:border-blue-400 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        编辑
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Scene heading */}
              {editMode && draft ? (
                <input
                  value={currentScene.scene_heading}
                  onChange={(e) => updateScene(validSelection.actIdx, validSelection.sceneIdx, { scene_heading: e.target.value })}
                  className="text-lg font-bold w-full bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-500 uppercase tracking-wide text-gray-900 dark:text-white"
                />
              ) : (
                <h2 className="text-lg font-bold text-gray-900 dark:text-white uppercase tracking-wide">
                  {currentScene.scene_heading}
                </h2>
              )}

              {/* Location + Time */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {editMode && draft ? (
                  <>
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <input
                        value={currentScene.location}
                        onChange={(e) => updateScene(validSelection.actIdx, validSelection.sceneIdx, { location: e.target.value })}
                        className="bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 rounded px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <input
                        value={currentScene.time_of_day}
                        onChange={(e) => updateScene(validSelection.actIdx, validSelection.sceneIdx, { time_of_day: e.target.value })}
                        className="bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 rounded px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-blue-500 w-20"
                      />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {currentScene.location}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {currentScene.time_of_day}
                    </span>
                  </>
                )}
              </div>

              {/* Summary */}
              {editMode && draft ? (
                <input
                  value={currentScene.summary || ''}
                  onChange={(e) => updateScene(validSelection.actIdx, validSelection.sceneIdx, { summary: e.target.value })}
                  placeholder="场景概要..."
                  className="mt-2 text-sm w-full bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-500 italic text-blue-600 dark:text-blue-400"
                />
              ) : (
                currentScene.summary && (
                  <p className="mt-2 text-sm text-blue-600 dark:text-blue-400 italic">{currentScene.summary}</p>
                )
              )}

              {saveError && (
                <p className="mt-2 text-xs text-red-500">{saveError}</p>
              )}
            </div>

            {/* Scene content */}
            <div className="flex-1 overflow-auto px-8 py-6 font-[Georgia,'Noto Serif SC',serif] text-[15px] leading-[1.8] max-w-3xl">
              {currentScene.content.length === 0 && (
                <p className="text-gray-400 dark:text-gray-500 italic text-center py-12">
                  此场景暂无内容
                </p>
              )}

              {/* Character highlight banner */}
              {highlightCharacter && !editMode && (
                <div className="mb-4 px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center justify-between">
                  <span className="text-sm text-yellow-700 dark:text-yellow-300">
                    <span className="font-semibold">{highlightCharacter}</span> 的台词已高亮
                  </span>
                  <button
                    onClick={onClearHighlight}
                    className="text-xs text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200 underline underline-offset-2 transition-colors"
                  >
                    取消高亮
                  </button>
                </div>
              )}

              {editMode ? (
                currentScene.content.map((elem, i) => (
                  <EditableContentBlock
                    key={i}
                    elem={elem}
                    onChange={(updated) => updateContentElement(validSelection.actIdx, validSelection.sceneIdx, i, updated)}
                    onDelete={() => deleteContentElement(validSelection.actIdx, validSelection.sceneIdx, i)}
                    highlightCharacter={highlightCharacter}
                  />
                ))
              ) : (
                currentScene.content.map((elem, i) => (
                  <ContentBlock key={i} elem={elem} highlightCharacter={highlightCharacter} />
                ))
              )}
            </div>

            {/* Scene navigation */}
            <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30 flex items-center justify-between">
              <button
                onClick={() => {
                  const { actIdx, sceneIdx } = validSelection;
                  if (sceneIdx > 0) {
                    selectScene(actIdx, sceneIdx - 1);
                  } else if (actIdx > 0) {
                    const prevAct = activeActs[actIdx - 1];
                    selectScene(actIdx - 1, prevAct.scenes.length - 1);
                  }
                }}
                disabled={validSelection.actIdx === 0 && validSelection.sceneIdx === 0}
                className="text-xs px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← 上一场景
              </button>
              <span className="text-xs text-gray-400">
                {activeActs.reduce((count, act, ai) => {
                  if (ai < validSelection.actIdx) return count + act.scenes.length;
                  if (ai === validSelection.actIdx) return count + validSelection.sceneIdx + 1;
                  return count;
                }, 0)} / {sceneCount}
              </span>
              <button
                onClick={() => {
                  const { actIdx, sceneIdx } = validSelection;
                  const currentActScenes = activeActs[actIdx]?.scenes.length || 0;
                  if (sceneIdx < currentActScenes - 1) {
                    selectScene(actIdx, sceneIdx + 1);
                  } else if (actIdx < activeActs.length - 1) {
                    selectScene(actIdx + 1, 0);
                  }
                }}
                disabled={validSelection.actIdx === activeActs.length - 1 && validSelection.sceneIdx === (activeActs[activeActs.length - 1]?.scenes.length || 1) - 1}
                className="text-xs px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                下一场景 →
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
            <div className="text-center">
              <div className="text-4xl mb-3">📜</div>
              <p>从左侧场景树选择一个场景</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
