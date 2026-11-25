window.KotoAPI = (() => {
  'use strict';

  const ENDPOINT = '/api/kotonote.py';

  async function call(action, body = null) {
    const url = `${ENDPOINT}?action=${encodeURIComponent(action)}`;
    const options = body === null
      ? { method: 'GET', cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        };

    const res = await fetch(url, options);
    const text = await res.text();

    // Detect if cloud function is not enabled (static host returned raw Python source)
    if (text.trim().startsWith('# -*- coding') || text.trim().startsWith('import ')) {
      throw new Error('热铁盒云函数未生效（返回了源码），请检查高级账号权限或站点设置');
    }

    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text.slice(0, 160) || `响应格式错误 (${res.status})` };
    }
    if (!res.ok) {
      throw new Error(data.detail || `请求失败 (${res.status})`);
    }
    return data;
  }

  return {
    endpoint: ENDPOINT,
    exportJsonUrl: `${ENDPOINT}?action=export_json`,
    exportTsvUrl: `${ENDPOINT}?action=export_tsv`,
    bootstrap: () => call('bootstrap'),
    createWord: (body) => call('create_word', body),
    updateWord: (id, body) => call('update_word', { id, ...body }),
    deleteWord: (id) => call('delete_word', { id }),
    batchImport: (body) => call('batch_import', body),
    importRows: (items, replace = false) => call('import_rows', { items, replace }),
    addWordEntry: (wordId, content) => call('add_word_entry', { wordId, content }),
    deleteWordEntry: (wordId, entryId) => call('delete_word_entry', { wordId, entryId }),
    saveScratch: (content) => call('save_scratch', { content }),
    addScratchEntry: (content) => call('add_scratch_entry', { content }),
    deleteScratchEntry: (entryId) => call('delete_scratch_entry', { entryId }),
    updateSettings: (patch) => call('update_settings', patch),
    importJson: (payload, replace = false) => call('import_json', { payload, replace }),
    fetchTts: (payload) => call('tts', payload)
  };
})();
