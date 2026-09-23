(function () {
  'use strict';
  if (window.__soldierAppInstallReady) return;
  window.__soldierAppInstallReady = true;

  var pendingPrompt = null;
  var busy = false;
  var installed = false;
  var accepted = false;
  var bar, button, panel, status, steps;
  var displayModes = typeof window.matchMedia === 'function' ? [
    window.matchMedia('(display-mode: standalone)'),
    window.matchMedia('(display-mode: minimal-ui)'),
    window.matchMedia('(display-mode: window-controls-overlay)')
  ] : [];

  function isStandalone() {
    return navigator.standalone === true || displayModes.some(function (mode) { return mode.matches; });
  }

  function syncVisibility() {
    if (!bar) return;
    bar.hidden = isStandalone() || (installed && panel.hidden);
    button.hidden = installed;
    button.disabled = busy || installed;
    button.textContent = busy ? 'Membuka pemasangan…' : 'Pasang aplikasi';
    button.setAttribute('aria-expanded', String(!panel.hidden));
  }

  function showMessage(message, manual) {
    if (!panel) return;
    status.textContent = message;
    steps.hidden = !manual;
    panel.hidden = false;
    syncVisibility();
  }

  function showManual() {
    showMessage(accepted
      ? 'Permintaan pemasangan sudah diterima. Tunggu browser menyelesaikannya. Jika aplikasi sudah terpasang, buka SoldierApp dari menu aplikasi atau desktop.'
      : 'Pemasangan langsung belum tersedia. Ikuti petunjuk browser di bawah.', true);
  }

  async function requestInstall() {
    if (busy || installed || isStandalone()) return;
    if (!pendingPrompt) {
      if (!panel.hidden) {
        panel.hidden = true;
        syncVisibility();
      } else showManual();
      return;
    }

    // Browser installation events are single-use and must be prompted by a click.
    var currentPrompt = pendingPrompt;
    pendingPrompt = null;
    busy = true;
    syncVisibility();
    try {
      await currentPrompt.prompt();
      var choice = await currentPrompt.userChoice;
      if (installed || isStandalone()) return;
      accepted = !!choice && choice.outcome === 'accepted';
      if (accepted) {
        showMessage('Permintaan pemasangan diterima. Tunggu sampai browser menyelesaikan pemasangan.', false);
      } else if (choice && choice.outcome === 'dismissed') {
        showMessage('Pemasangan dibatalkan. Anda tetap dapat memakai halaman ini. Untuk mencoba lagi, gunakan menu browser di bawah.', true);
      } else {
        showMessage('Browser belum memberi konfirmasi pemasangan. Periksa menu aplikasi atau gunakan petunjuk di bawah.', true);
      }
    } catch (error) {
      if (!installed && !isStandalone()) {
        accepted = false;
        showMessage('Pemasangan langsung belum dapat dibuka. Coba melalui menu browser di bawah.', true);
      }
    } finally {
      busy = false;
      syncVisibility();
    }
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    if (installed || isStandalone()) return;
    pendingPrompt = event;
    accepted = false;
    if (panel && !panel.hidden && !busy) {
      showMessage('Browser siap memasang aplikasi. Tekan “Pasang aplikasi” untuk melanjutkan.', false);
    }
  });

  window.addEventListener('appinstalled', function () {
    installed = true;
    accepted = false;
    pendingPrompt = null;
    showMessage('Aplikasi berhasil dipasang. Buka SoldierApp dari menu aplikasi atau desktop.', false);
    syncVisibility();
  });

  displayModes.forEach(function (mode) {
    if (typeof mode.addEventListener === 'function') mode.addEventListener('change', syncVisibility);
    else if (typeof mode.addListener === 'function') mode.addListener(syncVisibility);
  });
  window.addEventListener('pageshow', syncVisibility);

  function element(tag, text) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }

  function mount() {
    if (bar || !document.body) return;
    bar = element('div');
    bar.id = 'appInstallBar';
    button = element('button', 'Pasang aplikasi');
    button.type = 'button';
    button.id = 'appInstallButton';
    button.setAttribute('aria-controls', 'appInstallHelp');
    button.addEventListener('click', requestInstall);
    bar.appendChild(button);

    panel = element('div');
    panel.id = 'appInstallHelp';
    panel.hidden = true;
    var title = element('p', 'Pasang SoldierApparel');
    title.className = 'app-install-title';
    panel.appendChild(title);
    status = element('p');
    status.id = 'appInstallStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    panel.appendChild(status);
    steps = element('div');
    steps.id = 'appInstallSteps';
    steps.appendChild(element('p', 'Chrome di komputer: buka menu ⋮ → Transmisikan, simpan, dan bagikan → Instal halaman sebagai aplikasi. Nama menu dapat berbeda sesuai versi browser.'));
    steps.appendChild(element('p', 'Chrome di HP Android: buka menu ⋮ → Tambahkan ke layar utama atau Instal aplikasi.'));
    steps.appendChild(element('p', 'Microsoft Edge: buka menu ⋯ → Aplikasi → Instal situs ini sebagai aplikasi.'));
    steps.appendChild(element('p', 'Jika sudah terpasang, buka SoldierApp dari menu aplikasi atau desktop. Jika pilihan pemasangan tidak ada, gunakan jendela browser biasa, bukan Samaran/InPrivate. Komputer kantor dapat membatasi pemasangan; minta bantuan admin komputer.'));
    panel.appendChild(steps);
    var close = element('button', 'Tutup petunjuk');
    close.type = 'button';
    close.id = 'appInstallClose';
    close.addEventListener('click', function () {
      panel.hidden = true;
      syncVisibility();
      if (installed) bar.hidden = true;
      else if (!isStandalone()) button.focus();
    });
    panel.appendChild(close);
    bar.appendChild(panel);
    if (document.body.firstChild) document.body.insertBefore(bar, document.body.firstChild);
    else document.body.appendChild(bar);
    if (installed) showMessage('Aplikasi berhasil dipasang. Buka SoldierApp dari menu aplikasi atau desktop.', false);
    syncVisibility();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
