(() => {
  'use strict';

  const API = window.KotoAPI;
  const Speech = window.KotoSpeech;
  const $ = (id) => document.getElementById(id);

  const isIOS = /iP(hone|ad|od)/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isInAppBrowser = /MicroMessenger|QQ\/|Weibo|DingTalk|Lark/i.test(navigator.userAgent);

  const state = {
    words: [],
    categories: [],
    selectedCategory: '全部',
    scratch: { text: '', entries: [] },
    settings: {
      theme: 'light',
      order: 'sequential',
      durationMin: 15,
      rate: 1.0,
      langPauseSec: 2.5,
      jpVoice: ''
    },
    activeTab: 'study',
    studyIndex: 0,
    noteTab: 'word',
    batchFormat: 'tsv',
    // Recite
    isPlaying: false,
    playOrder: [],
    playPos: 0,
    activeLang: null,
    jpRepeatPass: 0,
    remainingSec: 15 * 60,
    timerInterval: null,
    lastTickTs: null,
    wakeLock: null,
    wakeLockWanted: false
  };

  function showToast(msg, duration = 2600) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove('show'), duration);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  function nowShortTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function getScopedWords() {
    if (state.selectedCategory === '全部') return state.words;
    return state.words.filter((w) => w.category === state.selectedCategory);
  }

  function applyTheme() {
    const theme = state.settings.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    $('theme-toggle-btn').textContent = theme === 'dark' ? '☀️' : '🌙';
    $('theme-color-meta').setAttribute('content', theme === 'dark' ? '#000000' : '#F2F2F7');
  }

  function rebuildPlayOrder(resetPos = false) {
    const scoped = getScopedWords();
    const ids = scoped.map((w) => w.id);
    if (state.settings.order === 'shuffle') {
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    }
    state.playOrder = ids;
    if (resetPos || state.playPos >= state.playOrder.length) {
      state.playPos = 0;
    }
  }

  function getCurrentStudyWord() {
    const scoped = getScopedWords();
    if (!scoped.length) return null;
    if (state.studyIndex >= scoped.length) state.studyIndex = 0;
    if (state.studyIndex < 0) state.studyIndex = scoped.length - 1;
    return scoped[state.studyIndex];
  }

  function getCurrentReciteWord() {
    const scoped = getScopedWords();
    if (!scoped.length) return null;
    if (!state.playOrder.length) rebuildPlayOrder(true);
    const id = state.playOrder[state.playPos];
    return scoped.find((w) => w.id === id) || scoped[0];
  }

  function renderCategoryStrips() {
    const allBtn = `<button class="cat-chip ${state.selectedCategory === '全部' ? 'active' : ''}" data-cat="全部">全部 (${state.words.length})</button>`;
    const catBtns = state.categories
      .map(
        (c) =>
          `<button class="cat-chip ${state.selectedCategory === c.name ? 'active' : ''}" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${c.count})</button>`
      )
      .join('');
    const html = allBtn + catBtns;
    ['study-cat-strip', 'recite-cat-strip', 'lexicon-cat-strip'].forEach((id) => {
      const el = $(id);
      if (el) el.innerHTML = html;
    });

    const datalist = $('category-datalist');
    if (datalist) {
      datalist.innerHTML = state.categories
        .map((c) => `<option value="${escapeHtml(c.name)}"></option>`)
        .join('');
    }
  }

  function setFieldDisplay(el, value, placeholder) {
    if (value && value.trim()) {
      el.classList.remove('muted-placeholder');
      el.textContent = value;
    } else {
      el.classList.add('muted-placeholder');
      el.textContent = placeholder;
    }
  }

  function renderStudy() {
    const scoped = getScopedWords();
    const word = getCurrentStudyWord();
    $('study-counter').textContent = scoped.length ? `${state.studyIndex + 1} / ${scoped.length}` : '0 / 0';

    if (!word) {
      $('study-word-cat').textContent = state.selectedCategory;
      setFieldDisplay($('study-jp-text'), '', '当前分类暂无词条');
      $('study-jp-kana').style.display = 'none';
      setFieldDisplay($('study-zh-text'), '', '点击右上角「+ 添加新词」录入');
      setFieldDisplay($('study-en-text'), '', 'Add your terms to Cloud DB');
      renderNotes();
      return;
    }

    $('study-word-cat').textContent = word.category || '未分类';
    setFieldDisplay($('study-jp-text'), word.jp, '（待补充日语）');
    $('study-jp-kana').textContent = word.kana || '';
    $('study-jp-kana').style.display = word.kana ? 'block' : 'none';
    setFieldDisplay($('study-zh-text'), word.zh, '（待补充中文）');
    setFieldDisplay($('study-en-text'), word.en, '（待补充英文）');
    renderNotes();
  }

  function setStudyHighlight(lang) {
    ['jp', 'zh', 'en'].forEach((l) => {
      const el = $(`study-${l}-block`);
      if (el) el.classList.toggle('speaking', l === lang);
    });
  }

  function renderNotes() {
    const isWordTab = state.noteTab === 'word';
    const word = getCurrentStudyWord();

    $('notes-title-label').textContent = isWordTab
      ? word
        ? `本词便签 · ${word.jp || word.zh || word.en}`
        : '本词便签'
      : '随手记 · 全局备忘';

    document.querySelectorAll('[data-note-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.noteTab === state.noteTab);
    });

    const textarea = $('note-textarea');
    if (isWordTab) {
      textarea.disabled = !word;
      textarea.value = word ? word.note || '' : '';
      textarea.placeholder = '记录当前单词的例句、语境、助词搭配或记忆点…';
    } else {
      textarea.disabled = false;
      textarea.value = state.scratch.text || '';
      textarea.placeholder = '随时记录灵感、易混术语对比或待查单词…';
    }

    const entries = isWordTab
      ? word && Array.isArray(word.entries)
        ? word.entries
        : []
      : state.scratch.entries || [];

    const listEl = $('note-entries-list');
    if (!entries.length) {
      listEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = entries
      .map(
        (entry) => `
        <div class="note-entry">
          <div class="note-entry-body">
            <div class="note-entry-text">${escapeHtml(entry.text)}</div>
            <div class="note-entry-time">${escapeHtml(entry.time)}</div>
          </div>
          <button class="note-del-btn" data-del-entry-id="${entry.id}" aria-label="删除这条便签">×</button>
        </div>
      `
      )
      .join('');
  }

  function renderRecite() {
    const scoped = getScopedWords();
    const word = getCurrentReciteWord();
    $('recite-counter').textContent = scoped.length ? `${state.playPos + 1} / ${scoped.length}` : '0 / 0';
    $('recite-timer-text').textContent = formatTime(state.remainingSec);
    $('recite-play-btn').textContent = state.isPlaying ? '⏸' : '▶';
    $('recite-hero').classList.toggle('playing', state.isPlaying);

    if (!word) {
      setFieldDisplay($('recite-jp-text'), '', '暂无词条');
      $('recite-kana-text').style.display = 'none';
      setFieldDisplay($('recite-zh-text'), '', '请先添加或切换分类');
      setFieldDisplay($('recite-en-text'), '', 'Empty list');
    } else {
      setFieldDisplay($('recite-jp-text'), word.jp, '（无日语，自动跳过）');
      $('recite-kana-text').textContent = word.kana || '';
      $('recite-kana-text').style.display = word.kana ? 'block' : 'none';
      setFieldDisplay($('recite-zh-text'), word.zh, '（无中文，自动跳过）');
      setFieldDisplay($('recite-en-text'), word.en, '（无英文，自动跳过）');
    }

    ['jp', 'zh', 'en'].forEach((lang) => {
      const row = $(`recite-row-${lang}`);
      if (row) row.classList.toggle('active-lang', state.activeLang === lang);
    });

    document.querySelectorAll('.order-step').forEach((step) => {
      step.classList.toggle('current', step.dataset.step === state.activeLang);
    });

    document.querySelectorAll('[data-order]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.order === state.settings.order);
    });

    document.querySelectorAll('#duration-chips .chip-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.min) === Number(state.settings.durationMin));
    });

    document.querySelectorAll('#rate-chips .chip-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.rate) === Number(state.settings.rate));
    });

    document.querySelectorAll('#pause-chips .chip-btn').forEach((btn) => {
      btn.classList.toggle('active', Math.abs(Number(btn.dataset.pause) - Number(state.settings.langPauseSec || 2.5)) < 0.05);
    });

    const jpBadge = $('recite-jp-badge');
    if (jpBadge) {
      if (state.isPlaying && state.activeLang === 'jp' && state.jpRepeatPass > 0) {
        jpBadge.textContent = `日 · 第 ${state.jpRepeatPass} / 2 遍`;
      } else {
        jpBadge.textContent = '日 · ja-JP ×2';
      }
    }

    const voiceSelect = $('jp-voice-select');
    if (voiceSelect && voiceSelect.value !== (state.settings.jpVoice || '')) {
      voiceSelect.value = state.settings.jpVoice || '';
    }

    $('wake-lock-btn').classList.toggle('on', Boolean(state.wakeLock));
    $('wake-lock-label').textContent = state.wakeLock ? '常亮已开' : '屏幕常亮';
  }

  function renderLexicon() {
    const q = ($('lexicon-search').value || '').trim().toLowerCase();
    const scoped = getScopedWords();
    const filtered = scoped.filter((w) => {
      if (!q) return true;
      const hay = [
        w.jp,
        w.kana,
        w.zh,
        w.en,
        w.category,
        w.note,
        ...(w.entries || []).map((e) => e.text)
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });

    $('header-subtitle').textContent = `热铁盒云数据库 · ${state.words.length} 词`;
    $('lexicon-count-pill').textContent = q
      ? `匹配 ${filtered.length} / ${scoped.length} 条`
      : `当前共 ${filtered.length} 条术语`;

    const listEl = $('word-list');
    if (!filtered.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">${q ? '未找到匹配词条' : '当前分类暂无术语'}</div>
          <div>点击右上角「+ 添加新词」或使用「批量导入」写入数据库</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered
      .map((w) => {
        const hasNote = Boolean((w.note && w.note.trim()) || (w.entries && w.entries.length));
        return `
          <div class="word-item" data-open-id="${w.id}">
            <div class="word-item-main">
              <div class="word-item-jp">
                <span>${escapeHtml(w.jp || '（待补充日语）')}</span>
                ${w.kana ? `<span class="word-item-kana">${escapeHtml(w.kana)}</span>` : ''}
              </div>
              <div class="word-item-zh">${escapeHtml(w.zh || '（待补充中文）')}</div>
              ${w.en ? `<div class="word-item-en">${escapeHtml(w.en)}</div>` : ''}
              <div class="word-item-tags">
                <span class="word-item-cat-tag">${escapeHtml(w.category || '未分类')}</span>
                ${hasNote ? `<span class="word-item-note-tag">✎ 含备注/便签</span>` : ''}
              </div>
            </div>
            <div class="word-item-actions">
              <button class="mini-action-btn" data-edit-id="${w.id}" title="编辑">✎</button>
              <button class="mini-action-btn danger" data-del-id="${w.id}" title="删除">🗑</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderAll() {
    renderCategoryStrips();
    renderStudy();
    renderRecite();
    renderLexicon();
  }

  // ---------- Recite Loop (Strictly JP -> ZH -> EN, skips empty fields cleanly) ----------
  function startTimer() {
    stopTimer();
    state.lastTickTs = Date.now();
    state.timerInterval = setInterval(() => {
      if (!state.isPlaying) return;
      const now = Date.now();
      const delta = (now - state.lastTickTs) / 1000;
      state.lastTickTs = now;
      state.remainingSec = Math.max(0, state.remainingSec - delta);
      $('recite-timer-text').textContent = formatTime(state.remainingSec);

      if (state.remainingSec <= 0) {
        stopRecite(true);
        showToast('⏰ 定时背词已完成，辛苦了！', 3800);
      }
    }, 400);
  }

  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  function populateJpVoiceSelect() {
    const sel = $('jp-voice-select');
    if (!sel) return;
    const list = Speech.getJapaneseVoices();
    const currentVal = state.settings.jpVoice || '';
    const best = list[0];
    const autoLabel = best
      ? `自动优选（${best.name.replace(/Microsoft |Google |Apple /gi, '')}）`
      : '自动优选（最自然）';

    let optionsHtml = `<option value="">${escapeHtml(autoLabel)}</option>`;
    list.forEach((item) => {
      const tag = item.natural ? '★自然 · ' : '';
      optionsHtml += `<option value="${escapeHtml(item.name)}">${escapeHtml(tag + item.name)}</option>`;
    });
    sel.innerHTML = optionsHtml;
    sel.value = list.some((x) => x.name === currentVal) ? currentVal : '';
  }

  async function runReciteLoop(sessionId, isFirstGestureCall = false) {
    let syncFirst = isFirstGestureCall;
    while (state.isPlaying && sessionId === Speech.getSessionId()) {
      const word = getCurrentReciteWord();
      if (!word) {
        stopRecite(false);
        return;
      }

      const langPauseMs = Math.round(Number(state.settings.langPauseSec || 2.5) * 1000);
      const jpRepeatGapMs = 850;
      const steps = [
        { lang: 'jp', text: word.jp, code: 'ja-JP', repeat: 2 },
        { lang: 'zh', text: word.zh, code: 'zh-CN', repeat: 1 },
        { lang: 'en', text: word.en, code: 'en-US', repeat: 1 }
      ].filter((s) => s.text && s.text.trim());

      for (const step of steps) {
        if (!state.isPlaying || sessionId !== Speech.getSessionId()) return;
        state.activeLang = step.lang;

        for (let pass = 1; pass <= step.repeat; pass++) {
          if (!state.isPlaying || sessionId !== Speech.getSessionId()) return;
          state.jpRepeatPass = step.lang === 'jp' ? pass : 0;
          renderRecite();

          await Speech.speak(step.text, step.code, {
            rate: state.settings.rate,
            syncStart: syncFirst,
            preferredVoiceName: state.settings.jpVoice || '',
            onNotice: (m) => showToast(m, 3200)
          });
          syncFirst = false;

          if (!state.isPlaying || sessionId !== Speech.getSessionId()) return;
          if (pass < step.repeat) {
            if (!(await Speech.waitMs(jpRepeatGapMs, sessionId))) return;
          }
        }

        state.jpRepeatPass = 0;
        // 2-3s pause between every language (日×2 -> 中, 中 -> 英, 英 -> 下一词日)
        if (!(await Speech.waitMs(langPauseMs, sessionId))) return;
      }

      if (!steps.length) {
        if (!(await Speech.waitMs(500, sessionId))) return;
      }

      state.playPos += 1;
      if (state.playPos >= state.playOrder.length) {
        rebuildPlayOrder(true);
      }
    }
  }

  function startRecite() {
    if (!getScopedWords().length) {
      showToast('当前分类暂无词条');
      return;
    }
    Speech.wakeAudioRoute();
    if (state.remainingSec <= 0) {
      state.remainingSec = state.settings.durationMin * 60;
    }
    const sessionId = Speech.cancel();
    state.isPlaying = true;
    startTimer();
    runReciteLoop(sessionId, true);
  }

  function stopRecite(resetLang = true) {
    state.isPlaying = false;
    stopTimer();
    Speech.cancel(true);
    if (resetLang) state.activeLang = null;
    state.jpRepeatPass = 0;
    renderRecite();
  }

  function stepRecite(dir) {
    const scoped = getScopedWords();
    if (!scoped.length) return;
    const wasPlaying = state.isPlaying;
    Speech.cancel(true);
    state.playPos = (state.playPos + dir + state.playOrder.length) % state.playOrder.length;
    state.activeLang = null;
    renderRecite();
    if (wasPlaying) {
      Speech.wakeAudioRoute();
      const sid = Speech.getSessionId();
      runReciteLoop(sid, true);
    }
  }

  // ---------- Study Speech ----------
  async function studySpeakOne(lang) {
    const word = getCurrentStudyWord();
    if (!word) return;
    const map = {
      jp: { text: word.jp, code: 'ja-JP' },
      zh: { text: word.zh, code: 'zh-CN' },
      en: { text: word.en, code: 'en-US' }
    };
    const item = map[lang];
    if (!item || !item.text || !item.text.trim()) {
      showToast('该语言字段为空，可点右上角编辑补充');
      return;
    }
    if (state.isPlaying) stopRecite(true);
    Speech.wakeAudioRoute();
    const sid = Speech.cancel();
    setStudyHighlight(lang);
    await Speech.speak(item.text, item.code, {
      rate: state.settings.rate,
      syncStart: true,
      preferredVoiceName: state.settings.jpVoice || '',
      onNotice: (m) => showToast(m, 3200)
    });
    if (sid === Speech.getSessionId()) setStudyHighlight(null);
  }

  async function studySpeakAll() {
    const word = getCurrentStudyWord();
    if (!word) return;
    if (state.isPlaying) stopRecite(true);
    Speech.wakeAudioRoute();
    const sid = Speech.cancel();

    const steps = [
      { lang: 'jp', text: word.jp, code: 'ja-JP' },
      { lang: 'zh', text: word.zh, code: 'zh-CN' },
      { lang: 'en', text: word.en, code: 'en-US' }
    ].filter((s) => s.text && s.text.trim());

    for (let i = 0; i < steps.length; i++) {
      if (sid !== Speech.getSessionId()) return;
      setStudyHighlight(steps[i].lang);
      await Speech.speak(steps[i].text, steps[i].code, {
        rate: state.settings.rate,
        syncStart: i === 0,
        preferredVoiceName: state.settings.jpVoice || '',
        onNotice: (m) => showToast(m, 3200)
      });
      if (sid !== Speech.getSessionId()) return;
      await Speech.waitMs(360, sid);
    }
    if (sid === Speech.getSessionId()) setStudyHighlight(null);
  }

  async function testVoiceDiagnostic() {
    if (state.isPlaying) stopRecite(true);
    Speech.wakeAudioRoute();
    const sid = Speech.cancel();
    Speech.loadVoices();
    const jpV = Speech.pickSafeVoice('ja-JP', state.settings.jpVoice || '');
    const zhV = Speech.pickSafeVoice('zh-CN');
    const enV = Speech.pickSafeVoice('en-US');
    showToast(
      `日(${jpV ? jpV.name : '默认'}) / 中(${zhV ? zhV.name : '默认'}) / 英(${enV ? enV.name : '默认'})`,
      3800
    );
    await Speech.speak('こんにちは、よろしくお願いします。', 'ja-JP', {
      rate: state.settings.rate,
      syncStart: true,
      preferredVoiceName: state.settings.jpVoice || ''
    });
    if (sid !== Speech.getSessionId()) return;
    await Speech.waitMs(500, sid);
    await Speech.speak('你好', 'zh-CN', { rate: state.settings.rate, syncStart: false });
    if (sid !== Speech.getSessionId()) return;
    await Speech.waitMs(500, sid);
    await Speech.speak('Hello', 'en-US', { rate: state.settings.rate, syncStart: false });
  }

  // ---------- Wake Lock ----------
  async function toggleWakeLock() {
    if (!('wakeLock' in navigator)) {
      showToast('当前浏览器不支持自动防息屏（需 HTTPS 环境）');
      return;
    }
    if (state.wakeLock) {
      try { await state.wakeLock.release(); } catch {}
      state.wakeLock = null;
      state.wakeLockWanted = false;
      renderRecite();
      showToast('已关闭屏幕常亮');
      return;
    }
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLockWanted = true;
      state.wakeLock.addEventListener('release', () => {
        state.wakeLock = null;
        renderRecite();
      });
      renderRecite();
      showToast('已开启屏幕常亮');
    } catch {
      showToast('无法开启常亮（低电量模式或非 HTTPS）');
    }
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.wakeLockWanted && !state.wakeLock && 'wakeLock' in navigator) {
      try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        renderRecite();
      } catch {}
    }
  });

  // ---------- Tabs & Modals ----------
  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.view-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === `view-${tabName}`);
    });
    document.querySelectorAll('.tab-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    renderAll();
  }

  function openWordSheet(word = null) {
    $('word-sheet-title').textContent = word ? '编辑词条' : '添加新词条到数据库';
    $('save-word-submit').textContent = word ? '保存修改' : '保存到数据库';
    $('edit-word-id').value = word ? String(word.id) : '';
    $('input-jp').value = word ? word.jp || '' : '';
    $('input-kana').value = word ? word.kana || '' : '';
    $('input-zh').value = word ? word.zh || '' : '';
    $('input-en').value = word ? word.en || '' : '';
    $('input-category').value = word
      ? word.category || '未分类'
      : state.selectedCategory !== '全部'
      ? state.selectedCategory
      : '显示面板与光学触控';
    $('input-note').value = word ? word.note || '' : '';
    $('word-sheet').classList.add('open');
    setTimeout(() => $('input-jp').focus(), 180);
  }

  function closeWordSheet() {
    $('word-sheet').classList.remove('open');
  }

  function syncSettingsPatch(patch) {
    Object.assign(state.settings, patch);
    API.updateSettings(patch).catch(() => {});
  }

  // ---------- Event Binding ----------
  function bindEvents() {
    if (isIOS && isInAppBrowser) {
      $('inapp-banner').classList.add('show');
    }

    $('theme-toggle-btn').addEventListener('click', () => {
      const next = state.settings.theme === 'dark' ? 'light' : 'dark';
      syncSettingsPatch({ theme: next });
      applyTheme();
    });

    document.querySelectorAll('.tab-item').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Category filter click delegation
    ['study-cat-strip', 'recite-cat-strip', 'lexicon-cat-strip'].forEach((id) => {
      $(id).addEventListener('click', (e) => {
        const chip = e.target.closest('[data-cat]');
        if (!chip) return;
        const cat = chip.dataset.cat;
        if (cat === state.selectedCategory) return;
        if (state.isPlaying) stopRecite(true);
        state.selectedCategory = cat;
        state.studyIndex = 0;
        rebuildPlayOrder(true);
        renderAll();
      });
    });

    // Add / Edit word sheet
    $('open-add-btn').addEventListener('click', () => openWordSheet(null));
    $('lexicon-add-btn').addEventListener('click', () => openWordSheet(null));
    $('close-word-sheet').addEventListener('click', closeWordSheet);
    $('word-sheet').addEventListener('click', (e) => {
      if (e.target === $('word-sheet')) closeWordSheet();
    });

    $('word-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = $('edit-word-id').value.trim();
      const body = {
        jp: $('input-jp').value.trim(),
        kana: $('input-kana').value.trim(),
        zh: $('input-zh').value.trim(),
        en: $('input-en').value.trim(),
        category: $('input-category').value.trim() || '未分类',
        note: $('input-note').value.trim()
      };
      if (!body.jp && !body.zh && !body.en) {
        showToast('日语、中文、英文至少填写一项');
        return;
      }
      try {
        if (id) {
          const res = await API.updateWord(Number(id), body);
          const idx = state.words.findIndex((w) => w.id === Number(id));
          if (idx >= 0) state.words[idx] = res.word;
          state.categories = res.categories;
          showToast('词条已更新至数据库');
        } else {
          const res = await API.createWord(body);
          state.words.unshift(res.word);
          state.categories = res.categories;
          if (state.selectedCategory !== '全部' && res.word.category !== state.selectedCategory) {
            state.selectedCategory = '全部';
          }
          state.studyIndex = 0;
          rebuildPlayOrder(false);
          showToast(`已写入数据库：${res.word.jp || res.word.zh}`);
        }
        closeWordSheet();
        renderAll();
      } catch (err) {
        showToast(err.message);
      }
    });

    // Study controls
    $('study-prev-btn').addEventListener('click', () => {
      const scoped = getScopedWords();
      if (!scoped.length) return;
      Speech.cancel(true);
      setStudyHighlight(null);
      state.studyIndex = (state.studyIndex - 1 + scoped.length) % scoped.length;
      renderStudy();
    });

    $('study-next-btn').addEventListener('click', () => {
      const scoped = getScopedWords();
      if (!scoped.length) return;
      Speech.cancel(true);
      setStudyHighlight(null);
      state.studyIndex = (state.studyIndex + 1) % scoped.length;
      renderStudy();
    });

    $('study-shuffle-btn').addEventListener('click', () => {
      const scoped = getScopedWords();
      if (scoped.length < 2) return;
      Speech.cancel(true);
      setStudyHighlight(null);
      let next = state.studyIndex;
      while (next === state.studyIndex) {
        next = Math.floor(Math.random() * scoped.length);
      }
      state.studyIndex = next;
      renderStudy();
    });

    $('study-edit-btn').addEventListener('click', () => {
      const w = getCurrentStudyWord();
      if (w) openWordSheet(w);
    });

    $('study-speak-all-btn').addEventListener('click', studySpeakAll);
    document.querySelectorAll('#study-card [data-speak]').forEach((block) => {
      block.addEventListener('click', () => studySpeakOne(block.dataset.speak));
    });

    // Swipe left/right
    let touchStartX = 0;
    let touchStartY = 0;
    $('study-card').addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      },
      { passive: true }
    );
    $('study-card').addEventListener(
      'touchend',
      (e) => {
        const scoped = getScopedWords();
        if (!e.changedTouches.length || scoped.length < 2) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 54 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          Speech.cancel(true);
          setStudyHighlight(null);
          state.studyIndex =
            dx < 0 ? (state.studyIndex + 1) % scoped.length : (state.studyIndex - 1 + scoped.length) % scoped.length;
          renderStudy();
        }
      },
      { passive: true }
    );

    // Notes
    document.querySelectorAll('[data-note-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.noteTab = btn.dataset.noteTab;
        renderNotes();
      });
    });

    let saveDebounce = null;
    $('note-textarea').addEventListener('input', (e) => {
      const val = e.target.value;
      $('note-save-status').textContent = '同步中…';
      clearTimeout(saveDebounce);
      saveDebounce = setTimeout(async () => {
        try {
          if (state.noteTab === 'word') {
            const word = getCurrentStudyWord();
            if (word) {
              word.note = val;
              await API.updateWord(word.id, { note: val });
            }
          } else {
            state.scratch.text = val;
            await API.saveScratch(val);
          }
          $('note-save-status').textContent = `已写入数据库 · ${nowShortTime()}`;
        } catch (err) {
          $('note-save-status').textContent = '保存失败，请检查网络';
          showToast(err.message);
        }
      }, 380);
    });

    async function addQuickNote() {
      const input = $('quick-note-input');
      const text = input.value.trim();
      if (!text) return;
      try {
        if (state.noteTab === 'word') {
          const word = getCurrentStudyWord();
          if (!word) return;
          const res = await API.addWordEntry(word.id, text);
          word.entries = res.word.entries;
        } else {
          const res = await API.addScratchEntry(text);
          state.scratch = res.scratch;
        }
        input.value = '';
        $('note-save-status').textContent = `已追加 · ${nowShortTime()}`;
        renderNotes();
        renderLexicon();
      } catch (err) {
        showToast(err.message);
      }
    }

    $('quick-note-add-btn').addEventListener('click', addQuickNote);
    $('quick-note-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addQuickNote();
      }
    });

    $('note-entries-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del-entry-id]');
      if (!btn) return;
      const entryId = Number(btn.dataset.delEntryId);
      try {
        if (state.noteTab === 'word') {
          const word = getCurrentStudyWord();
          if (!word) return;
          await API.deleteWordEntry(word.id, entryId);
          word.entries = (word.entries || []).filter((x) => x.id !== entryId);
        } else {
          await API.deleteScratchEntry(entryId);
          state.scratch.entries = (state.scratch.entries || []).filter((x) => x.id !== entryId);
        }
        renderNotes();
        renderLexicon();
      } catch (err) {
        showToast(err.message);
      }
    });

    // Recite controls
    $('recite-play-btn').addEventListener('click', () => {
      if (state.isPlaying) stopRecite(false);
      else startRecite();
    });
    $('recite-prev-btn').addEventListener('click', () => stepRecite(-1));
    $('recite-next-btn').addEventListener('click', () => stepRecite(1));
    $('wake-lock-btn').addEventListener('click', toggleWakeLock);
    $('test-voice-btn').addEventListener('click', testVoiceDiagnostic);

    document.querySelectorAll('[data-order]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const order = btn.dataset.order;
        if (state.settings.order === order) return;
        syncSettingsPatch({ order });
        rebuildPlayOrder(true);
        renderRecite();
        showToast(order === 'shuffle' ? '已切换为乱序播放' : '已切换为顺序播放');
      });
    });

    document.querySelectorAll('#duration-chips .chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const min = Number(btn.dataset.min);
        state.remainingSec = min * 60;
        syncSettingsPatch({ durationMin: min });
        renderRecite();
        showToast(`定时已设为 ${min === 60 ? '1 小时' : min + ' 分钟'}`);
      });
    });

    document.querySelectorAll('#rate-chips .chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rate = Number(btn.dataset.rate);
        syncSettingsPatch({ rate });
        renderRecite();
        showToast(`语速已调整为 ${rate}x`);
      });
    });

    document.querySelectorAll('#pause-chips .chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = Number(btn.dataset.pause);
        syncSettingsPatch({ langPauseSec: sec });
        renderRecite();
        showToast(`语种间隔已设为 ${sec.toFixed(1)} 秒`);
      });
    });

    const jpVoiceSel = $('jp-voice-select');
    if (jpVoiceSel) {
      jpVoiceSel.addEventListener('change', async () => {
        const chosen = jpVoiceSel.value;
        syncSettingsPatch({ jpVoice: chosen });
        const v = Speech.pickSafeVoice('ja-JP', chosen);
        showToast(`日语发音人：${v ? v.name : '系统默认'}`);
        if (!state.isPlaying) {
          Speech.wakeAudioRoute();
          Speech.cancel();
          await Speech.speak('こんにちは、視野角。', 'ja-JP', {
            rate: state.settings.rate,
            syncStart: true,
            preferredVoiceName: chosen
          });
        }
      });
    }

    Speech.onVoicesChange(populateJpVoiceSelect);
    populateJpVoiceSelect();

    $('reset-timer-btn').addEventListener('click', () => {
      state.remainingSec = state.settings.durationMin * 60;
      renderRecite();
      showToast('倒计时已重置');
    });

    // Lexicon search & item actions
    $('lexicon-search').addEventListener('input', renderLexicon);

    $('word-list').addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-edit-id]');
      if (editBtn) {
        e.stopPropagation();
        const word = state.words.find((w) => w.id === Number(editBtn.dataset.editId));
        if (word) openWordSheet(word);
        return;
      }

      const delBtn = e.target.closest('[data-del-id]');
      if (delBtn) {
        e.stopPropagation();
        const id = Number(delBtn.dataset.delId);
        const target = state.words.find((w) => w.id === id);
        if (target && confirm(`确定从数据库删除「${target.jp || target.zh}」吗？`)) {
          try {
            const res = await API.deleteWord(id);
            state.words = state.words.filter((w) => w.id !== id);
            state.categories = res.categories;
            rebuildPlayOrder(false);
            renderAll();
            showToast('已从数据库删除');
          } catch (err) {
            showToast(err.message);
          }
        }
        return;
      }

      const row = e.target.closest('[data-open-id]');
      if (row) {
        const id = Number(row.dataset.openId);
        const scoped = getScopedWords();
        const idx = scoped.findIndex((w) => w.id === id);
        if (idx >= 0) {
          state.studyIndex = idx;
          switchTab('study');
        }
      }
    });

    // Batch import modal
    $('open-batch-btn').addEventListener('click', () => $('batch-sheet').classList.add('open'));
    $('close-batch-sheet').addEventListener('click', () => $('batch-sheet').classList.remove('open'));
    $('batch-sheet').addEventListener('click', (e) => {
      if (e.target === $('batch-sheet')) $('batch-sheet').classList.remove('open');
    });

    document.querySelectorAll('[data-batch-fmt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.batchFormat = btn.dataset.batchFmt;
        document.querySelectorAll('[data-batch-fmt]').forEach((b) => {
          b.classList.toggle('active', b.dataset.batchFmt === state.batchFormat);
        });
        if (state.batchFormat === 'tsv') {
          $('batch-hint-label').textContent = '直接从 Excel / WPS / 飞书复制粘贴（中文 ⇥ English ⇥ 日本語 ⇥ 备注）：';
          $('batch-textarea').placeholder = '视角\tView Angles\t視野角（しやかく）\t\n对比度\tContrast Ratio\tコントラスト比（コントラストひ）\t';
        } else {
          $('batch-hint-label').textContent = '每行一条，用 | 分隔：日语 | 中文 | 英文 | 假名(可选) | 备注(可选)';
          $('batch-textarea').placeholder = '視野角 | 视角 | View Angles | しやかく | 面板视角参数';
        }
      });
    });

    $('confirm-batch-btn').addEventListener('click', async () => {
      const text = $('batch-textarea').value.trim();
      const category = $('batch-category').value.trim() || '新增术语';
      if (!text) {
        showToast('请先粘贴要导入的内容');
        return;
      }
      try {
        const res = await API.batchImport({ text, format: state.batchFormat, category });
        state.words = res.words;
        state.categories = res.categories;
        rebuildPlayOrder(false);
        $('batch-textarea').value = '';
        $('batch-sheet').classList.remove('open');
        renderAll();
        showToast(
          `导入完成：新增 ${res.stats.added} 条，合并更新 ${res.stats.updated} 条，跳过重复 ${res.stats.skipped} 条`,
          3400
        );
      } catch (err) {
        showToast(err.message);
      }
    });

    // Export / Import
    $('export-tsv-btn').addEventListener('click', () => {
      window.location.href = API.exportTsvUrl;
    });

    $('export-json-btn').addEventListener('click', () => {
      window.location.href = API.exportJsonUrl;
    });

    $('import-json-btn').addEventListener('click', () => $('json-file-input').click());
    $('json-file-input').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const payload = JSON.parse(String(reader.result || '{}'));
          const res = await API.importJson(payload, false);
          state.words = res.words;
          state.categories = res.categories;
          state.scratch = res.scratch;
          rebuildPlayOrder(true);
          renderAll();
          showToast(`备份恢复成功：新增 ${res.stats.added} 条，更新 ${res.stats.updated} 条`);
        } catch (err) {
          showToast('恢复失败：' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  // ---------- Boot ----------
  async function boot() {
    bindEvents();
    try {
      const data = await API.bootstrap();
      state.words = data.words || [];
      state.categories = data.categories || [];
      state.scratch = data.scratch || { text: '', entries: [] };
      state.settings = { ...state.settings, ...(data.settings || {}) };
      state.remainingSec = (state.settings.durationMin || 15) * 60;
      applyTheme();
      populateJpVoiceSelect();
      rebuildPlayOrder(true);
      renderAll();
    } catch (err) {
      $('header-subtitle').textContent = '数据库连接失败';
      showToast('无法连接后端数据库 API：' + err.message, 4500);
    }
  }

  boot();
})();
