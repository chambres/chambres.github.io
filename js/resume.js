// Renders the resume section from data/resume.json.
// Same file is read by the terminal version served at `curl rhl.sh`, so the
// two never drift. Inline markup in bullet strings:
//   **text**  bold accent (purple)
//   __text__  highlighted stat (orange)
(function () {
  'use strict';

  var ACCENT = '#764ba2';
  var STAT = '#b07219';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // escape first, then swap the markup for spans, so JSON can never inject HTML
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g,
        '<span style="font-weight:bold;color:' + ACCENT + '">$1</span>')
      .replace(/__([^_]+)__/g,
        '<span style="color:' + STAT + ';font-weight:bold">$1</span>');
  }

  function itemHTML(item) {
    var h = '<div class="resume-item">'
      + '<div class="job-header">'
      + '<div class="job-title">' + esc(item.title) + '</div>'
      + '<div class="job-meta">' + esc(item.meta || '') + '</div>'
      + '</div><p class="job-desc">';

    var parts = [];
    if (item.subtitle) parts.push(esc(item.subtitle));
    (item.bullets || []).forEach(function (b) { parts.push('• ' + inline(b)); });
    (item.rows || []).forEach(function (r) {
      parts.push('<strong>' + esc(r.label) + ':</strong> ' + esc(r.value));
    });
    h += parts.join('<br>') + '</p>';

    if (item.tags && item.tags.length) {
      h += '<div class="resume-tags">' + item.tags.map(function (t) {
        return '<span class="resume-tag">' + esc(t) + '</span>';
      }).join('') + '</div>';
    }
    return h + '</div>';
  }

  function render(data, mount) {
    mount.innerHTML = (data.sections || []).map(function (sec) {
      return '<h3 style="color:' + esc(sec.color || '#888')
        + '; margin:32px 0 12px 0; font-size:1.08rem; text-transform:uppercase;'
        + ' letter-spacing:2px;">' + esc(sec.heading) + '</h3>'
        + (sec.items || []).map(itemHTML).join('');
    }).join('');
  }

  function init() {
    var mount = document.getElementById('resumeContent');
    if (!mount) return;
    fetch('./data/resume.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { render(data, mount); })
      .catch(function (err) {
        // never leave the section blank — point at the PDF instead
        console.error('resume.json failed to load:', err);
        mount.innerHTML = '<p class="job-desc" style="opacity:.8">'
          + 'Couldn\'t load the resume data. '
          + '<a href="./resume.pdf" style="color:#764ba2">View the PDF instead →</a></p>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
