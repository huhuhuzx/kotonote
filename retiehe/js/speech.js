window.KotoSpeech = (() => {
  'use strict';

  const isIOS = /iP(hone|ad|od)/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const KANA_ONLY_RE = /^[ぁ-んァ-ヶー・\s⓪①②③④⑤⑥⑦⑧⑨〇]+$/;

  let voices = [];
  let sessionId = 0;
  let currentUtterance = null;
  let watchdog = null;
  let audioCtx = null;
  const voiceChangeListeners = [];

  function loadVoices() {
    if (!('speechSynthesis' in window)) return [];
    const list = window.speechSynthesis.getVoices();
    if (list && list.length) {
      voices = list;
    }
    return voices;
  }

  function notifyVoicesChanged() {
    loadVoices();
    voiceChangeListeners.forEach((fn) => {
      try { fn(voices); } catch {}
    });
  }

  if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = notifyVoicesChanged;
    setTimeout(notifyVoicesChanged, 400);
    setTimeout(notifyVoicesChanged, 1200);
  }

  function onVoicesChange(fn) {
    if (typeof fn === 'function') voiceChangeListeners.push(fn);
  }

  function wakeAudioRoute() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtx) audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      const buf = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtx.destination);
      src.start(0);
    } catch {}
  }

  function stripPitchAccents(s) {
    return String(s || '').replace(/[⓪①②③④⑤⑥⑦⑧⑨〇]/g, '');
  }

  function resolveJapaneseSpeechText(jpRaw, kanaRaw = '') {
    const kana = stripPitchAccents(kanaRaw).trim();
    const jp = stripPitchAccents(jpRaw).trim();

    if (kana) {
      return kana
        .replace(/[\/・、\n]+/g, '、 ')
        .replace(/[~～]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (!jp) return '';

    const lines = jp.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 2 && KANA_ONLY_RE.test(lines[1]) && !KANA_ONLY_RE.test(lines[0])) {
      return lines[1]
        .replace(/[\/・、]+/g, '、 ')
        .replace(/[~～]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const wsParts = jp.split(/[\s　]+/).filter(Boolean);
    if (wsParts.length === 2 && KANA_ONLY_RE.test(wsParts[0]) && !KANA_ONLY_RE.test(wsParts[1])) {
      return wsParts[0].replace(/[~～]/g, '').trim();
    }

    const segments = jp.split(/[\/・、\n]+/);
    const out = [];
    for (let seg of segments) {
      seg = seg.trim();
      if (!seg) continue;

      seg = seg.replace(/[（(][^）)]*[；;][^）)]*[）)]/g, '');

      seg = seg.replace(/([^（()）]+?)[（(]([ぁ-んァ-ヶー・\s]+)[）)]/g, (_, prefix, readingRaw) => {
        const reading = readingRaw.trim();
        const kataRuns = reading.match(/[ァ-ヶー]+/g);
        if (kataRuns && kataRuns.some((k) => prefix.includes(k))) {
          return reading;
        }
        const kanjiTail = prefix.match(/[一-龥々][一-龥々ぁ-ん]*$/);
        if (kanjiTail) {
          return prefix.slice(0, kanjiTail.index) + reading;
        }
        return reading;
      });

      const sp = seg.split(/[\s　]+/).filter(Boolean);
      if (sp.length === 2 && KANA_ONLY_RE.test(sp[0]) && !KANA_ONLY_RE.test(sp[1])) {
        seg = sp[0];
      } else {
        const cm = seg.match(/^([ぁ-んー]+)([一-龥々]+)$/);
        if (cm) seg = cm[1];
      }

      seg = seg.replace(/[~～]/g, '').replace(/\s+/g, ' ').trim();
      if (seg && (!out.length || out[out.length - 1] !== seg)) {
        out.push(seg);
      }
    }

    return out.join('、 ');
  }

  function cleanForSpeech(text, langCode, kanaHint = '') {
    if (langCode.startsWith('ja')) {
      return resolveJapaneseSpeechText(text, kanaHint);
    }
    let s = stripPitchAccents(text).trim();
    if (!s) return '';
    if (langCode.startsWith('zh')) {
      s = s.replace(/[\/；;\n]+/g, '，');
    } else {
      s = s.replace(/[\/；;\n]+/g, ', ').replace(/[~～]/g, '');
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  function scoreVoice(v, langCode) {
    const name = (v.name || '').toLowerCase();
    const uri = (v.voiceURI || '').toLowerCase();
    const lang = (v.lang || '').toLowerCase();
    const target = langCode.toLowerCase();
    const isJa = target.startsWith('ja');

    let score = 0;
    if (lang === target) score += 25;
    else if (lang.startsWith(target.slice(0, 2))) score += 10;

    if (/premium/i.test(name) || /premium/i.test(uri)) score += 120;
    if (/enhanced|优化|高品質|高音質/i.test(name) || /enhanced/i.test(uri)) score += 110;
    if (/natural|neural|wavenet|online/i.test(name)) score += 115;
    if (/google\s*日本語|google.*japanese/i.test(name)) score += 105;

    if (isJa) {
      if (/nanami|keita/i.test(name)) score += 65;
      if (/hattori|o-?ren/i.test(name)) score += 55;
      if (/kyoko|otoya/i.test(name)) score += 40;
      if (/shiori|daichi|mayu|naoki|aoi/i.test(name)) score += 50;
      if (/haruka|ayumi|ichiro|sayaka|espeak|festival|compact/i.test(name)) score -= 45;
    } else if (target.startsWith('zh')) {
      if (/xiaoxiao|yunxi|ting-?ting|tingting|meijia|sinji|google/i.test(name)) score += 45;
    } else {
      if (/aria|jenny|guy|samantha|daniel|karen|alex|google/i.test(name)) score += 45;
    }

    if (isIOS && /\bsiri\b/i.test(name)) {
      score -= 200;
    }
    if (isIOS && v.localService) {
      score += 12;
    }
    return score;
  }

  function isNaturalVoice(v) {
    const s = ((v.name || '') + ' ' + (v.voiceURI || '')).toLowerCase();
    return /premium|enhanced|natural|neural|online|nanami|keita|hattori|o-?ren|google|优化|高音質/.test(s);
  }

  function getJapaneseVoices() {
    if (!voices.length) loadVoices();
    const jaList = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('ja'));
    return jaList
      .map((v) => ({
        voice: v,
        name: v.name,
        lang: v.lang,
        localService: Boolean(v.localService),
        natural: isNaturalVoice(v),
        score: scoreVoice(v, 'ja-JP')
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  function pickSafeVoice(langCode, preferredVoiceName = '') {
    if (!voices.length) loadVoices();
    if (!voices.length) return null;

    if (preferredVoiceName) {
      const exactNamed = voices.find((v) => v.name === preferredVoiceName);
      if (exactNamed) return exactNamed;
    }

    const shortLang = langCode.toLowerCase().slice(0, 2);
    const matching = voices.filter((v) => (v.lang || '').toLowerCase().startsWith(shortLang));
    if (!matching.length) return null;

    const ranked = [...matching].sort((a, b) => scoreVoice(b, langCode) - scoreVoice(a, langCode));
    return ranked[0];
  }

  function cancel(force = false) {
    sessionId += 1;
    clearTimeout(watchdog);
    watchdog = null;
    currentUtterance = null;
    if ('speechSynthesis' in window) {
      try {
        if (force || window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
        }
      } catch {}
    }
    return sessionId;
  }

  function getSessionId() {
    return sessionId;
  }

  function waitMs(ms, expectedSession) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(expectedSession === sessionId), ms);
    });
  }

  function speak(text, langCode, { rate = 1.0, syncStart = false, preferredVoiceName = '', kanaHint = '', onNotice = null } = {}) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        if (onNotice) onNotice('当前浏览器不支持语音合成，请改用 Safari');
        resolve(false);
        return;
      }

      const spoken = cleanForSpeech(text, langCode, kanaHint);
      if (!spoken) {
        resolve(true);
        return;
      }

      const mySession = sessionId;
      let settled = false;
      let retried = false;

      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        watchdog = null;
        resolve(ok);
      };

      const dispatch = (useExplicitVoice) => {
        if (mySession !== sessionId) {
          finish(false);
          return;
        }
        const utt = new SpeechSynthesisUtterance(spoken);
        utt.lang = langCode;
        const effectiveRate = langCode.startsWith('ja')
          ? Math.max(0.72, Math.min(1.25, Number(rate || 1.0) * 0.94))
          : Number(rate || 1.0);
        utt.rate = effectiveRate;
        utt.volume = 1;
        utt.pitch = 1.0;

        if (useExplicitVoice) {
          const v = pickSafeVoice(langCode, langCode.startsWith('ja') ? preferredVoiceName : '');
          if (v) utt.voice = v;
        }

        utt.onend = () => finish(true);
        utt.onerror = (ev) => {
          const err = ev && ev.error ? ev.error : '';
          if (err === 'canceled' || err === 'interrupted') {
            finish(false);
            return;
          }
          if (useExplicitVoice && !retried && mySession === sessionId) {
            retried = true;
            dispatch(false);
            return;
          }
          if (err === 'not-allowed' && onNotice) {
            onNotice('浏览器拦截了朗读，请再次点击播放按钮');
          }
          finish(true);
        };

        const estMs = Math.max(4800, Math.min(22000, (spoken.length * 440) / Math.max(0.6, effectiveRate) + 4200));
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (mySession === sessionId) {
            try { window.speechSynthesis.cancel(); } catch {}
            finish(true);
          }
        }, estMs);

        currentUtterance = utt;
        try {
          if (window.speechSynthesis.paused) window.speechSynthesis.resume();
          window.speechSynthesis.speak(utt);
        } catch {
          finish(false);
        }
      };

      if (syncStart) {
        dispatch(true);
      } else {
        setTimeout(() => dispatch(true), 60);
      }
    });
  }

  return {
    loadVoices,
    onVoicesChange,
    wakeAudioRoute,
    getJapaneseVoices,
    pickSafeVoice,
    resolveJapaneseSpeechText,
    cleanForSpeech,
    cancel,
    getSessionId,
    waitMs,
    speak
  };
})();
