/* global Chart */
'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  const SAMPLE = [
    "Alice: Alright everyone, let's kick off the planning meeting for the new analytics dashboard.",
    'Bob: Sounds good. Do we have the finalized designs from the UI team?',
    "Charlie: Not yet, they said they'd have them by tomorrow.",
    'Bob: I can build the API by Tuesday.',
    "Charlie: I'll draft the schema tonight and send it over for review.",
    "Bob: Actually, there's a problem. We don't have the updated user metrics.",
    'Alice: I will email the data team right after this call and get them.',
    "Alice: No problem. Let's reconvene on Wednesday.",
  ].join('\n');

  // ---------- helpers ----------
  /**
   * Creates an element with text content only (never HTML) to prevent XSS.
   * @param {string} tag
   * @param {{ className?: string, text?: string }} [opts]
   */
  function el(tag, opts = {}) {
    const node = document.createElement(tag);
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    return node;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function sentimentClass(score) {
    if (score < 40) return 'negative';
    if (score > 60) return 'positive';
    return 'neutral';
  }

  function toast(message, type) {
    const container = $('toast-container');
    const node = el('div', { className: `toast${type === 'error' ? ' error' : ''}`, text: message });
    container.appendChild(node);
    while (container.children.length > 3) container.firstElementChild.remove();
    setTimeout(() => node.remove(), 3500);
  }

  function fillList(list, items, render, emptyText) {
    list.replaceChildren();
    if (!items.length) {
      list.appendChild(el('li', { className: 'none', text: emptyText }));
      return;
    }
    items.forEach((item) => list.appendChild(render(item)));
  }

  function renderTask(item) {
    const li = el('li', { className: 'task' });
    li.appendChild(el('div', { className: 'task-title', text: item.task }));
    const meta = el('div', { className: 'task-meta' });
    meta.appendChild(el('span', { className: 'chip', text: `@${item.assignee}` }));
    meta.appendChild(el('span', { className: 'muted', text: item.deadline ? `Due: ${item.deadline}` : 'No deadline' }));
    li.appendChild(meta);
    return li;
  }

  // ---------- charts ----------
  const charts = {};
  function makeChart(canvasId) {
    if (typeof Chart === 'undefined') return null;
    const canvas = $(canvasId);
    return new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [{ label: 'Sentiment', data: [], borderWidth: 2, fill: false, tension: 0.3, pointRadius: 3 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
        scales: { y: { min: 0, max: 100 }, x: { ticks: { maxRotation: 0, autoSkip: true } } },
        plugins: { legend: { display: false } },
      },
    });
  }
  function styleChart(chart) {
    if (!chart) return;
    const text = cssVar('--muted');
    const grid = cssVar('--border');
    const line = cssVar('--primary');
    chart.data.datasets[0].borderColor = line;
    chart.data.datasets[0].pointBackgroundColor = line;
    for (const axis of ['x', 'y']) {
      chart.options.scales[axis].ticks.color = text;
      chart.options.scales[axis].grid = { color: grid };
    }
    chart.update('none');
  }
  function setChartData(chart, labels, values) {
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.update();
  }

  // ---------- theme ----------
  function currentTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function syncThemeButton() {
    const dark = currentTheme() === 'dark';
    $('theme-toggle').setAttribute('aria-pressed', String(dark));
    $('theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }
  $('theme-toggle').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('nexusmeet-theme', next);
    } catch {
      /* storage unavailable */
    }
    syncThemeButton();
    Object.values(charts).forEach(styleChart);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    syncThemeButton();
    Object.values(charts).forEach(styleChart);
  });
  syncThemeButton();

  // ---------- tabs ----------
  const tabs = [$('tab-analyze'), $('tab-live')];
  function selectTab(tab, focus) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !selected;
    });
    if (focus) tab.focus();
    Object.values(charts).forEach((c) => c && c.resize());
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        selectTab(next, true);
      }
    });
  });

  // ---------- mode ----------
  let maxChars = 60000;
  fetch('/api/config')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((cfg) => {
      const badge = $('mode-badge');
      maxChars = (cfg.limits && cfg.limits.maxTranscriptChars) || maxChars;
      updateCount();
      if (cfg.demo) {
        badge.textContent = 'Demo mode';
        badge.classList.add('demo');
        $('demo-banner').hidden = false;
      } else {
        badge.textContent = `AI: ${cfg.model}`;
        $('privacy-note').textContent =
          'The transcript is sent to the configured AI provider (Anthropic) for analysis and is not stored by this server.';
      }
    })
    .catch(() => {
      $('mode-badge').textContent = 'Server unreachable';
    });

  // ---------- analyze ----------
  const form = $('analyze-form');
  const input = $('transcript-input');
  const titleInput = $('title-input');
  const button = $('analyze-button');
  const status = $('analysis-status');
  const formError = $('form-error');
  let inFlight = false;

  function updateCount() {
    const n = input.value.length;
    $('char-count').textContent = `${n.toLocaleString()} / ${maxChars.toLocaleString()} characters`;
  }
  input.addEventListener('input', updateCount);
  updateCount();

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = !message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  $('sample-button').addEventListener('click', () => {
    input.value = SAMPLE;
    titleInput.value = 'Analytics dashboard planning';
    updateCount();
    showFormError('');
    input.focus();
  });
  $('clear-button').addEventListener('click', () => {
    input.value = '';
    titleInput.value = '';
    updateCount();
    showFormError('');
    status.textContent = '';
    $('analysis-results').hidden = true;
    $('analysis-empty').hidden = false;
    input.focus();
  });

  function renderAnalysis(result) {
    const { analysis, utterances } = result;
    $('result-provider').textContent =
      result.provider === 'demo'
        ? 'Produced by demo keyword heuristics (not an AI model).'
        : `Produced by ${result.model} (Anthropic). AI output can be wrong — review before acting on it.`;
    $('result-summary').textContent = analysis.summary;

    const s = analysis.overallSentiment;
    const score = $('result-sentiment');
    score.textContent = `${s.score}/100 · ${s.label}`;
    score.className = `sentiment-score sentiment-${sentimentClass(s.score)}`;

    fillList($('result-actions'), analysis.actionItems, renderTask, 'No action items detected.');
    fillList($('result-decisions'), analysis.decisions, (d) => el('li', { text: d }), 'No decisions detected.');
    fillList($('result-risks'), analysis.risks, (r) => el('li', { text: r }), 'No risks detected.');

    const scores = new Map(analysis.utteranceSentiment.map((e) => [e.index, e.score]));
    const list = $('result-transcript');
    list.replaceChildren();
    utterances.forEach((u, i) => {
      const value = scores.has(i) ? scores.get(i) : null;
      const li = el('li', { className: value === null ? '' : `s-${sentimentClass(value)}` });
      const head = el('div', { className: 'speaker' });
      head.appendChild(el('span', { text: u.speaker }));
      if (value !== null) head.appendChild(el('span', { className: 'muted', text: `sentiment ${value}` }));
      li.appendChild(head);
      li.appendChild(el('div', { className: 'utterance', text: u.text }));
      list.appendChild(li);
    });

    $('analysis-empty').hidden = true;
    $('analysis-results').hidden = false;
    if (!charts.analysis) {
      charts.analysis = makeChart('analysis-chart');
      styleChart(charts.analysis);
    }
    setChartData(
      charts.analysis,
      utterances.map((u, i) => `${i + 1}`),
      utterances.map((u, i) => (scores.has(i) ? scores.get(i) : null)),
    );
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (inFlight) return;
    const text = input.value.trim();
    if (!text) {
      showFormError('Paste a transcript first.');
      input.focus();
      return;
    }
    if (text.length > maxChars) {
      showFormError(`The transcript is too long (maximum ${maxChars.toLocaleString()} characters).`);
      input.focus();
      return;
    }
    showFormError('');
    inFlight = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Analyzing…';
    status.classList.remove('error');
    status.textContent = 'Analyzing the transcript. This can take up to a minute.';

    try {
      const body = { text };
      const title = titleInput.value.trim();
      if (title) body.title = title;
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          (payload && payload.error && payload.error.message) || `Request failed (HTTP ${response.status})`;
        throw new Error(message);
      }
      renderAnalysis(payload);
      status.textContent = 'Analysis complete.';
      $('analysis-results').scrollIntoView({ block: 'start' });
    } catch (err) {
      status.classList.add('error');
      status.textContent = err instanceof Error ? err.message : 'Analysis failed.';
    } finally {
      inFlight = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Analyze';
    }
  });

  // ---------- live demo ----------
  const liveStatus = $('live-status');
  const startBtn = $('live-start');
  const stopBtn = $('live-stop');
  const liveTranscript = $('live-transcript');
  const liveActions = $('live-actions');
  const participants = $('participants');
  let source = null;
  const live = { points: [] };

  function setLiveStatus(text, isLive) {
    liveStatus.textContent = text;
    liveStatus.classList.toggle('live', Boolean(isLive));
  }

  function participantTile(name) {
    const id = `p-${name.replace(/[^a-z0-9]/gi, '_')}`;
    let tile = document.getElementById(id);
    if (!tile) {
      tile = el('div', { className: 'participant' });
      tile.id = id;
      tile.appendChild(el('div', { className: 'avatar', text: name.charAt(0).toUpperCase() }));
      tile.appendChild(el('div', { text: name }));
      participants.appendChild(tile);
    }
    return tile;
  }

  function highlight(name) {
    participants.querySelectorAll('.participant').forEach((t) => t.classList.remove('speaking'));
    if (name) participantTile(name).classList.add('speaking');
  }

  function resetLive() {
    liveTranscript.replaceChildren();
    liveActions.replaceChildren();
    participants.replaceChildren();
    $('live-transcript-empty').hidden = false;
    $('live-actions-empty').hidden = false;
    live.points = [];
    if (!charts.live) {
      charts.live = makeChart('live-chart');
      styleChart(charts.live);
    }
    setChartData(charts.live, [], []);
  }

  function stopLive(text) {
    if (source) source.close();
    source = null;
    highlight(null);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setLiveStatus(text, false);
  }

  function onUtterance(data) {
    $('live-transcript-empty').hidden = true;
    participantTile(data.transcript.speaker);
    highlight(data.transcript.speaker);

    const li = el('li', { className: `s-${sentimentClass(data.sentiment)}` });
    li.dataset.timestamp = String(data.timestamp);
    const head = el('div', { className: 'speaker' });
    head.appendChild(el('span', { text: data.transcript.speaker }));
    head.appendChild(
      el('span', {
        className: 'muted',
        text: new Date(data.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      }),
    );
    li.appendChild(head);
    li.appendChild(el('div', { className: 'utterance', text: data.transcript.text }));

    // Chunks may arrive out of order; insert by spoken timestamp.
    const next = Array.from(liveTranscript.children).find((c) => Number(c.dataset.timestamp) > data.timestamp);
    liveTranscript.insertBefore(li, next || null);
    liveTranscript.scrollTop = liveTranscript.scrollHeight;

    if (data.actionItem) {
      $('live-actions-empty').hidden = true;
      liveActions.appendChild(renderTask(data.actionItem));
      toast(`New task for ${data.actionItem.assignee}`);
    }

    live.points.push({ index: data.index, score: data.sentiment });
    live.points.sort((a, b) => a.index - b.index);
    setChartData(
      charts.live,
      live.points.map((p) => `${p.index + 1}`),
      live.points.map((p) => p.score),
    );
  }

  startBtn.addEventListener('click', () => {
    if (source) return;
    resetLive();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setLiveStatus('Connecting…', false);
    source = new EventSource('/api/stream-meeting');
    source.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (data.event) {
        case 'MEETING_START':
          setLiveStatus('Live (demo)', true);
          break;
        case 'UTTERANCE':
          onUtterance(data);
          break;
        case 'END_OF_MEETING':
          stopLive('Meeting ended');
          toast('Meeting replay finished');
          break;
        case 'SERVER_SHUTDOWN':
          stopLive('Server restarting');
          break;
        case 'ERROR':
          toast('A chunk could not be analyzed', 'error');
          break;
        default:
          break;
      }
    };
    source.onerror = () => {
      // EventSource would auto-reconnect and restart the replay; stop instead.
      stopLive('Connection lost');
      toast('Connection to the live stream was lost', 'error');
    };
  });
  stopBtn.addEventListener('click', () => stopLive('Stopped'));
})();
