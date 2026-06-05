import { useState, useMemo } from 'react';
import type { CharacterData } from '../../types';

interface Relationship {
  from: string;
  to: string;
  label: string;
  description: string;
}

function buildRelationships(characters: CharacterData[]): Relationship[] {
  const rels: Relationship[] = [];
  const nameSet = new Set(characters.map((c) => c.name));

  for (const c of characters) {
    for (const r of c.relationships) {
      const targetName = r.character_id;
      // Only include if both characters exist in the list
      if (nameSet.has(targetName) || characters.some((ch) => ch.id === r.character_id)) {
        const target = characters.find((ch) => ch.id === r.character_id || ch.name === r.character_id);
        rels.push({
          from: c.name,
          to: target?.name || r.character_id,
          label: r.relation,
          description: r.description,
        });
      }
    }
  }

  return rels;
}

function circularLayout(n: number, radius: number, cx: number, cy: number) {
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    positions.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return positions;
}

export default function CharacterGraph({ characters }: { characters: CharacterData[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const relationships = useMemo(() => buildRelationships(characters), [characters]);

  const width = 700;
  const height = 500;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) - 60;

  const positions = useMemo(
    () => circularLayout(characters.length, radius, cx, cy),
    [characters.length, radius, cx, cy]
  );

  const charPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    characters.forEach((c, i) => map.set(c.name, positions[i]));
    return map;
  }, [characters, positions]);

  const roleColor = (role: string) => {
    switch (role) {
      case 'protagonist':
        return { fill: '#fbbf24', stroke: '#f59e0b', text: '#92400e' };
      case 'antagonist':
        return { fill: '#fca5a5', stroke: '#ef4444', text: '#991b1b' };
      case 'supporting':
        return { fill: '#93c5fd', stroke: '#3b82f6', text: '#1e40af' };
      default:
        return { fill: '#d1d5db', stroke: '#9ca3af', text: '#4b5563' };
    }
  };

  // Filter relationships for highlighting
  const relatedChars = useMemo(() => {
    if (!hovered && !selected) return new Set<string>();
    const focus = selected || hovered;
    const related = new Set<string>();
    related.add(focus!);
    for (const r of relationships) {
      if (r.from === focus) related.add(r.to);
      if (r.to === focus) related.add(r.from);
    }
    return related;
  }, [hovered, selected, relationships]);

  const isDimmed = (name: string) => {
    if (!hovered && !selected) return false;
    return !relatedChars.has(name);
  };

  const getNodeRadius = (name: string) => {
    const char = characters.find((c) => c.name === name);
    if (!char) return 22;
    if (char.role === 'protagonist' || char.role === 'antagonist') return 28;
    if (char.role === 'supporting') return 24;
    return 20;
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          角色关系图
        </h3>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> 主角
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400" /> 反派
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400" /> 配角
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-300" /> 其他
          </span>
        </div>
      </div>

      <div className="overflow-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full max-h-[480px]"
          style={{ minWidth: '500px' }}
        >
          {/* Edges */}
          {relationships.map((rel, i) => {
            const from = charPositions.get(rel.from);
            const to = charPositions.get(rel.to);
            if (!from || !to) return null;

            const dimmed =
              (hovered || selected) &&
              !(rel.from === (selected || hovered) || rel.to === (selected || hovered));

            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;

            return (
              <g key={i} className={dimmed ? 'opacity-10' : 'opacity-70'}>
                <line
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke={dimmed ? '#d1d5db' : '#a78bfa'}
                  strokeWidth={1.5}
                  strokeDasharray={rel.label === '敌对' || rel.label === '对手' ? '6 3' : undefined}
                />
                <rect
                  x={midX - rel.label.length * 4 - 4}
                  y={midY - 9}
                  width={rel.label.length * 8 + 8}
                  height={16}
                  rx={4}
                  fill="white"
                  className="dark:fill-gray-800"
                  stroke={dimmed ? '#e5e7eb' : '#c4b5fd'}
                  strokeWidth={0.5}
                />
                <text
                  x={midX}
                  y={midY + 4}
                  textAnchor="middle"
                  className={`text-[10px] fill-gray-500 dark:fill-gray-400 ${dimmed ? 'opacity-30' : ''}`}
                >
                  {rel.label}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {characters.map((char, i) => {
            const pos = positions[i];
            const colors = roleColor(char.role);
            const nodeR = getNodeRadius(char.name);
            const dimmed = isDimmed(char.name);

            return (
              <g
                key={char.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onMouseEnter={() => setHovered(char.name)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSelected(selected === char.name ? null : char.name)}
                className={`cursor-pointer transition-opacity ${dimmed ? 'opacity-20' : 'opacity-100'}`}
              >
                <circle
                  r={nodeR}
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth={2}
                  className="transition-all hover:stroke-[3px]"
                />
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  className={`text-xs font-bold fill-current ${dimmed ? 'opacity-20' : ''}`}
                  style={{ color: colors.text }}
                  fill={colors.text}
                >
                  {char.name.length > 4 ? char.name.slice(0, 4) + '..' : char.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend / selected info */}
      {selected && (() => {
        const char = characters.find((c) => c.name === selected);
        if (!char) return null;
        const charRels = relationships.filter((r) => r.from === selected || r.to === selected);
        return (
          <div className="mt-4 p-4 bg-purple-50 dark:bg-purple-900/10 rounded-lg border border-purple-100 dark:border-purple-900/30">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-bold text-gray-900 dark:text-white">{selected}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                char.role === 'protagonist' ? 'bg-amber-100 text-amber-800' :
                char.role === 'antagonist' ? 'bg-red-100 text-red-800' :
                'bg-blue-100 text-blue-800'
              }`}>
                {char.role === 'protagonist' ? '主角' : char.role === 'antagonist' ? '反派' : char.role === 'supporting' ? '配角' : '次要'}
              </span>
            </div>
            {charRels.length > 0 ? (
              <div className="space-y-2">
                {charRels.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="shrink-0 text-purple-500 mt-1">&#8594;</span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {r.from === selected ? r.to : r.from}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                      {r.label}
                    </span>
                    {r.description && (
                      <span className="text-gray-500 dark:text-gray-400">— {r.description}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">暂无关系数据</p>
            )}
          </div>
        );
      })()}

      {!selected && (
        <p className="text-xs text-center text-gray-400 mt-3">
          点击角色查看关系详情，悬停高亮关联角色
        </p>
      )}
    </div>
  );
}
