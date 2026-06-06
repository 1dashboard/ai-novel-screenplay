import type { ScreenplayData, CharacterData, ActData, SceneData, ContentElement } from '../types';

// ---------------------------------------------------------------------------
// Minimal YAML builder — produces valid YAML matching backend's expected schema
// ---------------------------------------------------------------------------

function esc(v: string | null | undefined): string {
  if (v == null || v === '') return "''";
  // If the string needs quoting, use JSON.stringify (produces YAML-compatible strings)
  if (
    /[:{}#[\]&*!|>'"%@`,\n]/.test(v) ||
    v.startsWith(' ') ||
    v.endsWith(' ') ||
    v === 'true' ||
    v === 'false' ||
    v === 'null' ||
    v === 'yes' ||
    v === 'no' ||
    /^\d/.test(v)
  ) {
    return JSON.stringify(v);
  }
  return v;
}

function line(indent: number, key: string, val?: string | number | null): string {
  const s = '  '.repeat(indent);
  if (val === undefined || val === null) return `${s}${key}:`;
  if (typeof val === 'number') return `${s}${key}: ${val}`;
  return `${s}${key}: ${esc(val)}`;
}

function buildLines(data: ScreenplayData): string[] {
  const out: string[] = [];
  out.push('screenplay:');

  // --- meta ---
  const m = data.meta;
  out.push('  meta:');
  out.push(line(2, 'title', m.title as string));
  out.push(line(2, 'original_work', (m.original_work as string) || null));
  out.push(line(2, 'original_author', (m.original_author as string) || null));
  out.push(line(2, 'adapted_by', (m.adapted_by as string) || 'AI Novel-to-Script v0.1.0'));
  out.push(line(2, 'version', (m.version as string) || '0.1.0'));
  out.push(line(2, 'created_at', (m.created_at as string) || new Date().toISOString()));
  out.push(line(2, 'language', (m.language as string) || 'zh-CN'));
  out.push(line(2, 'total_acts', data.acts.length));
  out.push(line(2, 'total_scenes', data.acts.reduce((s, a) => s + a.scenes.length, 0)));
  out.push(line(2, 'source_file', (m.source_file as string) || null));
  out.push('  notes: []');

  // --- characters ---
  out.push('  characters:');
  for (const c of data.characters) {
    out.push(`  - id: ${c.id}`);
    out.push(line(2, 'name', c.name));
    if (c.aliases.length > 0) {
      out.push('    aliases:');
      for (const a of c.aliases) out.push(`    - ${esc(a)}`);
    } else {
      out.push('    aliases: []');
    }
    out.push(line(2, 'role', c.role));
    out.push(line(2, 'gender', c.gender || 'unknown'));
    out.push(line(2, 'age_range', c.age_range || null));
    if (c.traits.length > 0) {
      out.push('    traits:');
      for (const t of c.traits) out.push(`    - ${esc(t)}`);
    } else {
      out.push('    traits: []');
    }
    out.push(line(2, 'description', c.description || null));
    if (c.relationships.length > 0) {
      out.push('    relationships:');
      for (const r of c.relationships) {
        out.push(`    - character_id: ${r.character_id}`);
        out.push(line(3, 'relation', r.relation));
        out.push(line(3, 'description', r.description || null));
      }
    } else {
      out.push('    relationships: []');
    }
    out.push(line(2, 'first_appearance_scene', c.first_appearance_scene));
  }

  // --- acts ---
  out.push('  acts:');
  for (const act of data.acts) {
    out.push(`  - act_number: ${act.act_number}`);
    out.push(line(2, 'title', act.title || null));
    out.push('    scenes:');
    for (const scene of act.scenes) {
      out.push(`    - scene_number: ${scene.scene_number}`);
      out.push(line(3, 'scene_heading', scene.scene_heading));
      out.push(line(3, 'location', scene.location));
      out.push(line(3, 'time_of_day', scene.time_of_day));
      if (scene.characters_present.length > 0) {
        out.push('      characters_present:');
        for (const cp of scene.characters_present) out.push(`      - ${cp}`);
      } else {
        out.push('      characters_present: []');
      }
      out.push(line(3, 'summary', scene.summary || null));
      out.push('      content:');
      for (const elem of scene.content) {
        out.push(...buildContentElement(elem, 4));
      }
    }
  }

  return out;
}

function buildContentElement(elem: ContentElement, indent: number): string[] {
  const out: string[] = [];
  out.push(`${'  '.repeat(indent)}- type: ${elem.type}`);

  switch (elem.type) {
    case 'action':
      out.push(line(indent + 1, 'text', elem.text));
      break;
    case 'dialogue':
      out.push(line(indent + 1, 'character_id', elem.character_id || ''));
      out.push(line(indent + 1, 'character_name', elem.character_name || ''));
      out.push(line(indent + 1, 'text', elem.text));
      if (elem.delivery) {
        out.push(line(indent + 1, 'delivery', elem.delivery));
      }
      break;
    case 'parenthetical':
      out.push(line(indent + 1, 'text', elem.text));
      break;
    case 'transition':
      out.push(line(indent + 1, 'text', elem.text));
      break;
    case 'note':
      out.push(line(indent + 1, 'text', elem.text));
      if (elem.severity && elem.severity !== 'info') {
        out.push(line(indent + 1, 'severity', elem.severity));
      }
      break;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScreenplayStats {
  character_count: number;
  act_count: number;
  scene_count: number;
}

export function screenplayToYaml(data: ScreenplayData): string {
  return buildLines(data).join('\n') + '\n';
}

export function getScreenplayStats(data: ScreenplayData): ScreenplayStats {
  return {
    character_count: data.characters.length,
    act_count: data.acts.length,
    scene_count: data.acts.reduce((s, a) => s + a.scenes.length, 0),
  };
}
