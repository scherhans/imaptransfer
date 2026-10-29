// The landing page's downloads: the button for the visitor's system, copying a checksum, and
// checking a downloaded file in the browser. Without this script the page still offers every
// file with its checksum and the commands to check it in a terminal; this only adds.
(() => {
  const source = document.getElementById('daten');
  if (!source) return;
  const { version, downloads, texts } = JSON.parse(source.textContent || '{}');
  const fill = (template, values) => template.replace(/\{(\w+)\}/g, (whole, key) => values[key] ?? whole);

  /** The visitor's system, as far as the browser tells; null for phones and tablets. */
  async function system() {
    const agent = navigator.userAgent;
    // An iPad asks for the desktop page and says "Macintosh"; its touch screen gives it away.
    if (/iPhone|iPad|iPod|Android/i.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return null;
    const platform = /Mac/.test(agent) ? 'mac' : /Win/.test(agent) ? 'windows' : /Linux|X11|CrOS/.test(agent) ? 'linux' : null;
    if (!platform) return null;
    // Most Macs sold since 2020 have Apple silicon; Chromium browsers can say for sure.
    let arch = platform === 'mac' ? 'arm64' : 'x64';
    try {
      const values = await navigator.userAgentData?.getHighEntropyValues(['architecture']);
      if (values?.architecture === 'arm') arch = 'arm64';
      else if (values?.architecture === 'x86') arch = 'x64';
    } catch {
      // Not offered: the guess above stands.
    }
    return { platform, arch };
  }

  system().then((found) => {
    if (!found) return;
    const match = downloads.find((item) => item.platform === found.platform && item.arch === found.arch) ?? downloads.find((item) => item.platform === found.platform);
    if (!match) return;
    const button = document.getElementById('laden');
    if (button) {
      button.href = match.url;
      button.setAttribute('download', match.name);
      button.textContent = texts.buttonFor[match.platform];
    }
    // The system's column says so, and its buttons for this processor take the accent.
    document.querySelector(`.system[data-platform="${match.platform}"] .deins`)?.removeAttribute('hidden');
    for (const item of document.querySelectorAll(`.variante:not(.fehlt)[data-platform="${match.platform}"][data-arch="${match.arch}"]`)) {
      item.classList.add('ist-deins');
    }
  });

  if (navigator.clipboard) {
    for (const button of document.querySelectorAll('.kopieren')) {
      button.hidden = false;
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.summe ?? '');
          button.textContent = texts.copied;
          setTimeout(() => {
            button.textContent = texts.copy;
          }, 2000);
        } catch {
          // The browser refused: the checksum stays selectable as text.
        }
      });
    }
  }

  const drop = document.querySelector('.ablage');
  const input = document.getElementById('datei');
  const result = document.querySelector('.ergebnis');
  if (!drop || !input || !result || !window.crypto?.subtle) return;
  drop.hidden = false;

  const SVG = 'http://www.w3.org/2000/svg';
  /** The result line: a check mark or a cross, then the sentence. Built from nodes, so a file name stays text. */
  function show(kind, text) {
    result.className = kind ? `ergebnis ${kind}` : 'ergebnis';
    result.replaceChildren();
    if (kind) {
      const mark = document.createElementNS(SVG, 'svg');
      mark.setAttribute('class', 'zeichen');
      mark.setAttribute('viewBox', '0 0 24 24');
      mark.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', kind === 'gut' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M7 7l10 10M17 7L7 17');
      path.setAttribute('pathLength', '1');
      mark.append(path);
      result.append(mark);
    }
    const sentence = document.createElement('span');
    sentence.textContent = text;
    result.append(sentence);
  }

  async function check(file) {
    show(null, fill(texts.checking, { name: file.name }));
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const known = downloads.find((item) => item.sha256 === hex);
      if (known) show('gut', fill(texts.match, { name: known.name }));
      else show('schlecht', fill(texts.mismatch, { name: file.name, version }));
    } catch {
      show('schlecht', fill(texts.unreadable, { name: file.name }));
    }
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void check(file);
  });
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('zieht');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('zieht'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('zieht');
    const file = event.dataTransfer?.files?.[0];
    if (file) void check(file);
  });
})();
