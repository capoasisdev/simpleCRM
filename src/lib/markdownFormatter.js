/**
 * markdownFormatter.js - Custom Executive Markdown Renderer for CRM AI Assistant
 *
 * Supports:
 * - Markdown Tables with auto-styling & stage badges
 * - Headers (H1, H2, H3, H4) with emoji alignment
 * - Bullet lists & numbered lists
 * - Bold, italic, code blocks, and inline code
 * - Notice blocks (warnings, tips, success alerts)
 * - Safe HTML escaping to prevent XSS
 */

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderStageBadge(stageText) {
  const s = (stageText || '').toLowerCase().trim();
  if (s === 'new' || s === 'new leads') {
    return `<span class="crm-ai-stage-badge new">New</span>`;
  }
  if (s === 'contacted') {
    return `<span class="crm-ai-stage-badge contacted">Contacted</span>`;
  }
  if (s === 'call_not_received' || s === 'call not received') {
    return `<span class="crm-ai-stage-badge call">Call Not Rec.</span>`;
  }
  if (s === 'proposal_sent' || s === 'proposal sent' || s === 'proposal') {
    return `<span class="crm-ai-stage-badge proposal">Proposal</span>`;
  }
  if (s === 'qualified') {
    return `<span class="crm-ai-stage-badge qualified">Qualified</span>`;
  }
  if (s === 'won' || s === 'closed won') {
    return `<span class="crm-ai-stage-badge won">Won</span>`;
  }
  if (s === 'lost' || s === 'closed lost') {
    return `<span class="crm-ai-stage-badge lost">Lost</span>`;
  }
  return null;
}

function formatInline(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="crm-ai-inline-code">$1</code>');
}

export function formatAssistantMarkdown(rawText) {
  if (!rawText) return '';

  // 1. Separate code blocks so they are not altered by line rules
  const codeBlocks = [];
  let processed = rawText.replace(/```([\w]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="crm-ai-code-block"><code>${escapeHtml(code.trim())}</code></pre>`);
    return `__CODE_BLOCK_${idx}__`;
  });

  const lines = processed.split('\n');
  const result = [];
  let inTable = false;
  let tableRows = [];

  function flushTable() {
    if (tableRows.length < 2) {
      // Not a real table, output as plain paragraphs
      tableRows.forEach((r) => result.push(`<p class="crm-ai-p">${formatInline(r)}</p>`));
      tableRows = [];
      inTable = false;
      return;
    }

    const headerLine = tableRows[0];
    // Skip separator line (row 1)
    const dataLines = tableRows.slice(2);

    const headers = headerLine
      .split('|')
      .slice(1, -1)
      .map((h) => h.trim());

    // Check if table contains help/cadence/instructional headers (touch, timing, attempt, etc.)
    const hasCadenceOrGuideHeaders = headers.some((h) =>
      /touch|timing|attempt|step|cadence|metric|method|duration|frequency|channel|strategy|objective|criteria|template|action\s*item/i.test(h)
    );

    // Look for explicit lead/contact name column
    let leadColIdx = headers.findIndex((h) =>
      /^(lead(\s*name)?|client(\s*name)?|prospect)$/i.test(h)
    );

    // If not found, look for general "name" or "contact" column only when accompanied by CRM lead fields
    if (leadColIdx < 0 && !hasCadenceOrGuideHeaders) {
      const nameColIdx = headers.findIndex((h) => /^(name|contact|lead)$/i.test(h));
      const hasCrmColumns = headers.some((h) =>
        /(rep|assigned|owner|agent|stage|status|email|phone|company|deal|value|score)/i.test(h)
      );
      if (nameColIdx >= 0 && hasCrmColumns) {
        leadColIdx = nameColIdx;
      }
    }

    const isLeadListTable = leadColIdx >= 0 && !hasCadenceOrGuideHeaders;

    const isInvalidLeadName = (val) => {
      if (!val || val.length < 2) return true;
      if (/^(step|\d+(st|nd|rd|th)?|day|attempt|call|phase|week|month|touch|action|rule|tip|total|average|n\/a|none|-)/i.test(val)) return true;
      if (/^[0-9\W]+$/.test(val)) return true;
      return false;
    };

    let clickableRowCount = 0;
    const thHtml = headers.map((h) => `<th>${formatInline(h)}</th>`).join('');

    const trHtml = dataLines
      .map((line) => {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());

        if (cells.length === 0) return '';

        let leadName = '';
        if (isLeadListTable && leadColIdx >= 0 && cells[leadColIdx]) {
          const rawName = cells[leadColIdx].replace(/[*_`]/g, '').trim();
          if (!isInvalidLeadName(rawName)) {
            leadName = rawName;
            clickableRowCount++;
          }
        }

        const clickableAttrs = leadName
          ? ` class="crm-ai-clickable-row" data-lead-name="${escapeHtml(leadName)}" title="Click to view full details for ${escapeHtml(leadName)}"`
          : '';

        const tds = cells
          .map((cell) => {
            const badge = renderStageBadge(cell);
            if (badge) return `<td>${badge}</td>`;
            return `<td>${formatInline(cell)}</td>`;
          })
          .join('');

        return `<tr${clickableAttrs}>${tds}</tr>`;
      })
      .filter(Boolean)
      .join('');

    const hint = isLeadListTable && clickableRowCount > 0
      ? `<div class="crm-ai-table-hint"><span>💡 Click on any row to view full details</span></div>`
      : '';

    result.push(
      `<div class="crm-ai-table-wrap">${hint}<table class="crm-ai-table"><thead><tr>${thHtml}</tr></thead><tbody>${trHtml}</tbody></table></div>`
    );

    tableRows = [];
    inTable = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check table line: must start and end with '|'
    const isTableLine = /^\|(.+)\|$/.test(trimmed);

    if (isTableLine) {
      inTable = true;
      tableRows.push(trimmed);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Code block placeholder
    if (trimmed.startsWith('__CODE_BLOCK_')) {
      const idx = parseInt(trimmed.replace('__CODE_BLOCK_', '').replace('__', ''), 10);
      result.push(codeBlocks[idx] || '');
      continue;
    }

    // Headers
    if (/^#\s+(.*$)/.test(line)) {
      result.push(`<h2 class="crm-ai-md-h1">${formatInline(line.replace(/^#\s+/, ''))}</h2>`);
      continue;
    }
    if (/^##\s+(.*$)/.test(line)) {
      result.push(`<h3 class="crm-ai-md-h2">${formatInline(line.replace(/^##\s+/, ''))}</h3>`);
      continue;
    }
    if (/^###\s+(.*$)/.test(line)) {
      result.push(`<h4 class="crm-ai-md-h3">${formatInline(line.replace(/^###\s+/, ''))}</h4>`);
      continue;
    }
    if (/^####\s+(.*$)/.test(line)) {
      result.push(`<h5 class="crm-ai-md-h4">${formatInline(line.replace(/^####\s+/, ''))}</h5>`);
      continue;
    }

    // Unordered bullets
    if (/^[\*•\-]\s+(.*$)/.test(line)) {
      const content = line.replace(/^[\*•\-]\s+/, '');
      result.push(
        `<div class="crm-ai-md-bullet"><span class="crm-ai-bullet-dot">•</span><span class="crm-ai-bullet-text">${formatInline(content)}</span></div>`
      );
      continue;
    }

    // Numbered lists
    if (/^\d+\.\s+(.*$)/.test(line)) {
      const numMatch = line.match(/^(\d+)\.\s+(.*$)/);
      if (numMatch) {
        result.push(
          `<div class="crm-ai-md-numbered"><span class="crm-ai-num-dot">${numMatch[1]}.</span><span class="crm-ai-bullet-text">${formatInline(numMatch[2])}</span></div>`
        );
        continue;
      }
    }

    // Empty lines (paragraph separation)
    if (trimmed === '') {
      result.push(`<div class="crm-ai-md-spacer"></div>`);
      continue;
    }

    // Special Alert / Callout lines (e.g. ⚠️, 💡, 📧, ✅)
    if (/^(⚠️|💡|📌|📧|✅|❌|🔔)\s*(.*$)/.test(trimmed)) {
      result.push(`<div class="crm-ai-callout-line">${formatInline(trimmed)}</div>`);
      continue;
    }

    // Default regular paragraph
    result.push(`<p class="crm-ai-p">${formatInline(line)}</p>`);
  }

  if (inTable) {
    flushTable();
  }

  return result.join('');
}
