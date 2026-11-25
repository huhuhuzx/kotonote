window.KotoBgAudio = (() => {
  'use strict';

  const TARGET_SR = 22050;
  const JP_REPEAT_GAP_SEC = 0.85;
  const CACHE_DB_NAME = 'kotonote_audio_cache_v1';
  const CACHE_STORE = 'tts_clips';
  const MAX_CACHE_CLIPS = 1200;
  const MAX_TRACK_CACHE = 4;

  // Single persistent <audio> element reused across the entire session (critical for iOS lock-screen playback)
  const player = document.createElement('audio');
  player.setAttribute('playsinline', '');
  player.setAttribute('webkit-playsinline', '');
  player.preload = 'auto';

  let audioCtx = null;
  let cacheDbPromise = null;
  const memClipCache = new Map();
  const inFlightClips = new Map();
  const trackCache = new Map();
  let activeTrackUrl = '';
  let sessionId = 0;
  let artworkDataUrl = null;

  // ---------- Utility: Tiny Silent WAV for Immediate iOS Gesture Unlock ----------
  function encodeWavMono16(floatSamples, sampleRate) {
    const numSamples = floatSamples.length;
    const byteLength = 44 + numSamples * 2;
    const buffer = new ArrayBuffer(byteLength);
    const view = new DataView(buffer);

    function writeAscii(offset, str) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // Bits per sample
    writeAscii(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      let s = floatSamples[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  const SILENT_WAV_URL = URL.createObjectURL(encodeWavMono16(new Float32Array(4000), 8000));

  function getAudioContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    return audioCtx;
  }

  /**
   * MUST be called synchronously inside the user's click/tap handler!
   * Unlocks the persistent <audio> element and starts silent keepalive so iOS Safari
   * retains the background audio session while the first word's TTS clips load.
   */
  function unlockSync() {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {}

    try {
      player.onended = null;
      player.onerror = null;
      player.ontimeupdate = null;
      player.loop = true;
      player.playbackRate = 1.0;
      player.volume = 1.0;
      player.src = SILENT_WAV_URL;
      const p = player.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  }

  function nextSession() {
    sessionId += 1;
    return sessionId;
  }

  function getSessionId() {
    return sessionId;
  }

  function stop(clearMediaSession = true) {
    sessionId += 1;
    player.onended = null;
    player.onerror = null;
    player.ontimeupdate = null;
    try {
      player.pause();
      player.loop = false;
      player.currentTime = 0;
    } catch {}
    activeTrackUrl = '';
    if (clearMediaSession && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'paused';
      } catch {}
    }
    return sessionId;
  }

  function setPlaybackRate(rate) {
    const r = Math.max(0.6, Math.min(1.6, Number(rate) || 1.0));
    try {
      player.playbackRate = r;
    } catch {}
  }

  // ---------- IndexedDB Persistent TTS Clip Cache ----------
  function openCacheDb() {
    if (cacheDbPromise) return cacheDbPromise;
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    cacheDbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(CACHE_DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(CACHE_STORE)) {
            db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return cacheDbPromise;
  }

  async function cacheGet(key) {
    if (memClipCache.has(key)) return memClipCache.get(key);
    const db = await openCacheDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(CACHE_STORE, 'readonly');
        const req = tx.objectStore(CACHE_STORE).get(key);
        req.onsuccess = () => {
          const rec = req.result;
          if (rec && rec.bytes) {
            memClipCache.set(key, rec);
            resolve(rec);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function cachePut(key, bytes, mime, provider) {
    const rec = { key, bytes, mime: mime || 'audio/mpeg', provider: provider || '', ts: Date.now() };
    if (memClipCache.size > 160) {
      const firstKey = memClipCache.keys().next().value;
      if (firstKey) memClipCache.delete(firstKey);
    }
    memClipCache.set(key, rec);

    const db = await openCacheDb();
    if (!db) return;
    try {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      const store = tx.objectStore(CACHE_STORE);
      store.put(rec);
      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result > MAX_CACHE_CLIPS) {
          // Prune oldest ~100 clips lazily
          const allReq = store.getAll();
          allReq.onsuccess = () => {
            const list = (allReq.result || []).sort((a, b) => (a.ts || 0) - (b.ts || 0));
            const removeCount = list.length - MAX_CACHE_CLIPS + 100;
            for (let i = 0; i < removeCount && i < list.length; i++) {
              store.delete(list[i].key);
            }
          };
        }
      };
    } catch {}
  }

  async function getCacheCount() {
    const db = await openCacheDb();
    if (!db) return memClipCache.size;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(CACHE_STORE, 'readonly');
        const req = tx.objectStore(CACHE_STORE).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(memClipCache.size);
      } catch {
        resolve(memClipCache.size);
      }
    });
  }

  async function clearCache() {
    memClipCache.clear();
    clearTrackCache();
    const db = await openCacheDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.objectStore(CACHE_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  // ---------- Base64 & TTS Network Fetch ----------
  function b64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function escapeXml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async function fetchDirectAzure(text, langCode, azureKey, azureRegion, azureJpVoice) {
    const region = (azureRegion || 'eastasia').trim().toLowerCase();
    const short = langCode.toLowerCase().slice(0, 2);
    const xmlLang = short === 'ja' ? 'ja-JP' : short === 'zh' ? 'zh-CN' : 'en-US';
    const voice =
      short === 'ja'
        ? (azureJpVoice || 'ja-JP-NanamiNeural').trim()
        : short === 'zh'
        ? 'zh-CN-XiaoxiaoNeural'
        : 'en-US-JennyNeural';

    const ssml = `<speak version='1.0' xml:lang='${xmlLang}'><voice name='${escapeXml(voice)}'>${escapeXml(text)}</voice></speak>`;
    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey.trim(),
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-64kbitrate-mono-mp3'
      },
      body: ssml
    });
    if (!res.ok) {
      throw new Error(`Azure TTS 请求失败 (${res.status})`);
    }
    const bytes = await res.arrayBuffer();
    if (!bytes || bytes.byteLength < 256) {
      throw new Error('Azure TTS 返回音频为空');
    }
    return { bytes, mime: 'audio/mpeg', provider: 'azure-direct' };
  }

  function fetchViaJsonp(endpoint, payload, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const cbName = `__koto_tts_cb_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const sep = endpoint.includes('?') ? '&' : '?';
      const qs = `action=tts&text=${encodeURIComponent(payload.text || '')}&lang=${encodeURIComponent(payload.lang || 'ja-JP')}&provider=${encodeURIComponent(payload.provider || 'free')}&callback=${cbName}`;
      const script = document.createElement('script');
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        try { delete window[cbName]; } catch { window[cbName] = undefined; }
        script.remove();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('跨域语音请求超时，请确认主站已上传 v4 版 api/kotonote.py'));
      }, timeoutMs);
      window[cbName] = (data) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!data || !data.ok || !data.b64) {
          reject(new Error((data && data.detail) || 'TTS 合成失败'));
          return;
        }
        resolve({ bytes: b64ToArrayBuffer(data.b64), mime: data.mime || 'audio/mpeg', provider: data.provider || 'jsonp' });
      };
      script.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('无法连接 TTS 代理（请确认主站已升级到 v4）'));
      };
      script.src = `${endpoint}${sep}${qs}`;
      script.async = true;
      document.head.appendChild(script);
    });
  }

  async function fetchViaEndpoint(endpoint, payload) {
    const sep = endpoint.includes('?') ? '&' : '?';
    if (!payload.azureKey) {
      const qs = `action=tts&text=${encodeURIComponent(payload.text || '')}&lang=${encodeURIComponent(payload.lang || 'ja-JP')}&provider=${encodeURIComponent(payload.provider || 'free')}`;
      try {
        const res = await fetch(`${endpoint}${sep}${qs}`, { method: 'GET', mode: 'cors', cache: 'no-store' });
        const text = await res.text();
        let data = {};
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`TTS 接口返回格式异常 (${res.status})`);
        }
        if (!res.ok || !data.ok || !data.b64) {
          throw new Error(data.detail || `TTS 合成失败 (${res.status})`);
        }
        return {
          bytes: b64ToArrayBuffer(data.b64),
          mime: data.mime || 'audio/mpeg',
          provider: data.provider || 'proxy'
        };
      } catch {
        return await fetchViaJsonp(endpoint, payload);
      }
    }
    const res = await fetch(`${endpoint}${sep}action=tts`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`TTS 接口返回格式异常 (${res.status})`);
    }
    if (!res.ok || !data.ok || !data.b64) {
      throw new Error(data.detail || `TTS 合成失败 (${res.status})`);
    }
    return {
      bytes: b64ToArrayBuffer(data.b64),
      mime: data.mime || 'audio/mpeg',
      provider: data.provider || 'proxy'
    };
  }

  async function fetchClip(text, langCode, opts = {}) {
    const clean = String(text || '').trim();
    if (!clean) return null;

    const provider = (opts.ttsProvider || 'free').toLowerCase();
    const azureKey = (opts.azureKey || '').trim();
    const azureRegion = (opts.azureRegion || 'eastasia').trim();
    const azureJpVoice = (opts.azureJpVoice || 'ja-JP-NanamiNeural').trim();
    const ttsEndpoint = (opts.ttsEndpoint || '').trim();
    const providerTag =
      provider === 'azure' && azureKey
        ? `azure:${langCode.startsWith('ja') ? azureJpVoice : 'std'}`
        : 'free';

    const cacheKey = `${providerTag}|${langCode}|${clean}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    if (inFlightClips.has(cacheKey)) {
      return await inFlightClips.get(cacheKey);
    }

    const promise = (async () => {
      let result = null;
      const payload = {
        text: clean,
        lang: langCode,
        provider: provider === 'azure' && azureKey ? 'azure' : 'free',
        azureKey,
        azureRegion,
        azureJpVoice
      };

      // 1. Direct Azure option (for static HTML without backend, when user configures Azure key)
      if (opts.directAzure && provider === 'azure' && azureKey) {
        result = await fetchDirectAzure(clean, langCode, azureKey, azureRegion, azureJpVoice);
      } else if (window.KotoAPI && typeof window.KotoAPI.fetchTts === 'function' && !ttsEndpoint) {
        const data = await window.KotoAPI.fetchTts(payload);
        if (!data || !data.ok || !data.b64) {
          throw new Error((data && data.detail) || 'TTS 合成失败');
        }
        result = {
          bytes: b64ToArrayBuffer(data.b64),
          mime: data.mime || 'audio/mpeg',
          provider: data.provider || 'retiehe'
        };
      } else if (ttsEndpoint) {
        result = await fetchViaEndpoint(ttsEndpoint, payload);
      } else if (provider === 'azure' && azureKey) {
        result = await fetchDirectAzure(clean, langCode, azureKey, azureRegion, azureJpVoice);
      } else {
        throw new Error('未配置云端音频服务地址（请填写热铁盒站点或 Azure 密钥）');
      }

      await cachePut(cacheKey, result.bytes, result.mime, result.provider);
      return { key: cacheKey, ...result };
    })();

    inFlightClips.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inFlightClips.delete(cacheKey);
    }
  }

  // ---------- Audio Decoding & Whole-Word Seamless WAV Stitching ----------
  function decodeAudioCompat(ctx, arrayBuffer) {
    const copy = arrayBuffer.slice(0);
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = (buf) => {
        if (!settled) {
          settled = true;
          resolve(buf);
        }
      };
      const fail = (err) => {
        if (!settled) {
          settled = true;
          reject(err || new Error('decodeAudioData failed'));
        }
      };
      try {
        const maybePromise = ctx.decodeAudioData(copy, ok, fail);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(ok, fail);
        }
      } catch (err) {
        fail(err);
      }
    });
  }

  function resampleToMono(audioBuffer, targetSr) {
    const srcSr = audioBuffer.sampleRate;
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
    const srcLen = ch0.length;

    if (srcSr === targetSr) {
      const out = new Float32Array(srcLen);
      if (ch1) {
        for (let i = 0; i < srcLen; i++) out[i] = (ch0[i] + ch1[i]) * 0.5;
      } else {
        out.set(ch0);
      }
      return out;
    }

    const ratio = srcSr / targetSr;
    const outLen = Math.max(1, Math.round(srcLen / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const i0 = Math.min(idx, srcLen - 1);
      const i1 = Math.min(idx + 1, srcLen - 1);
      const s0 = ch1 ? (ch0[i0] + ch1[i0]) * 0.5 : ch0[i0];
      const s1 = ch1 ? (ch0[i1] + ch1[i1]) * 0.5 : ch0[i1];
      out[i] = s0 + (s1 - s0) * frac;
    }
    return out;
  }

  function trimSilenceEdges(samples, sr) {
    // Trim excessive leading/trailing dead air from TTS providers so pauses feel crisp & uniform
    const threshold = 0.008;
    const pad = Math.round(sr * 0.04);
    let start = 0;
    let end = samples.length - 1;
    while (start < samples.length && Math.abs(samples[start]) < threshold) start++;
    while (end > start && Math.abs(samples[end]) < threshold) end--;
    if (end <= start) return samples;
    start = Math.max(0, start - pad);
    end = Math.min(samples.length, end + pad);
    return samples.subarray(start, end);
  }

  function makeTrackKey(word, opts) {
    const rate = Number(opts.rate || 1.0).toFixed(2);
    const pause = Number(opts.langPauseSec || 2.5).toFixed(1);
    const prov = opts.ttsProvider === 'azure' && opts.azureKey ? `az:${opts.azureJpVoice || ''}` : 'free';
    const ep = opts.ttsEndpoint || '';
    return `${word.id}|${word.jp}|${word.kana}|${word.zh}|${word.en}|${pause}|${rate}|${prov}|${ep}`;
  }

  function clearTrackCache() {
    for (const [, track] of trackCache) {
      if (track && track.blobUrl && track.blobUrl !== activeTrackUrl) {
        try {
          URL.revokeObjectURL(track.blobUrl);
        } catch {}
      }
    }
    trackCache.clear();
  }

  function putTrackCache(key, track) {
    if (trackCache.has(key)) return;
    trackCache.set(key, track);
    while (trackCache.size > MAX_TRACK_CACHE) {
      const oldestKey = trackCache.keys().next().value;
      const oldest = trackCache.get(oldestKey);
      if (oldest && oldest.blobUrl && oldest.blobUrl === activeTrackUrl) {
        // Move active entry to end so we don't revoke the playing URL
        trackCache.delete(oldestKey);
        trackCache.set(oldestKey, oldest);
        break;
      }
      if (oldest && oldest.blobUrl) {
        try {
          URL.revokeObjectURL(oldest.blobUrl);
        } catch {}
      }
      trackCache.delete(oldestKey);
    }
  }

  async function prepareWordTrack(word, opts = {}) {
    if (!word) return null;
    const trackKey = makeTrackKey(word, opts);
    if (trackCache.has(trackKey)) {
      return trackCache.get(trackKey);
    }

    const Speech = window.KotoSpeech;
    const jpText = Speech ? Speech.resolveJapaneseSpeechText(word.jp, word.kana) : (word.kana || word.jp || '').trim();
    const zhText = Speech ? Speech.cleanForSpeech(word.zh, 'zh-CN') : (word.zh || '').trim();
    const enText = Speech ? Speech.cleanForSpeech(word.en, 'en-US') : (word.en || '').trim();

    const jobs = [];
    if (jpText) jobs.push({ lang: 'jp', code: 'ja-JP', text: jpText, repeat: 2 });
    if (zhText) jobs.push({ lang: 'zh', code: 'zh-CN', text: zhText, repeat: 1 });
    if (enText) jobs.push({ lang: 'en', code: 'en-US', text: enText, repeat: 1 });

    if (!jobs.length) return null;

    // Fetch all needed language clips in parallel (using cache when available)
    const fetched = await Promise.all(
      jobs.map(async (job) => {
        const clip = await fetchClip(job.text, job.code, opts);
        return { ...job, clip };
      })
    );

    const rate = Math.max(0.6, Math.min(1.6, Number(opts.rate || 1.0)));
    const langPauseSec = Math.max(0.8, Number(opts.langPauseSec || 2.5));
    // Scale silence samples by `rate` so wall-clock silence stays exact when playbackRate = rate
    const repeatGapSamples = Math.round(JP_REPEAT_GAP_SEC * rate * TARGET_SR);
    const langPauseSamples = Math.round(langPauseSec * rate * TARGET_SR);
    const leadInSamples = Math.round(0.08 * TARGET_SR);

    // Attempt continuous WAV stitching (best for iOS Safari lock-screen zero-gap playback)
    const ctx = getAudioContext();
    if (ctx) {
      try {
        const decodedList = [];
        for (const item of fetched) {
          const ab = await decodeAudioCompat(ctx, item.clip.bytes);
          const mono = trimSilenceEdges(resampleToMono(ab, TARGET_SR), TARGET_SR);
          decodedList.push({ ...item, samples: mono });
        }

        // Compute total PCM sample length & timeline segments
        let totalSamples = leadInSamples;
        const plan = [];
        for (const item of decodedList) {
          for (let pass = 1; pass <= item.repeat; pass++) {
            const startSample = totalSamples;
            totalSamples += item.samples.length;
            const endSample = totalSamples;
            plan.push({
              lang: item.lang,
              pass: item.lang === 'jp' ? pass : 0,
              samples: item.samples,
              startSample,
              startSec: startSample / TARGET_SR,
              endSec: endSample / TARGET_SR
            });
            if (pass < item.repeat) {
              totalSamples += repeatGapSamples;
            }
          }
          totalSamples += langPauseSamples;
        }

        const merged = new Float32Array(totalSamples);
        for (const p of plan) {
          merged.set(p.samples, p.startSample);
        }

        const wavBlob = encodeWavMono16(merged, TARGET_SR);
        const blobUrl = URL.createObjectURL(wavBlob);
        const track = {
          key: trackKey,
          stitched: true,
          blobUrl,
          durationSec: totalSamples / TARGET_SR,
          segments: plan.map(({ lang, pass, startSec, endSec }) => ({ lang, pass, startSec, endSec })),
          provider: fetched[0] && fetched[0].clip ? fetched[0].clip.provider : 'cloud'
        };
        putTrackCache(trackKey, track);
        return track;
      } catch {
        // Fall through to raw sequential MP3 playback fallback
      }
    }

    // Fallback: sequential raw MP3 queue (still plays on single <audio> element)
    const rawSteps = [];
    for (const item of fetched) {
      for (let pass = 1; pass <= item.repeat; pass++) {
        rawSteps.push({
          lang: item.lang,
          pass: item.lang === 'jp' ? pass : 0,
          bytes: item.clip.bytes,
          mime: item.clip.mime || 'audio/mpeg',
          pauseAfterMs: pass < item.repeat ? Math.round(JP_REPEAT_GAP_SEC * 1000) : Math.round(langPauseSec * 1000)
        });
      }
    }
    return {
      key: trackKey,
      stitched: false,
      rawSteps,
      provider: fetched[0] && fetched[0].clip ? fetched[0].clip.provider : 'cloud'
    };
  }

  function playTrack(track, { rate = 1.0, expectedSession, onSegmentChange = null } = {}) {
    return new Promise((resolve) => {
      if (!track || expectedSession !== sessionId) {
        resolve(false);
        return;
      }

      if (track.stitched && track.blobUrl) {
        let settled = false;
        let lastSegKey = '';

        const done = (ok) => {
          if (settled) return;
          settled = true;
          player.onended = null;
          player.onerror = null;
          player.ontimeupdate = null;
          resolve(ok);
        };

        const emitSeg = () => {
          if (!onSegmentChange || expectedSession !== sessionId) return;
          const t = player.currentTime || 0;
          let matched = null;
          for (const seg of track.segments) {
            if (t >= seg.startSec - 0.04 && t <= seg.endSec + 0.15) {
              matched = seg;
              break;
            }
          }
          if (!matched && track.segments.length) {
            // During inter-language silence, keep the most recent segment highlighted
            for (let i = track.segments.length - 1; i >= 0; i--) {
              if (t >= track.segments[i].startSec) {
                matched = track.segments[i];
                break;
              }
            }
          }
          if (matched) {
            const k = `${matched.lang}:${matched.pass}`;
            if (k !== lastSegKey) {
              lastSegKey = k;
              onSegmentChange(matched.lang, matched.pass);
            }
          }
        };

        player.loop = false;
        activeTrackUrl = track.blobUrl;
        player.src = track.blobUrl;
        player.playbackRate = Math.max(0.6, Math.min(1.6, Number(rate || 1.0)));

        player.ontimeupdate = emitSeg;
        player.onended = () => done(expectedSession === sessionId);
        player.onerror = () => done(false);

        if (track.segments.length && onSegmentChange) {
          onSegmentChange(track.segments[0].lang, track.segments[0].pass);
          lastSegKey = `${track.segments[0].lang}:${track.segments[0].pass}`;
        }

        const p = player.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => done(false));
        }
        return;
      }

      // Raw sequential fallback
      (async () => {
        for (const step of track.rawSteps || []) {
          if (expectedSession !== sessionId) {
            resolve(false);
            return;
          }
          if (onSegmentChange) onSegmentChange(step.lang, step.pass);
          const ok = await playRawClip(step.bytes, step.mime, rate, expectedSession);
          if (!ok || expectedSession !== sessionId) {
            resolve(false);
            return;
          }
          if (step.pauseAfterMs > 0) {
            const still = await waitMs(step.pauseAfterMs, expectedSession);
            if (!still) {
              resolve(false);
              return;
            }
          }
        }
        resolve(expectedSession === sessionId);
      })();
    });
  }

  function playRawClip(bytes, mime, rate, expectedSession) {
    return new Promise((resolve) => {
      if (expectedSession !== sessionId) {
        resolve(false);
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/mpeg' }));
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        player.onended = null;
        player.onerror = null;
        if (activeTrackUrl === url) activeTrackUrl = '';
        try {
          URL.revokeObjectURL(url);
        } catch {}
        resolve(ok);
      };

      player.loop = false;
      activeTrackUrl = url;
      player.src = url;
      player.playbackRate = Math.max(0.6, Math.min(1.6, Number(rate || 1.0)));
      player.onended = () => done(expectedSession === sessionId);
      player.onerror = () => done(false);

      const p = player.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => done(false));
      }
    });
  }

  function waitMs(ms, expectedSession) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(expectedSession === sessionId), ms);
    });
  }

  /**
   * Speak a single phrase via cloud/cached <audio> (used in Study mode, Lexicon, and Diagnostics).
   */
  async function speakSingle(text, langCode, opts = {}) {
    const Speech = window.KotoSpeech;
    const spoken = Speech ? Speech.cleanForSpeech(text, langCode, opts.kanaHint || '') : String(text || '').trim();
    if (!spoken) return true;

    const mySession = nextSession();
    unlockSync();
    const clip = await fetchClip(spoken, langCode, opts);
    if (!clip || mySession !== sessionId) return false;
    return await playRawClip(clip.bytes, clip.mime, opts.rate || 1.0, mySession);
  }

  // ---------- Lock-Screen MediaSession Controls ----------
  function getArtworkUrl() {
    if (artworkDataUrl) return artworkDataUrl;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 512, 512);
      grad.addColorStop(0, '#5856D6');
      grad.addColorStop(1, '#007AFF');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);

      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.arc(420, 96, 150, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 260px -apple-system, "PingFang SC", "Hiragino Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('言', 256, 268);
      artworkDataUrl = canvas.toDataURL('image/png');
    } catch {
      artworkDataUrl = '';
    }
    return artworkDataUrl;
  }

  function updateMediaSession(word, isPlaying = true) {
    if (!('mediaSession' in navigator)) return;
    try {
      if (word) {
        const titleMain = word.jp || word.zh || word.en || '言笺 KotoNote';
        const title = word.kana && !titleMain.includes(word.kana) ? `${titleMain} (${word.kana})` : titleMain;
        const artist = [word.zh, word.en].filter(Boolean).join(' · ') || '中日英三语背词';
        const album = `言笺 KotoNote · ${word.category || '背词模式'}`;
        const art = getArtworkUrl();
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist,
          album,
          artwork: art ? [{ src: art, sizes: '512x512', type: 'image/png' }] : []
        });
      }
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {}
  }

  function setMediaHandlers({ onPlay, onPause, onPrev, onNext } = {}) {
    if (!('mediaSession' in navigator)) return;
    const bind = (action, fn) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn || null);
      } catch {}
    };
    bind('play', onPlay);
    bind('pause', onPause);
    bind('stop', onPause);
    bind('previoustrack', onPrev);
    bind('nexttrack', onNext);
  }

  function keepAliveSilent() {
    try {
      player.onended = null;
      player.onerror = null;
      player.ontimeupdate = null;
      player.loop = true;
      player.playbackRate = 1.0;
      player.src = SILENT_WAV_URL;
      const p = player.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  }

  function getCachedTrack(word, opts = {}) {
    if (!word) return null;
    const trackKey = makeTrackKey(word, opts);
    return trackCache.get(trackKey) || null;
  }

  return {
    unlockSync,
    keepAliveSilent,
    nextSession,
    getSessionId,
    stop,
    setPlaybackRate,
    fetchClip,
    getCachedTrack,
    prepareWordTrack,
    playTrack,
    speakSingle,
    clearTrackCache,
    getCacheCount,
    clearCache,
    updateMediaSession,
    setMediaHandlers
  };
})();
