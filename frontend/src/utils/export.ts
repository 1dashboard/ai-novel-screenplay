import type { ScreenplayData } from '../types';

// ---------------------------------------------------------------------------
// TXT export — plain text screenplay format
// ---------------------------------------------------------------------------

export function exportTxt(data: ScreenplayData, title: string): void {
  const lines: string[] = [];

  lines.push('='.repeat(60));
  lines.push(`  ${data.meta.title || title}`);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`场景数: ${data.meta.total_scenes}  幕数: ${data.meta.total_acts}  角色数: ${data.characters.length}`);
  lines.push('');

  // Characters
  lines.push('-'.repeat(60));
  lines.push('  角色列表');
  lines.push('-'.repeat(60));
  for (const c of data.characters) {
    const roleLabel =
      c.role === 'protagonist'
        ? '主角'
        : c.role === 'antagonist'
          ? '反派'
          : c.role === 'supporting'
            ? '配角'
            : '次要';
    lines.push(`  ${c.name} [${roleLabel}] ${c.gender || ''} ${c.age_range || ''}`);
    if (c.description) lines.push(`    ${c.description}`);
    if (c.traits.length > 0) lines.push(`    特征: ${c.traits.join(', ')}`);
    lines.push('');
  }

  // Acts
  for (const act of data.acts) {
    lines.push('');
    lines.push('='.repeat(60));
    lines.push(`  ${act.title || `第${act.act_number}幕`}`);
    lines.push('='.repeat(60));

    for (const scene of act.scenes) {
      lines.push('');
      lines.push(`${scene.scene_number}. ${scene.scene_heading}`);
      lines.push(`   地点: ${scene.location} | 时间: ${scene.time_of_day}`);
      if (scene.summary) lines.push(`   概要: ${scene.summary}`);
      lines.push('');

      for (const elem of scene.content) {
        switch (elem.type) {
          case 'action':
            lines.push(`  ${elem.text}`);
            break;
          case 'dialogue':
            lines.push(`                    ${elem.character_name || 'UNKNOWN'}`);
            if (elem.delivery) lines.push(`                    (${elem.delivery})`);
            lines.push(`  ${elem.text}`);
            break;
          case 'parenthetical':
            lines.push(`  (${elem.text})`);
            break;
          case 'transition':
            lines.push(`                    ${elem.text.toUpperCase()}`);
            break;
          case 'note':
            lines.push(`  [${elem.severity || 'info'}] ${elem.text}`);
            break;
        }
        lines.push('');
      }
    }
  }

  downloadBlob(lines.join('\n'), `${title}_screenplay.txt`, 'text/plain;charset=utf-8');
}

// ---------------------------------------------------------------------------
// HTML export — formatted screenplay, printable to PDF
// ---------------------------------------------------------------------------

export function exportHtml(data: ScreenplayData, title: string): void {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${data.meta.title || title}</title>
<style>
  body { font-family: Georgia, 'Noto Serif SC', serif; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.8; color: #1a1a1a; }
  h1 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 12px; }
  h2 { border-bottom: 1px solid #999; padding-bottom: 6px; margin-top: 32px; }
  h3 { margin-top: 28px; color: #444; }
  .meta { text-align: center; color: #666; font-size: 14px; margin-bottom: 24px; }
  .char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin: 12px 0; }
  .char-card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
  .char-card h4 { margin: 0 0 4px; }
  .char-card .role { font-size: 12px; padding: 2px 8px; border-radius: 12px; display: inline-block; }
  .role-protagonist { background: #fef3c7; color: #92400e; }
  .role-antagonist { background: #fecaca; color: #991b1b; }
  .role-supporting { background: #bfdbfe; color: #1e40af; }
  .role-minor { background: #e5e7eb; color: #4b5563; }
  .scene { border: 1px solid #e5e7eb; border-radius: 8px; margin: 16px 0; overflow: hidden; }
  .scene-header { background: #f9fafb; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
  .scene-header .heading { font-weight: bold; font-size: 14px; text-transform: uppercase; }
  .scene-header .info { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .scene-body { padding: 16px 24px; }
  .action { margin-bottom: 12px; }
  .dialogue { margin: 12px 0; }
  .dialogue .char { text-align: center; font-weight: 600; text-transform: uppercase; font-size: 13px; margin-bottom: 4px; }
  .dialogue .text { text-align: center; max-width: 400px; margin: 0 auto; }
  .transition { text-align: right; font-weight: 600; text-transform: uppercase; font-size: 13px; color: #6b7280; margin: 20px 0; padding-top: 12px; border-top: 1px solid #e5e7eb; }
  .note { border-left: 3px solid #3b82f6; padding: 8px 12px; margin: 12px 0; font-size: 13px; background: #eff6ff; }
  .note.warning { border-color: #f59e0b; background: #fffbeb; }
  @media print { body { margin: 0; } .scene { break-inside: avoid; } }
</style>
</head>
<body>

<h1>${data.meta.title || title}</h1>
<div class="meta">
  场景: ${data.meta.total_scenes} | 幕: ${data.meta.total_acts} | 角色: ${data.characters.length} | 语言: ${data.meta.language || 'zh'}
</div>

<h2>角色列表 (${data.characters.length})</h2>
<div class="char-grid">
  ${data.characters
    .map(
      (c) => `
  <div class="char-card">
    <h4>${escHtml(c.name)}</h4>
    <span class="role role-${c.role}">${
      c.role === 'protagonist' ? '主角' : c.role === 'antagonist' ? '反派' : c.role === 'supporting' ? '配角' : '次要'
    }</span>
    ${c.description ? `<p style="font-size:13px;color:#666;margin:6px 0 0">${escHtml(c.description)}</p>` : ''}
    ${c.traits.length > 0 ? `<p style="font-size:12px;color:#999;margin:4px 0 0">${c.traits.map(escHtml).join(' · ')}</p>` : ''}
  </div>`
    )
    .join('\n')}
</div>

${data.acts
  .map(
    (act) => `
<h2>${escHtml(act.title || `第${act.act_number}幕`)}</h2>
${act.scenes
  .map(
    (scene) => `
<div class="scene">
  <div class="scene-header">
    <div class="heading">${scene.scene_number}. ${escHtml(scene.scene_heading)}</div>
    <div class="info">${escHtml(scene.location)} | ${escHtml(scene.time_of_day)}${scene.characters_present?.length ? ` | 出场: ${scene.characters_present.join(', ')}` : ''}</div>
    ${scene.summary ? `<div style="font-size:13px;color:#3b82f6;font-style:italic;margin-top:4px">${escHtml(scene.summary)}</div>` : ''}
  </div>
  <div class="scene-body">
    ${scene.content
      .map((elem) => {
        switch (elem.type) {
          case 'action':
            return `<p class="action">${escHtml(elem.text)}</p>`;
          case 'dialogue':
            return `<div class="dialogue"><p class="char">${escHtml(elem.character_name || 'UNKNOWN')}${elem.delivery ? ` <span style="font-weight:400;font-size:12px;color:#999">(${escHtml(elem.delivery)})</span>` : ''}</p><p class="text">${escHtml(elem.text)}</p></div>`;
          case 'parenthetical':
            return `<p style="text-align:center;font-size:12px;color:#999;font-style:italic">(${escHtml(elem.text)})</p>`;
          case 'transition':
            return `<p class="transition">${escHtml(elem.text)}</p>`;
          case 'note':
            return `<div class="note ${elem.severity === 'warning' ? 'warning' : ''}"><strong>[${elem.severity || 'info'}]</strong> ${escHtml(elem.text)}</div>`;
          default:
            return `<p>${escHtml(elem.text)}</p>`;
        }
      })
      .join('\n')}
  </div>
</div>`
  )
  .join('\n')}
`
  )
  .join('\n')}

</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (win) {
    win.document.write(html);
    win.document.close();
    // Auto-trigger print dialog for PDF save
    setTimeout(() => win.print(), 500);
  }
}

// ---------------------------------------------------------------------------
// DOCX export
// ---------------------------------------------------------------------------

export async function exportDocx(data: ScreenplayData, title: string): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = await import('docx');

  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      text: (data.meta.title as string) || title,
      heading: HeadingLevel.TITLE,
      alignment: 'center',
    }),
    new Paragraph({ text: '' }),
    new Paragraph({
      children: [
        new TextRun({ text: `场景数: ${data.meta.total_scenes}  |  幕数: ${data.meta.total_acts}  |  角色数: ${data.characters.length}  |  语言: ${data.meta.language || 'zh'}`, size: 20, color: '666666' }),
      ],
      alignment: 'center',
    }),
    new Paragraph({ text: '' }),
  );

  // Characters
  children.push(
    new Paragraph({ text: '角色列表', heading: HeadingLevel.HEADING_1 }),
  );
  for (const c of data.characters) {
    const roleLabel =
      c.role === 'protagonist'
        ? '主角'
        : c.role === 'antagonist'
          ? '反派'
          : c.role === 'supporting'
            ? '配角'
            : '次要';
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: c.name, bold: true, size: 24 }),
          new TextRun({ text: `  [${roleLabel}]  ${c.gender || ''} ${c.age_range || ''}`, size: 20, color: '888888' }),
        ],
      }),
    );
    if (c.description) {
      children.push(new Paragraph({ text: c.description, indent: { left: 360 }, spacing: { after: 60 } }));
    }
    if (c.traits.length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `特征: ${c.traits.join(', ')}`, size: 18, color: '999999', italics: true })],
          indent: { left: 360 },
          spacing: { after: 120 },
        }),
      );
    }
  }

  // Acts
  for (const act of data.acts) {
    children.push(
      new Paragraph({ text: act.title || `第${act.act_number}幕`, heading: HeadingLevel.HEADING_1 }),
    );
    for (const scene of act.scenes) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${scene.scene_number}. `, bold: true, size: 22 }),
            new TextRun({ text: scene.scene_heading, bold: true, size: 22, allCaps: true }),
          ],
          spacing: { before: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `${scene.location}  |  ${scene.time_of_day}`, size: 18, color: '888888' }),
          ],
          spacing: { after: 60 },
        }),
      );
      if (scene.summary) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: scene.summary, italics: true, size: 20, color: '3b82f6' })],
            spacing: { after: 120 },
          }),
        );
      }
      for (const elem of scene.content) {
        switch (elem.type) {
          case 'action':
            children.push(new Paragraph({ text: elem.text, spacing: { after: 80 } }));
            break;
          case 'dialogue':
            children.push(
              new Paragraph({
                children: [new TextRun({ text: (elem.character_name || 'UNKNOWN').toUpperCase(), bold: true, size: 22 })],
                alignment: 'center',
                spacing: { before: 120 },
              }),
            );
            if (elem.delivery) {
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: `(${elem.delivery})`, italics: true, size: 18, color: '999999' })],
                  alignment: 'center',
                }),
              );
            }
            children.push(
              new Paragraph({
                children: [new TextRun({ text: elem.text, size: 22 })],
                alignment: 'center',
                indent: { left: 720, right: 720 },
                spacing: { after: 120 },
              }),
            );
            break;
          case 'parenthetical':
            children.push(
              new Paragraph({
                children: [new TextRun({ text: `(${elem.text})`, italics: true, size: 18 })],
                alignment: 'center',
              }),
            );
            break;
          case 'transition':
            children.push(
              new Paragraph({
                children: [new TextRun({ text: elem.text.toUpperCase(), bold: true, size: 20, color: '666666' })],
                alignment: 'right',
                spacing: { before: 200, after: 120 },
                border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' } },
              }),
            );
            break;
          case 'note':
            children.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `[${elem.severity || 'info'}] `, bold: true, size: 18 }),
                  new TextRun({ text: elem.text, size: 18 }),
                ],
                indent: { left: 360 },
                spacing: { after: 60 },
              }),
            );
            break;
          default:
            children.push(new Paragraph({ text: elem.text }));
        }
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${title}_screenplay.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function downloadBlob(content: string | Blob, filename: string, mime: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
