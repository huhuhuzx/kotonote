window.KotoExcel = (() => {
  'use strict';

  const utf8Decoder = new TextDecoder('utf-8');

  function decodeTextAuto(u8) {
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      return utf8Decoder.decode(u8.subarray(3));
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch {
      try {
        return new TextDecoder('gb18030').decode(u8);
      } catch {
        return utf8Decoder.decode(u8);
      }
    }
  }

  function colRefToIndex(ref) {
    if (!ref) return -1;
    const m = String(ref).match(/^([A-Za-z]+)/);
    if (!m) return -1;
    const letters = m[1].toUpperCase();
    let idx = 0;
    for (let i = 0; i < letters.length; i++) {
      idx = idx * 26 + (letters.charCodeAt(i) - 64);
    }
    return idx - 1;
  }

  function indexToColLetter(idx) {
    let n = idx + 1;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function trimEmptyEdges(rows) {
    const cleaned = [];
    for (const r of rows) {
      const arr = Array.isArray(r) ? r.map((c) => (c === null || c === undefined ? '' : String(c))) : [];
      while (arr.length > 0 && arr[arr.length - 1].trim() === '') {
        arr.pop();
      }
      if (arr.some((c) => c.trim() !== '')) {
        cleaned.push(arr);
      }
    }
    return cleaned;
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器版本不支持原生解压 .xlsx，请升级系统浏览器或改用 .csv 导入');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  function parseZipCentralDirectory(u8) {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const minOff = Math.max(0, u8.length - 65557);
    let eocdOff = -1;
    for (let i = u8.length - 22; i >= minOff; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOff = i;
        break;
      }
    }
    if (eocdOff < 0) {
      throw new Error('文件不是有效的 .xlsx（ZIP 结构损坏）');
    }

    const totalEntries = view.getUint16(eocdOff + 10, true);
    const cdOffset = view.getUint32(eocdOff + 16, true);
    const entries = new Map();

    let ptr = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (ptr + 46 > u8.length || view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);
      const name = utf8Decoder.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
      entries.set(name, { name, method, compSize, localHeaderOffset });
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return { u8, view, entries };
  }

  async function readZipEntryText(zip, path) {
    const normalized = path.replace(/^\/+/, '');
    const entry = zip.entries.get(normalized);
    if (!entry) return null;
    const lh = entry.localHeaderOffset;
    if (lh + 30 > zip.u8.length || zip.view.getUint32(lh, true) !== 0x04034b50) {
      return null;
    }
    const nameLen = zip.view.getUint16(lh + 26, true);
    const extraLen = zip.view.getUint16(lh + 28, true);
    const start = lh + 30 + nameLen + extraLen;
    const compData = zip.u8.subarray(start, start + entry.compSize);

    let plain;
    if (entry.method === 0) {
      plain = compData;
    } else if (entry.method === 8) {
      plain = await inflateRaw(compData);
    } else {
      throw new Error(`不支持的 ZIP 压缩方式 (${entry.method})`);
    }
    return utf8Decoder.decode(plain);
  }

  function extractRichTextNoRuby(containerEl) {
    let out = '';
    for (let node = containerEl.firstChild; node; node = node.nextSibling) {
      if (node.nodeType !== 1) continue;
      const ln = node.localName;
      if (ln === 't') {
        out += node.textContent || '';
      } else if (ln === 'r') {
        for (let sub = node.firstChild; sub; sub = sub.nextSibling) {
          if (sub.nodeType === 1 && sub.localName === 't') {
            out += sub.textContent || '';
          }
        }
      }
    }
    return out;
  }

  function resolveXlsxTarget(target) {
    let p = String(target || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!p.startsWith('xl/')) {
      p = p.replace(/^\.\.\//, '');
      if (!p.startsWith('xl/')) p = 'xl/' + p;
    }
    return p;
  }

  function parseWorksheetXml(xmlStr, sharedStrings) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'application/xml');
    const rowEls = doc.getElementsByTagNameNS('*', 'row');
    const rows = [];

    for (let r = 0; r < rowEls.length; r++) {
      const rowEl = rowEls[r];
      const cellEls = rowEl.getElementsByTagNameNS('*', 'c');
      const rowArr = [];
      let fallbackCol = 0;

      for (let c = 0; c < cellEls.length; c++) {
        const cell = cellEls[c];
        const ref = cell.getAttribute('r');
        const colIdx = ref ? colRefToIndex(ref) : fallbackCol;
        fallbackCol = colIdx + 1;
        if (colIdx < 0) continue;

        const type = cell.getAttribute('t') || '';
        let val = '';

        if (type === 's') {
          const vEls = cell.getElementsByTagNameNS('*', 'v');
          if (vEls.length) {
            const idx = parseInt(vEls[0].textContent || '', 10);
            val = Number.isFinite(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : '';
          }
        } else if (type === 'inlineStr') {
          const isEls = cell.getElementsByTagNameNS('*', 'is');
          if (isEls.length) {
            val = extractRichTextNoRuby(isEls[0]);
          }
        } else if (type === 'b') {
          const vEls = cell.getElementsByTagNameNS('*', 'v');
          val = vEls.length && vEls[0].textContent === '1' ? 'TRUE' : 'FALSE';
        } else {
          const vEls = cell.getElementsByTagNameNS('*', 'v');
          if (vEls.length) {
            val = vEls[0].textContent || '';
          }
        }

        while (rowArr.length < colIdx) rowArr.push('');
        rowArr[colIdx] = val;
      }

      rows.push(rowArr);
    }

    return trimEmptyEdges(rows);
  }

  async function parseXlsx(u8) {
    const zip = parseZipCentralDirectory(u8);
    const parser = new DOMParser();

    const sharedStrings = [];
    const ssXml = await readZipEntryText(zip, 'xl/sharedStrings.xml');
    if (ssXml) {
      const ssDoc = parser.parseFromString(ssXml, 'application/xml');
      const siEls = ssDoc.getElementsByTagNameNS('*', 'si');
      for (let i = 0; i < siEls.length; i++) {
        sharedStrings.push(extractRichTextNoRuby(siEls[i]));
      }
    }

    const relMap = new Map();
    const relsXml = await readZipEntryText(zip, 'xl/_rels/workbook.xml.rels');
    if (relsXml) {
      const relDoc = parser.parseFromString(relsXml, 'application/xml');
      const relEls = relDoc.getElementsByTagNameNS('*', 'Relationship');
      for (let i = 0; i < relEls.length; i++) {
        const id = relEls[i].getAttribute('Id');
        const target = relEls[i].getAttribute('Target');
        if (id && target) relMap.set(id, resolveXlsxTarget(target));
      }
    }

    const sheetSpecs = [];
    const wbXml = await readZipEntryText(zip, 'xl/workbook.xml');
    if (wbXml) {
      const wbDoc = parser.parseFromString(wbXml, 'application/xml');
      const sheetEls = wbDoc.getElementsByTagNameNS('*', 'sheet');
      for (let i = 0; i < sheetEls.length; i++) {
        const el = sheetEls[i];
        const name = el.getAttribute('name') || `Sheet${i + 1}`;
        const rid =
          el.getAttribute('r:id') ||
          el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ||
          el.getAttribute('id');
        const target = (rid && relMap.get(rid)) || `xl/worksheets/sheet${i + 1}.xml`;
        sheetSpecs.push({ name, target });
      }
    }

    if (!sheetSpecs.length) {
      const fallbackTargets = Array.from(zip.entries.keys())
        .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      fallbackTargets.forEach((t, idx) => sheetSpecs.push({ name: `Sheet${idx + 1}`, target: t }));
    }

    const sheets = [];
    for (const spec of sheetSpecs) {
      const xml = await readZipEntryText(zip, spec.target);
      if (!xml) continue;
      const rows = parseWorksheetXml(xml, sharedStrings);
      if (rows.length) {
        sheets.push({ name: spec.name, rows });
      }
    }

    if (!sheets.length) {
      throw new Error('Excel 文件中没有读取到任何有效数据行');
    }
    return { sheets };
  }

  function parseHtmlTable(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const tables = doc.querySelectorAll('table');
    const sheets = [];
    tables.forEach((tbl, idx) => {
      const rows = [];
      tbl.querySelectorAll('tr').forEach((tr) => {
        const row = [];
        tr.querySelectorAll('th, td').forEach((cell) => {
          row.push((cell.innerText || cell.textContent || '').trim());
        });
        rows.push(row);
      });
      const cleaned = trimEmptyEdges(rows);
      if (cleaned.length) sheets.push({ name: `表格${idx + 1}`, rows: cleaned });
    });
    return sheets;
  }

  function parseSpreadsheetML(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const wsEls = doc.getElementsByTagNameNS('*', 'Worksheet');
    const sheets = [];
    for (let w = 0; w < wsEls.length; w++) {
      const ws = wsEls[w];
      const name = ws.getAttribute('ss:Name') || ws.getAttribute('Name') || `Sheet${w + 1}`;
      const rowEls = ws.getElementsByTagNameNS('*', 'Row');
      const rows = [];
      for (let r = 0; r < rowEls.length; r++) {
        const cellEls = rowEls[r].getElementsByTagNameNS('*', 'Cell');
        const row = [];
        let col = 0;
        for (let c = 0; c < cellEls.length; c++) {
          const idxAttr = cellEls[c].getAttribute('ss:Index') || cellEls[c].getAttribute('Index');
          if (idxAttr) col = Math.max(0, parseInt(idxAttr, 10) - 1);
          const dataEls = cellEls[c].getElementsByTagNameNS('*', 'Data');
          const val = dataEls.length ? dataEls[0].textContent || '' : '';
          while (row.length < col) row.push('');
          row[col] = val;
          col += 1;
        }
        rows.push(row);
      }
      const cleaned = trimEmptyEdges(rows);
      if (cleaned.length) sheets.push({ name, rows: cleaned });
    }
    return sheets;
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const n = text.length;

    for (let i = 0; i < n; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < n && text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === '"' && field === '') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        if (i + 1 < n && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return trimEmptyEdges(rows);
  }

  function loadExternalScript(url, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      const timer = setTimeout(() => {
        s.remove();
        reject(new Error('timeout'));
      }, timeoutMs);
      s.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      s.onerror = () => {
        clearTimeout(timer);
        s.remove();
        reject(new Error('load failed'));
      };
      document.head.appendChild(s);
    });
  }

  async function ensureSheetJSForLegacyXls() {
    if (window.XLSX && typeof window.XLSX.read === 'function') return window.XLSX;
    const cdns = [
      'https://cdn.staticfile.net/xlsx/0.18.5/xlsx.full.min.js',
      'https://cdn.bootcdn.net/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    ];
    for (const url of cdns) {
      try {
        await loadExternalScript(url);
        if (window.XLSX && typeof window.XLSX.read === 'function') return window.XLSX;
      } catch {}
    }
    throw new Error('旧版二进制 .xls 需要联网加载解析库；建议在 Excel / WPS 中另存为 .xlsx 后直接离线导入');
  }

  async function parseLegacyBinaryXls(u8) {
    const XLSX = await ensureSheetJSForLegacyXls();
    const wb = XLSX.read(u8, { type: 'array' });
    const sheets = [];
    for (const name of wb.SheetNames || []) {
      const ws = wb.Sheets[name];
      const rows = trimEmptyEdges(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }));
      if (rows.length) sheets.push({ name, rows });
    }
    if (!sheets.length) throw new Error('未在 .xls 文件中读取到有效词条');
    return { sheets };
  }

  async function parseFile(file) {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const nameLower = (file.name || '').toLowerCase();

    if (u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04) {
      return await parseXlsx(u8);
    }

    if (u8.length >= 4 && u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0) {
      return await parseLegacyBinaryXls(u8);
    }

    const text = decodeTextAuto(u8);
    const headSample = text.slice(0, 600).toLowerCase();

    if (headSample.includes('<worksheet') || headSample.includes('<workbook')) {
      const sheets = parseSpreadsheetML(text);
      if (sheets.length) return { sheets };
    }
    if (headSample.includes('<table')) {
      const sheets = parseHtmlTable(text);
      if (sheets.length) return { sheets };
    }

    const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
    const tabCount = (firstLines.match(/\t/g) || []).length;
    const commaCount = (firstLines.match(/,/g) || []).length;
    const delimiter = nameLower.endsWith('.tsv') || tabCount >= commaCount ? '\t' : ',';
    const rows = parseDelimited(text, delimiter);
    if (!rows.length) {
      throw new Error('文件内容为空或无法识别格式');
    }
    const baseName = (file.name || '导入词表').replace(/\.[^.]+$/, '');
    return { sheets: [{ name: baseName, rows }] };
  }

  function classifyHeaderCell(raw) {
    const s = String(raw || '').trim().toLowerCase().replace(/[\s_\-()（）]+/g, '');
    if (!s) return null;
    if (/^(假名|读音|讀音|平假名|片假名|ふりがな|フリガナ|かな|カナ|kana|reading|furigana|pronunciation|音标|注音)/.test(s)) {
      return 'kana';
    }
    if (/^(日本語|日语|日語|日文|日|japanese|jp|ja)$/.test(s) || /(日本語|日语|日文)/.test(s)) {
      return 'jp';
    }
    if (/^(中文|汉语|漢語|汉文|中|chinese|zh|cn|中文释义|汉语释义|释义|意思)/.test(s)) {
      return 'zh';
    }
    if (/^(english|英文|英语|英語|英|en)$/.test(s) || /(english|英文|英语)/.test(s)) {
      return 'en';
    }
    if (/^(备注|備註|便签|说明|說明|解释|筆記|笔记|例句|note|notes|remark|comment|memo|desc)/.test(s)) {
      return 'note';
    }
    if (/^(分类|分類|类别|類別|分组|标签|標籤|category|group|tag|module)/.test(s)) {
      return 'category';
    }
    return null;
  }

  function detectColumns(rows) {
    const colMap = { jp: -1, kana: -1, zh: -1, en: -1, note: -1, category: -1 };
    let hasHeader = false;
    let headerRowIndex = 0;

    const scanLimit = Math.min(5, rows.length);
    for (let r = 0; r < scanLimit; r++) {
      const found = {};
      let hits = 0;
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cls = classifyHeaderCell(row[c]);
        if (cls && found[cls] === undefined) {
          found[cls] = c;
          hits++;
        }
      }
      if (hits >= 2) {
        hasHeader = true;
        headerRowIndex = r;
        Object.assign(colMap, found);
        break;
      }
    }

    let maxCols = 0;
    for (let r = 0; r < Math.min(30, rows.length); r++) {
      maxCols = Math.max(maxCols, (rows[r] || []).length);
    }

    const dataStart = hasHeader ? headerRowIndex + 1 : 0;
    const sampleRows = rows.slice(dataStart, dataStart + 20);
    const usedCols = new Set(Object.values(colMap).filter((v) => v >= 0));

    if (colMap.jp < 0 || colMap.zh < 0 || colMap.en < 0) {
      const stats = [];
      for (let c = 0; c < maxCols; c++) {
        if (usedCols.has(c)) continue;
        let kanaScore = 0, enScore = 0, zhScore = 0, nonEmpty = 0, avgLen = 0;
        for (const row of sampleRows) {
          const val = String(row[c] || '').trim();
          if (!val) continue;
          nonEmpty++;
          avgLen += val.length;
          if (/[ぁ-んァ-ヶ]/.test(val)) kanaScore += 2;
          else if (/^[a-zA-Z0-9\s\-_\/().,=+&:%~]+$/.test(val) && /[a-zA-Z]/.test(val)) enScore += 2;
          else if (/[\u4e00-\u9fff]/.test(val)) zhScore += 1;
        }
        if (nonEmpty > 0) avgLen /= nonEmpty;
        stats.push({ col: c, kanaScore, enScore, zhScore, nonEmpty, avgLen });
      }

      const pickBest = (field, scorer) => {
        if (colMap[field] >= 0) return;
        const avail = stats.filter((s) => !usedCols.has(s.col) && scorer(s) > 0);
        if (!avail.length) return;
        avail.sort((a, b) => scorer(b) - scorer(a));
        colMap[field] = avail[0].col;
        usedCols.add(avail[0].col);
      };

      pickBest('jp', (s) => s.kanaScore);
      pickBest('en', (s) => s.enScore);
      pickBest('zh', (s) => s.zhScore);

      const remaining = [];
      for (let c = 0; c < maxCols; c++) {
        if (!usedCols.has(c)) remaining.push(c);
      }
      for (const f of ['jp', 'zh', 'en', 'note']) {
        if (colMap[f] < 0 && remaining.length) {
          colMap[f] = remaining.shift();
        }
      }
    }

    const headers = [];
    for (let c = 0; c < maxCols; c++) {
      const letter = indexToColLetter(c);
      const title = hasHeader && rows[headerRowIndex] && rows[headerRowIndex][c]
        ? String(rows[headerRowIndex][c]).trim()
        : '';
      const preview = sampleRows[0] && sampleRows[0][c]
        ? String(sampleRows[0][c]).trim().slice(0, 14)
        : '';
      headers.push({
        index: c,
        label: title
          ? `${letter}列 · ${title}`
          : preview
          ? `${letter}列（例：${preview}）`
          : `${letter}列`
      });
    }

    return { hasHeader, headerRowIndex, colMap, headers, maxCols };
  }

  function isRepeatedHeaderRow(row, headerRow, colMap) {
    if (!headerRow) return false;
    let matches = 0;
    let checked = 0;
    for (const k of ['jp', 'zh', 'en']) {
      const idx = colMap[k];
      if (idx >= 0) {
        const hv = String(headerRow[idx] || '').trim().toLowerCase();
        const rv = String(row[idx] || '').trim().toLowerCase();
        if (hv) {
          checked++;
          if (rv === hv) matches++;
        }
      }
    }
    return checked >= 2 && matches === checked;
  }

  function buildItemsFromRows(rows, { hasHeader, headerRowIndex, colMap, defaultCategory = 'Excel导入', strictRaw = true }) {
    const startIdx = hasHeader ? headerRowIndex + 1 : 0;
    const headerRow = hasHeader ? rows[headerRowIndex] : null;
    const items = [];

    for (let r = startIdx; r < rows.length; r++) {
      const row = rows[r] || [];
      if (hasHeader && isRepeatedHeaderRow(row, headerRow, colMap)) continue;

      const jp = colMap.jp >= 0 ? String(row[colMap.jp] || '').trim() : '';
      const kana = colMap.kana >= 0 ? String(row[colMap.kana] || '').trim() : '';
      const zh = colMap.zh >= 0 ? String(row[colMap.zh] || '').trim() : '';
      const en = colMap.en >= 0 ? String(row[colMap.en] || '').trim() : '';
      const note = colMap.note >= 0 ? String(row[colMap.note] || '').trim() : '';
      const catCell = colMap.category >= 0 ? String(row[colMap.category] || '').trim() : '';

      if (!jp && !zh && !en) continue;

      items.push({
        jp,
        kana,
        zh,
        en,
        note,
        category: catCell || defaultCategory || 'Excel导入'
      });
    }
    return items;
  }

  return {
    parseFile,
    detectColumns,
    buildItemsFromRows,
    indexToColLetter
  };
})();
