(() => {
  'use strict';

  const API = window.KotoAPI;
  const Speech = window.KotoSpeech;
  const BgAudio = window.KotoBgAudio;
  const Excel = window.KotoExcel;
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
      jpVoice: '',
      audioEngine: 'bg_audio',
      ttsProvider: 'free',
      azureRegion: 'eastasia',
      azureKey: '',
      azureJpVoice: 'ja-JP-NanamiNeural'
    },
    activeTab: 'study',
    studyIndex: 0,
    noteTab: 'word',
    batchFormat: 'tsv',
    lexiconSpeakingId: null,
    excel: {
      fileName: '',
      sheets: [],
      selectedSheet: '0',
      mode: 'append',
      hasHeader: true,
      headerRowIndex: 0,
      strictRaw: true,
      colMap: { jp: -1, kana: -1, zh: -1, en: -1, note: -1, category: -1 }
    },
    // Recite
    isPlaying: false,
    isBuffering: false,
    playOrder: [],
    playPos: 0,
    activeLang: null,
    jpRepeatPass: 0,
    remainingSec: 15 * 60,
    timerEndTs: null,
    timerInterval: null,
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

  function isBgAudioMode() {
    return Boolean(BgAudio) && (state.settings.audioEngine || 'bg_audio') === 'bg_audio';
  }

  function getBgAudioOpts() {
    return {
      rate: Number(state.settings.rate || 1.0),
      langPauseSec: Number(state.settings.langPauseSec || 2.5),
      ttsProvider: state.settings.ttsProvider || 'free',
      azureKey: state.settings.azureKey || '',
      azureRegion: state.settings.azureRegion || 'eastasia',
      azureJpVoice: state.settings.azureJpVoice || 'ja-JP-NanamiNeural'
    };
  }

  async function refreshAudioCacheLabel() {
    const el = $('audio-cache-sub');
    if (!el || !BgAudio) return;
    try {
      const count = await BgAudio.getCacheCount();
      el.textContent = `已缓存 ${count} 条语音片段（听过的词断网也能锁屏播）`;
    } catch {}
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

  function getWordAtPlayPos(pos) {
    const scoped = getScopedWords();
    if (!scoped.length) return null;
    if (!state.playOrder.length) rebuildPlayOrder(true);
    const wrapped = ((pos % state.playOrder.length) + state.playOrder.length) % state.playOrder.length;
    const id = state.playOrder[wrapped];
    return scoped.find((w) => w.id === id) || scoped[0];
  }

  function getCurrentReciteWord() {
    return getWordAtPlayPos(state.playPos);
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

  function renderEngineSettingsUI() {
    const bgMode = isBgAudioMode();
    const provider = state.settings.ttsProvider || 'free';

    document.querySelectorAll('[data-engine]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.engine === (bgMode ? 'bg_audio' : 'system'));
    });

    document.querySelectorAll('[data-tts-provider]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.ttsProvider === provider);
    });

    const ttsProviderRow = $('tts-provider-row');
    const azureBox = $('azure-config-box');
    const cacheRow = $('audio-cache-row');
    const sysVoiceRow = $('system-voice-row');

    if (ttsProviderRow) ttsProviderRow.style.display = bgMode ? 'flex' : 'none';
    if (cacheRow) cacheRow.style.display = bgMode ? 'flex' : 'none';
    if (azureBox) azureBox.classList.toggle('show', bgMode && provider === 'azure');
    if (sysVoiceRow) sysVoiceRow.style.display = bgMode ? 'none' : 'flex';

    const banner = $('recite-engine-banner');
    const statusText = $('recite-engine-status-text');
    if (banner && statusText) {
      banner.classList.toggle('system-mode', !bgMode);
      banner.classList.toggle('buffering', bgMode && state.isBuffering);
      if (bgMode) {
        if (state.isBuffering) {
          statusText.textContent = '⏳ 正在合成并缓存本词无缝音频…';
        } else {
          const provLabel = provider === 'azure' && state.settings.azureKey ? 'Azure 神经网络' : '免费云端音源';
          statusText.textContent = `🔒 锁屏音频模式（${provLabel}）· 支持切后台与锁屏连播`;
        }
      } else {
        statusText.textContent = '📱 系统离线语音模式 · 仅限亮屏前台使用';
      }
    }

    const regionInput = $('azure-region-input');
    const keyInput = $('azure-key-input');
    const jpVoiceSel = $('azure-jp-voice-select');
    if (regionInput && document.activeElement !== regionInput) {
      regionInput.value = state.settings.azureRegion || 'eastasia';
    }
    if (keyInput && document.activeElement !== keyInput) {
      keyInput.value = state.settings.azureKey || '';
    }
    if (jpVoiceSel && jpVoiceSel.value !== (state.settings.azureJpVoice || 'ja-JP-NanamiNeural')) {
      jpVoiceSel.value = state.settings.azureJpVoice || 'ja-JP-NanamiNeural';
    }

    const tipBox = $('voice-tip-box');
    if (tipBox) {
      if (bgMode) {
        tipBox.innerHTML =
          '<strong>🔒 锁屏后台播放说明：</strong>开启「锁屏音频」后，系统会将每个词的 <strong>日×2 → 停顿 → 中 → 停顿 → 英</strong> 无缝合成连续音频并预加载下一词，支持 iPhone / 安卓 <strong>锁屏、切后台、控制中心与耳机切词</strong>；已播音频自动缓存到本机，二次复习秒播。';
      } else {
        tipBox.innerHTML =
          '<strong>💡 系统语音优化提示：</strong>iPhone 可在 <strong>设置 → 辅助功能 → 朗读内容 → 声音 → 日语</strong> 下载 <strong>Kyoko（优化版）</strong> 或 <strong>Hattori</strong>。如需锁屏或后台继续听，请切回上方的「🔒 锁屏音频」模式。';
      }
    }
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

    const kanaPill = $('recite-kana-speech-pill');
    if (kanaPill) {
      if (word && (word.jp || word.kana)) {
        const spokenJp = Speech.resolveJapaneseSpeechText(word.jp, word.kana);
        const showPill = Boolean(spokenJp && (word.kana || spokenJp !== (word.jp || '').trim()));
        kanaPill.textContent = showPill ? `按假名朗读：${spokenJp}` : '';
        kanaPill.classList.toggle('show', showPill);
      } else {
        kanaPill.textContent = '';
        kanaPill.classList.remove('show');
      }
    }

    const voiceSelect = $('jp-voice-select');
    if (voiceSelect && voiceSelect.value !== (state.settings.jpVoice || '')) {
      voiceSelect.value = state.settings.jpVoice || '';
    }

    $('wake-lock-btn').classList.toggle('on', Boolean(state.wakeLock));
    $('wake-lock-label').textContent = state.wakeLock ? '常亮已开' : '屏幕常亮';

    renderEngineSettingsUI();
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
                <div class="word-item-jp-btn ${state.lexiconSpeakingId === w.id ? 'speaking' : ''}" data-speak-jp-id="${w.id}" title="点按朗读日语">
                  <span>${escapeHtml(w.jp || '（待补充日语）')}</span>
                  ${w.kana ? `<span class="word-item-kana">${escapeHtml(w.kana)}</span>` : ''}
                  ${(w.jp || w.kana) ? '<span class="word-item-speak-icon">🔊</span>' : ''}
                </div>
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

  // ---------- Wall-Clock Accurate Timer (Survives Lock-Screen Throttling) ----------
  function syncRemainingFromClock() {
    if (!state.isPlaying || !state.timerEndTs) return;
    state.remainingSec = Math.max(0, (state.timerEndTs - Date.now()) / 1000);
    $('recite-timer-text').textContent = formatTime(state.remainingSec);
  }

  function startTimer() {
    stopTimer();
    state.timerEndTs = Date.now() + Math.max(1, state.remainingSec) * 1000;
    state.timerInterval = setInterval(() => {
      if (!state.isPlaying) return;
      syncRemainingFromClock();
      if (state.remainingSec <= 0) {
        stopRecite(true);
        showToast('⏰ 定时背词已完成，辛苦了！', 3800);
      }
    }, 500);
  }

  function stopTimer() {
    if (state.timerEndTs && state.isPlaying) {
      state.remainingSec = Math.max(0, (state.timerEndTs - Date.now()) / 1000);
    }
    state.timerEndTs = null;
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

  // ---------- Recite Loop: Mode 1 — Lock-Screen Continuous <audio> ----------
  async function runReciteBgAudioLoop(bgSessionId) {
    let consecutiveErrors = 0;

    while (state.isPlaying && bgSessionId === BgAudio.getSessionId()) {
      if (state.timerEndTs && Date.now() >= state.timerEndTs) {
        stopRecite(true);
        showToast('⏰ 定时背词已完成，辛苦了！', 3800);
        return;
      }

      const word = getCurrentReciteWord();
      if (!word) {
        stopRecite(false);
        return;
      }

      const opts = getBgAudioOpts();
      BgAudio.updateMediaSession(word, true);

      let track = BgAudio.getCachedTrack(word, opts);
      if (!track) {
        state.isBuffering = true;
        renderRecite();
        // Keep silent audio alive during network fetch so iOS doesn't suspend lock-screen session
        BgAudio.keepAliveSilent();
        try {
          track = await BgAudio.prepareWordTrack(word, opts);
        } catch (err) {
          if (!state.isPlaying || bgSessionId !== BgAudio.getSessionId()) return;
          consecutiveErrors += 1;
          state.isBuffering = false;
          renderRecite();
          if (consecutiveErrors >= 2) {
            showToast('云端音频暂不可用，已自动切换为系统语音继续背词：' + err.message, 4200);
            state.settings.audioEngine = 'system';
            BgAudio.stop(false);
            const spSid = Speech.cancel();
            runReciteSystemLoop(spSid, false);
            return;
          }
          showToast('获取本词音频失败，跳过下一词…', 2400);
          state.playPos = (state.playPos + 1) % Math.max(1, state.playOrder.length);
          continue;
        }
      }

      if (!state.isPlaying || bgSessionId !== BgAudio.getSessionId()) return;
      state.isBuffering = false;
      consecutiveErrors = 0;

      if (!track) {
        state.playPos += 1;
        if (state.playPos >= state.playOrder.length) rebuildPlayOrder(true);
        continue;
      }

      // Immediately prefetch next word while current word is playing (zero-gap transition on lock screen!)
      const nextWord = getWordAtPlayPos(state.playPos + 1);
      if (nextWord && nextWord.id !== word.id) {
        BgAudio.prepareWordTrack(nextWord, opts).then(() => refreshAudioCacheLabel()).catch(() => {});
      }

      const ok = await BgAudio.playTrack(track, {
        rate: opts.rate,
        expectedSession: bgSessionId,
        onSegmentChange: (lang, pass) => {
          if (!state.isPlaying || bgSessionId !== BgAudio.getSessionId()) return;
          state.activeLang = lang;
          state.jpRepeatPass = pass;
          renderRecite();
        }
      });

      refreshAudioCacheLabel();

      if (!state.isPlaying || bgSessionId !== BgAudio.getSessionId()) return;
      if (!ok) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 2) {
          stopRecite(false);
          showToast('音频播放被系统中断，请点击播放按钮继续', 3400);
          return;
        }
      }

      if (state.timerEndTs && Date.now() >= state.timerEndTs) {
        stopRecite(true);
        showToast('⏰ 定时背词已完成，辛苦了！', 3800);
        return;
      }

      state.playPos += 1;
      if (state.playPos >= state.playOrder.length) {
        rebuildPlayOrder(true);
      }
      state.activeLang = null;
      state.jpRepeatPass = 0;
      renderRecite();
    }
  }

  // ---------- Recite Loop: Mode 2 — Browser System Speech ----------
  async function runReciteSystemLoop(sessionId, isFirstGestureCall = false) {
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
        { lang: 'jp', text: word.jp, kana: word.kana || '', code: 'ja-JP', repeat: 2 },
        { lang: 'zh', text: word.zh, kana: '', code: 'zh-CN', repeat: 1 },
        { lang: 'en', text: word.en, kana: '', code: 'en-US', repeat: 1 }
      ].filter((s) => (s.text && s.text.trim()) || (s.kana && s.kana.trim()));

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
            kanaHint: step.lang === 'jp' ? step.kana : '',
            onNotice: (m) => showToast(m, 3200)
          });
          syncFirst = false;

          if (!state.isPlaying || sessionId !== Speech.getSessionId()) return;
          if (pass < step.repeat) {
            if (!(await Speech.waitMs(jpRepeatGapMs, sessionId))) return;
          }
        }

        state.jpRepeatPass = 0;
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
    if (state.remainingSec <= 0) {
      state.remainingSec = state.settings.durationMin * 60;
    }

    if (isBgAudioMode()) {
      Speech.cancel(true);
      // MUST unlock persistent <audio> synchronously inside user click gesture!
      BgAudio.unlockSync();
      const bgSid = BgAudio.nextSession();
      state.isPlaying = true;
      startTimer();
      renderRecite();
      runReciteBgAudioLoop(bgSid);
    } else {
      if (BgAudio) BgAudio.stop(false);
      Speech.wakeAudioRoute();
      const sessionId = Speech.cancel();
      state.isPlaying = true;
      startTimer();
      renderRecite();
      runReciteSystemLoop(sessionId, true);
    }
  }

  function stopRecite(resetLang = true) {
    stopTimer();
    state.isPlaying = false;
    state.isBuffering = false;
    Speech.cancel(true);
    if (BgAudio) BgAudio.stop(true);
    if (resetLang) state.activeLang = null;
    state.jpRepeatPass = 0;
    renderRecite();
  }

  function stepRecite(dir) {
    const scoped = getScopedWords();
    if (!scoped.length) return;
    const wasPlaying = state.isPlaying;
    Speech.cancel(true);
    if (BgAudio) BgAudio.stop(false);
    state.playPos = (state.playPos + dir + state.playOrder.length) % state.playOrder.length;
    state.activeLang = null;
    state.jpRepeatPass = 0;
    state.isBuffering = false;
    renderRecite();
    if (wasPlaying) {
      if (isBgAudioMode()) {
        BgAudio.unlockSync();
        const bgSid = BgAudio.nextSession();
        runReciteBgAudioLoop(bgSid);
      } else {
        Speech.wakeAudioRoute();
        const sid = Speech.getSessionId();
        runReciteSystemLoop(sid, true);
      }
    }
  }

  // Register lock-screen / AirPods / Control Center media controls
  if (BgAudio) {
    BgAudio.setMediaHandlers({
      onPlay: () => {
        if (!state.isPlaying) startRecite();
      },
      onPause: () => {
        if (state.isPlaying) stopRecite(false);
      },
      onPrev: () => stepRecite(-1),
      onNext: () => stepRecite(1)
    });
  }

  // ---------- Unified Single Speak (Study / Lexicon) ----------
  async function speakPhraseWithActiveEngine(text, langCode, kanaHint = '') {
    if (isBgAudioMode()) {
      try {
        const ok = await BgAudio.speakSingle(text, langCode, {
          ...getBgAudioOpts(),
          kanaHint
        });
        refreshAudioCacheLabel();
        if (ok) return true;
      } catch {
        // Silently fallback to system speech if network unavailable in study mode
      }
    }
    return await Speech.speak(text, langCode, {
      rate: state.settings.rate,
      syncStart: true,
      preferredVoiceName: state.settings.jpVoice || '',
      kanaHint,
      onNotice: (m) => showToast(m, 3200)
    });
  }

  // ---------- Study Speech ----------
  async function studySpeakOne(lang) {
    const word = getCurrentStudyWord();
    if (!word) return;
    const map = {
      jp: { text: word.jp, kana: word.kana || '', code: 'ja-JP' },
      zh: { text: word.zh, kana: '', code: 'zh-CN' },
      en: { text: word.en, kana: '', code: 'en-US' }
    };
    const item = map[lang];
    if (!item || (!(item.text && item.text.trim()) && !(item.kana && item.kana.trim()))) {
      showToast('该语言字段为空，可点右上角编辑补充');
      return;
    }
    if (state.isPlaying) stopRecite(true);
    if (isBgAudioMode()) BgAudio.unlockSync();
    else Speech.wakeAudioRoute();
    const sid = Speech.cancel();
    setStudyHighlight(lang);
    await speakPhraseWithActiveEngine(item.text, item.code, lang === 'jp' ? item.kana : '');
    if (sid === Speech.getSessionId()) setStudyHighlight(null);
  }

  async function studySpeakAll() {
    const word = getCurrentStudyWord();
    if (!word) return;
    if (state.isPlaying) stopRecite(true);
    if (isBgAudioMode()) BgAudio.unlockSync();
    else Speech.wakeAudioRoute();
    const sid = Speech.cancel();

    const steps = [
      { lang: 'jp', text: word.jp, kana: word.kana || '', code: 'ja-JP' },
      { lang: 'zh', text: word.zh, kana: '', code: 'zh-CN' },
      { lang: 'en', text: word.en, kana: '', code: 'en-US' }
    ].filter((s) => (s.text && s.text.trim()) || (s.kana && s.kana.trim()));

    for (let i = 0; i < steps.length; i++) {
      if (sid !== Speech.getSessionId()) return;
      setStudyHighlight(steps[i].lang);
      await speakPhraseWithActiveEngine(steps[i].text, steps[i].code, steps[i].lang === 'jp' ? steps[i].kana : '');
      if (sid !== Speech.getSessionId()) return;
      await Speech.waitMs(360, sid);
    }
    if (sid === Speech.getSessionId()) setStudyHighlight(null);
  }

  async function lexiconSpeakJp(wordId) {
    const word = state.words.find((w) => Number(w.id) === Number(wordId));
    if (!word || (!(word.jp && word.jp.trim()) && !(word.kana && word.kana.trim()))) return;
    if (state.isPlaying) stopRecite(true);
    if (isBgAudioMode()) BgAudio.unlockSync();
    else Speech.wakeAudioRoute();
    const sid = Speech.cancel();
    state.lexiconSpeakingId = word.id;
    renderLexicon();
    await speakPhraseWithActiveEngine(word.jp, 'ja-JP', word.kana || '');
    if (sid === Speech.getSessionId()) {
      state.lexiconSpeakingId = null;
      renderLexicon();
    }
  }

  async function testVoiceDiagnostic() {
    if (state.isPlaying) stopRecite(true);
    if (isBgAudioMode()) {
      BgAudio.unlockSync();
      showToast('正在测试云端锁屏音频通道（日 / 中 / 英）…', 2400);
      try {
        const opts = getBgAudioOpts();
        const jpClip = await BgAudio.fetchClip('こんにちは、しやかく', 'ja-JP', opts);
        if (!(await BgAudio.speakSingle('こんにちは、しやかく', 'ja-JP', opts))) return;
        if (!(await BgAudio.speakSingle('视角', 'zh-CN', opts))) return;
        if (!(await BgAudio.speakSingle('View Angles', 'en-US', opts))) return;
        refreshAudioCacheLabel();
        showToast(`✅ 锁屏音频自检通过（音源：${jpClip.provider || '云端'}），锁屏后也可连播`, 3800);
      } catch (err) {
        showToast('❌ 云端音频测试失败：' + err.message, 4500);
      }
      return;
    }

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

  // ---------- Wake Lock & Visibility Sync ----------
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
    if (document.visibilityState === 'visible') {
      if (state.isPlaying) {
        syncRemainingFromClock();
        renderRecite();
      }
      if (state.wakeLockWanted && !state.wakeLock && 'wakeLock' in navigator) {
        try {
          state.wakeLock = await navigator.wakeLock.request('screen');
          renderRecite();
        } catch {}
      }
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

    // Engine & Cloud TTS Settings
    document.querySelectorAll('[data-engine]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const eng = btn.dataset.engine;
        if (state.settings.audioEngine === eng) return;
        if (state.isPlaying) stopRecite(true);
        syncSettingsPatch({ audioEngine: eng });
        renderRecite();
        showToast(eng === 'bg_audio' ? '已切换为锁屏音频模式（支持后台与锁屏连播）' : '已切换为系统离线语音模式');
      });
    });

    document.querySelectorAll('[data-tts-provider]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prov = btn.dataset.ttsProvider;
        if (state.settings.ttsProvider === prov) return;
        if (BgAudio) BgAudio.clearTrackCache();
        syncSettingsPatch({ ttsProvider: prov });
        renderRecite();
        showToast(prov === 'azure' ? '已切换为微软 Azure 语音，请填写并保存 Key' : '已切换为免费内置音源（免配置）');
      });
    });

    const saveAzureBtn = $('save-azure-btn');
    if (saveAzureBtn) {
      saveAzureBtn.addEventListener('click', () => {
        const azureRegion = ($('azure-region-input').value || 'eastasia').trim();
        const azureKey = ($('azure-key-input').value || '').trim();
        const azureJpVoice = ($('azure-jp-voice-select').value || 'ja-JP-NanamiNeural').trim();
        if (BgAudio) BgAudio.clearTrackCache();
        syncSettingsPatch({ azureRegion, azureKey, azureJpVoice, ttsProvider: 'azure' });
        renderRecite();
        showToast(azureKey ? 'Azure 语音配置已保存，可点下方「测试发声」验证' : '已清空 Azure Key（将自动回退免费音源）');
      });
    }

    const azureVoiceSel = $('azure-jp-voice-select');
    if (azureVoiceSel) {
      azureVoiceSel.addEventListener('change', () => {
        if (BgAudio) BgAudio.clearTrackCache();
        syncSettingsPatch({ azureJpVoice: azureVoiceSel.value });
        showToast(`Azure 日语人声已切换为 ${azureVoiceSel.value}`);
      });
    }

    const clearCacheBtn = $('clear-cache-btn');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', async () => {
        if (!BgAudio) return;
        await BgAudio.clearCache();
        await refreshAudioCacheLabel();
        showToast('已清空本机音频缓存');
      });
    }

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
          if (BgAudio) BgAudio.clearTrackCache();
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
      if (BgAudio && !state.isPlaying) BgAudio.stop(false);
      setStudyHighlight(null);
      state.studyIndex = (state.studyIndex - 1 + scoped.length) % scoped.length;
      renderStudy();
    });

    $('study-next-btn').addEventListener('click', () => {
      const scoped = getScopedWords();
      if (!scoped.length) return;
      Speech.cancel(true);
      if (BgAudio && !state.isPlaying) BgAudio.stop(false);
      setStudyHighlight(null);
      state.studyIndex = (state.studyIndex + 1) % scoped.length;
      renderStudy();
    });

    $('study-shuffle-btn').addEventListener('click', () => {
      const scoped = getScopedWords();
      if (scoped.length < 2) return;
      Speech.cancel(true);
      if (BgAudio && !state.isPlaying) BgAudio.stop(false);
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
          if (BgAudio && !state.isPlaying) BgAudio.stop(false);
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
        if (state.isPlaying) {
          state.timerEndTs = Date.now() + state.remainingSec * 1000;
        }
        syncSettingsPatch({ durationMin: min });
        renderRecite();
        showToast(`定时已设为 ${min === 60 ? '1 小时' : min + ' 分钟'}`);
      });
    });

    document.querySelectorAll('#rate-chips .chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rate = Number(btn.dataset.rate);
        syncSettingsPatch({ rate });
        if (BgAudio) {
          BgAudio.setPlaybackRate(rate);
          BgAudio.clearTrackCache();
        }
        renderRecite();
        showToast(`语速已调整为 ${rate}x`);
      });
    });

    document.querySelectorAll('#pause-chips .chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = Number(btn.dataset.pause);
        syncSettingsPatch({ langPauseSec: sec });
        if (BgAudio) BgAudio.clearTrackCache();
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
      if (state.isPlaying) {
        state.timerEndTs = Date.now() + state.remainingSec * 1000;
      }
      renderRecite();
      showToast('倒计时已重置');
    });

    // Lexicon search & item actions
    $('lexicon-search').addEventListener('input', renderLexicon);

    $('word-list').addEventListener('click', async (e) => {
      const speakJpBtn = e.target.closest('[data-speak-jp-id]');
      if (speakJpBtn) {
        e.stopPropagation();
        lexiconSpeakJp(Number(speakJpBtn.dataset.speakJpId));
        return;
      }

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

    // Tap JP card in Recite mode when paused to pronounce via kana
    $('recite-row-jp').addEventListener('click', async () => {
      if (state.isPlaying) return;
      const word = getCurrentReciteWord();
      if (!word || (!(word.jp && word.jp.trim()) && !(word.kana && word.kana.trim()))) return;
      if (isBgAudioMode()) BgAudio.unlockSync();
      else Speech.wakeAudioRoute();
      const sid = Speech.cancel();
      state.activeLang = 'jp';
      renderRecite();
      await speakPhraseWithActiveEngine(word.jp, 'ja-JP', word.kana || '');
      if (sid === Speech.getSessionId()) {
        state.activeLang = null;
        renderRecite();
      }
    });

    // ---------- Excel Import Modal ----------
    function splitInlineJpKanaOptional(jpRaw) {
      const jp = String(jpRaw || '').trim();
      if (!jp) return ['', ''];
      const KANA_RE = /^[ぁ-んァ-ヶー・\s⓪①②③④⑤⑥⑦⑧⑨〇]+$/;
      const lines = jp.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 2 && KANA_RE.test(lines[1]) && !KANA_RE.test(lines[0])) {
        return [lines[0], lines[1]];
      }
      const m = jp.match(/^([^（()）\/・、\n]+?)（([ぁ-んァ-ヶー・〇⓪①②③④⑤⑥⑦⑧⑨]+)）$/);
      if (m) return [m[1].trim(), m[2].trim()];
      return [jp, ''];
    }

    function getSelectedExcelItems() {
      const ex = state.excel;
      if (!ex.sheets.length) return [];

      const sheetIndexes = ex.selectedSheet === '__ALL__'
        ? ex.sheets.map((_, idx) => idx)
        : [Math.max(0, Math.min(ex.sheets.length - 1, Number(ex.selectedSheet) || 0))];

      const allItems = [];
      for (const sIdx of sheetIndexes) {
        const sheet = ex.sheets[sIdx];
        if (!sheet) continue;
        const catOverride = ($('excel-category-input').value || '').trim();
        const defaultCat = ex.selectedSheet === '__ALL__'
          ? (sheet.name || catOverride || 'Excel导入')
          : (catOverride || sheet.name || 'Excel导入');

        let useHasHeader = ex.hasHeader;
        let useHeaderIdx = ex.headerRowIndex;
        let useColMap = ex.colMap;

        if (ex.selectedSheet === '__ALL__' && sIdx !== 0) {
          const detected = Excel.detectColumns(sheet.rows);
          useHasHeader = detected.hasHeader;
          useHeaderIdx = detected.headerRowIndex;
          useColMap = detected.colMap;
        }

        const built = Excel.buildItemsFromRows(sheet.rows, {
          hasHeader: useHasHeader,
          headerRowIndex: useHeaderIdx,
          colMap: useColMap,
          defaultCategory: defaultCat,
          strictRaw: ex.strictRaw
        });

        for (const item of built) {
          if (!ex.strictRaw && !item.kana && item.jp) {
            const [cleanJp, extractedKana] = splitInlineJpKanaOptional(item.jp);
            item.jp = cleanJp;
            item.kana = extractedKana;
          }
          allItems.push(item);
        }
      }
      return allItems;
    }

    function populateExcelColSelects(headers, colMap) {
      const fields = [
        { id: 'map-jp', key: 'jp', noneLabel: '（不导入）' },
        { id: 'map-kana', key: 'kana', noneLabel: '（无单独假名列）' },
        { id: 'map-zh', key: 'zh', noneLabel: '（不导入）' },
        { id: 'map-en', key: 'en', noneLabel: '（不导入）' },
        { id: 'map-note', key: 'note', noneLabel: '（无备注列）' },
        { id: 'map-cat', key: 'category', noneLabel: '（使用上方默认分类）' }
      ];

      fields.forEach((f) => {
        const sel = $(f.id);
        if (!sel) return;
        let opts = `<option value="-1">${f.noneLabel}</option>`;
        headers.forEach((h) => {
          opts += `<option value="${h.index}">${escapeHtml(h.label)}</option>`;
        });
        sel.innerHTML = opts;
        const val = colMap[f.key] !== undefined ? colMap[f.key] : -1;
        sel.value = String(val);
      });
    }

    function renderExcelPreview() {
      const items = getSelectedExcelItems();
      const summaryEl = $('excel-summary-bar');
      const tbody = $('excel-preview-tbody');
      const confirmBtn = $('confirm-excel-btn');

      summaryEl.textContent = `共解析出 ${items.length} 条有效词条（预览前 ${Math.min(5, items.length)} 条，将严格按此显示到界面）：`;
      confirmBtn.textContent = state.excel.mode === 'replace'
        ? `清空旧词库并严格导入 ${items.length} 条`
        : `确认追加合并 ${items.length} 条词条`;
      confirmBtn.disabled = items.length === 0;

      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary);">当前列映射下没有可导入的数据，请调整上方列选择</td></tr>';
        return;
      }

      tbody.innerHTML = items
        .slice(0, 5)
        .map(
          (w) => `
          <tr>
            <td>${escapeHtml(w.jp || '—')}</td>
            <td>${escapeHtml(w.kana || '—')}</td>
            <td>${escapeHtml(w.zh || '—')}</td>
            <td>${escapeHtml(w.en || '—')}</td>
          </tr>
        `
        )
        .join('');
    }

    function applyExcelSheetSelection() {
      const ex = state.excel;
      if (!ex.sheets.length) return;
      const idx = ex.selectedSheet === '__ALL__' ? 0 : Math.max(0, Math.min(ex.sheets.length - 1, Number(ex.selectedSheet) || 0));
      const sheet = ex.sheets[idx];
      const detected = Excel.detectColumns(sheet.rows);
      ex.hasHeader = detected.hasHeader;
      ex.headerRowIndex = detected.headerRowIndex;
      ex.colMap = { ...detected.colMap };

      $('excel-has-header').checked = ex.hasHeader;
      $('excel-strict-raw').checked = ex.strictRaw;
      $('excel-category-input').value = ex.selectedSheet === '__ALL__'
        ? ''
        : (sheet.name || ex.fileName.replace(/\.[^.]+$/, '') || 'Excel导入');

      populateExcelColSelects(detected.headers, ex.colMap);
      renderExcelPreview();
    }

    function openExcelSheet() {
      $('excel-sheet').classList.add('open');
    }

    function closeExcelSheet() {
      $('excel-sheet').classList.remove('open');
    }

    $('open-excel-btn').addEventListener('click', openExcelSheet);
    $('close-excel-sheet').addEventListener('click', closeExcelSheet);
    $('excel-sheet').addEventListener('click', (e) => {
      if (e.target === $('excel-sheet')) closeExcelSheet();
    });

    $('excel-dropzone').addEventListener('click', () => $('excel-file-input').click());

    $('excel-file-input').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      $('excel-file-label').textContent = `正在解析：${file.name}…`;
      try {
        const parsed = await Excel.parseFile(file);
        state.excel.fileName = file.name;
        state.excel.sheets = parsed.sheets;
        state.excel.selectedSheet = '0';
        state.excel.strictRaw = true;

        $('excel-file-label').textContent = `已加载：${file.name}（${parsed.sheets.length} 个工作表，点击可重选）`;

        const sheetSel = $('excel-sheet-select');
        let sheetOpts = '';
        if (parsed.sheets.length > 1) {
          const totalRows = parsed.sheets.reduce((acc, s) => acc + s.rows.length, 0);
          sheetOpts += `<option value="__ALL__">全部工作表（共 ${parsed.sheets.length} 个，约 ${totalRows} 行）</option>`;
        }
        parsed.sheets.forEach((s, i) => {
          sheetOpts += `<option value="${i}">${escapeHtml(s.name)}（${s.rows.length} 行）</option>`;
        });
        sheetSel.innerHTML = sheetOpts;
        sheetSel.value = '0';

        $('excel-config-area').classList.add('show');
        applyExcelSheetSelection();
      } catch (err) {
        $('excel-file-label').textContent = '点击选择 Excel 文档（.xlsx / .xls / .csv）';
        $('excel-config-area').classList.remove('show');
        showToast('解析失败：' + err.message, 4200);
      }
      e.target.value = '';
    });

    $('excel-sheet-select').addEventListener('change', (e) => {
      state.excel.selectedSheet = e.target.value;
      applyExcelSheetSelection();
    });

    document.querySelectorAll('[data-excel-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.excel.mode = btn.dataset.excelMode;
        document.querySelectorAll('[data-excel-mode]').forEach((b) => {
          b.classList.toggle('active', b.dataset.excelMode === state.excel.mode);
        });
        renderExcelPreview();
      });
    });

    [
      { id: 'map-jp', key: 'jp' },
      { id: 'map-kana', key: 'kana' },
      { id: 'map-zh', key: 'zh' },
      { id: 'map-en', key: 'en' },
      { id: 'map-note', key: 'note' },
      { id: 'map-cat', key: 'category' }
    ].forEach((f) => {
      $(f.id).addEventListener('change', (e) => {
        state.excel.colMap[f.key] = Number(e.target.value);
        renderExcelPreview();
      });
    });

    $('excel-has-header').addEventListener('change', (e) => {
      state.excel.hasHeader = e.target.checked;
      renderExcelPreview();
    });

    $('excel-strict-raw').addEventListener('change', (e) => {
      state.excel.strictRaw = e.target.checked;
      renderExcelPreview();
    });

    $('excel-category-input').addEventListener('input', renderExcelPreview);

    $('confirm-excel-btn').addEventListener('click', async () => {
      const items = getSelectedExcelItems();
      if (!items.length) {
        showToast('没有可导入的有效词条');
        return;
      }
      const isReplace = state.excel.mode === 'replace';
      if (isReplace && !confirm(`确定清空现有词库，并严格按此 Excel 文档导入 ${items.length} 条词条吗？`)) {
        return;
      }
      const btn = $('confirm-excel-btn');
      btn.disabled = true;
      btn.textContent = '正在写入词库…';
      try {
        const res = await API.importRows(items, isReplace);
        state.words = res.words;
        state.categories = res.categories;
        state.selectedCategory = '全部';
        state.studyIndex = 0;
        if (BgAudio) BgAudio.clearTrackCache();
        rebuildPlayOrder(true);
        closeExcelSheet();
        renderAll();
        showToast(
          isReplace
            ? `已严格按 Excel 替换词库，共 ${res.stats.added} 条`
            : `Excel 导入完成：新增 ${res.stats.added} 条，更新 ${res.stats.updated} 条，跳过重复 ${res.stats.skipped} 条`,
          3800
        );
      } catch (err) {
        showToast('导入失败：' + err.message, 4000);
      } finally {
        btn.disabled = false;
        renderExcelPreview();
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
          if (BgAudio) BgAudio.clearTrackCache();
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
      refreshAudioCacheLabel();
    } catch (err) {
      $('header-subtitle').textContent = '数据库连接失败';
      showToast('无法连接后端数据库 API：' + err.message, 4500);
    }
  }

  boot();
})();
