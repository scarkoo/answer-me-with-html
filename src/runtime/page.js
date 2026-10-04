(() => {
  const root = document.documentElement;
  const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
  const label = (btn, value) => {
    const map = JSON.parse(btn.dataset.labels || '{}');
    btn.textContent = map[value] || value;
  };
  const bind = (name, attr, values) => {
    const btn = document.querySelector(`[data-am="${name}"]`);
    if (!btn) return;
    label(btn, root.getAttribute(attr));
    btn.addEventListener('click', () => {
      const next = cycle(values, root.getAttribute(attr));
      root.setAttribute(attr, next);
      label(btn, next);
    });
  };
  bind('theme', 'data-theme', ['blueprint', 'shadcn']);
  bind('mode', 'data-mode', ['auto', 'light', 'dark']);


  document.querySelectorAll('.am-chart').forEach((chart) => {
    const legends = [...chart.querySelectorAll('[data-chart-legend]')];
    const marks = [...chart.querySelectorAll('[data-chart-mark]')];
    if (!legends.length) return;

    const setHighlight = (series) => {
      const active = series !== null;
      for (const mark of marks) {
        const same = mark.dataset.chartSeries === series;
        mark.classList.toggle('is-dimmed', active && !same && !mark.classList.contains('is-hidden'));
        mark.classList.toggle('is-highlighted', active && same);
      }
      for (const legend of legends) {
        const same = legend.dataset.chartSeries === series;
        legend.classList.toggle('is-dimmed', active && !same);
        legend.classList.toggle('is-highlighted', active && same);
      }
    };

    const toggleSeries = (legend) => {
      const series = legend.dataset.chartSeries;
      const visible = legend.getAttribute('aria-pressed') === 'true';
      const nextVisible = !visible;
      legend.setAttribute('aria-pressed', String(nextVisible));
      legend.classList.toggle('is-off', !nextVisible);
      for (const mark of marks) {
        if (mark.dataset.chartSeries === series) mark.classList.toggle('is-hidden', !nextVisible);
      }
      setHighlight(null);
    };

    for (const legend of legends) {
      legend.addEventListener('click', () => toggleSeries(legend));
      legend.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleSeries(legend);
      });
      legend.addEventListener('pointerenter', () => setHighlight(legend.dataset.chartSeries));
      legend.addEventListener('pointerleave', () => setHighlight(null));
      legend.addEventListener('focus', () => setHighlight(legend.dataset.chartSeries));
      legend.addEventListener('blur', () => setHighlight(null));
    }

    for (const mark of marks) {
      mark.addEventListener('pointerenter', () => setHighlight(mark.dataset.chartSeries));
      mark.addEventListener('pointerleave', () => setHighlight(null));
    }
  });

  const copyBtn = document.querySelector('[data-am="copy"]');
  copyBtn?.addEventListener('click', async () => {
    const text = document.getElementById('am-source').value;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const original = copyBtn.textContent;
    copyBtn.textContent = copyBtn.dataset.done;
    setTimeout(() => { copyBtn.textContent = original; }, 1400);
  });
})();
