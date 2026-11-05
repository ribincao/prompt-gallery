// Dialog controls use hidden form values so existing save commands stay unchanged.
export function folderControl(value, esc) {
  return `<div class="field folder-control" data-folder="${esc(value)}"><span>Folder</span><input type="hidden" name="folder" value="${esc(value)}"><button type="button" class="folder-trigger" role="combobox" aria-label="Folder" aria-haspopup="listbox" aria-expanded="false"></button></div>`;
}
export function tokenControl(name, chosen, esc, label = 'Tags', hint = '') {
  return `<div class="field token-control" data-name="${esc(name)}" data-chosen="${esc(JSON.stringify(chosen || []))}"><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}<div class="token-field"><span class="tokens"></span><input class="token-input" aria-label="${esc(label)}" placeholder="+ Add tag" role="combobox" aria-autocomplete="list" aria-expanded="false"></div></div>`;
}
export function inlineName(value, esc, file = "") {
  return `<input class="inline-name" data-file="${esc(file)}" name="name" aria-label="Name" value="${esc(value)}" placeholder="Name">`;
}
export function mountControls(root, { folders, tags, categories = () => [], createFolder, esc, tagColor, report, normalizeName = value => value }) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const commits = [];
  let active = null, serial = 0;
  function popup(anchor, options, choose, extra) {
    active?.close();
    const menu = doc.createElement('div');
    menu.className = 'control-popover';
    menu.id = `control-menu-${++serial}`;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', anchor.getAttribute('aria-label') || 'Folders');
    root.closest('dialog').append(menu);
    anchor.setAttribute('aria-controls', menu.id);
    anchor.setAttribute('aria-expanded', 'true');
    let index = -1;
    const close = () => {
      menu.remove(); anchor.setAttribute('aria-expanded', 'false');
      anchor.removeAttribute('aria-activedescendant'); anchor.removeAttribute('aria-controls');
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('click', outside, true);
      win.removeEventListener('resize', position);
      root.removeEventListener('scroll', position, true);
      if (active?.menu === menu) active = null;
    };
    const outside = e => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
    function position() {
      const rect = anchor.getBoundingClientRect(), dialog = root.closest('dialog').getBoundingClientRect();
      const heading = root.closest('dialog').querySelector('.dialog-heading');
      const top = Math.max(8, heading?.getBoundingClientRect().bottom || dialog.top);
      const bottom = Math.min(win.innerHeight - 8, dialog.bottom || win.innerHeight - 8);
      const below = bottom - rect.bottom - 6, above = rect.top - top - 6;
      const up = below < Math.min(menu.scrollHeight || 220, 220) && above > below;
      menu.style.width = `${Math.min(Math.max(rect.width, 220), (dialog.width || win.innerWidth) - 24)}px`;
      menu.style.left = `${Math.max(dialog.left + 8, Math.min(rect.left, dialog.right - parseFloat(menu.style.width) - 8))}px`;
      menu.style.maxHeight = `${Math.max(40, Math.min(260, up ? above : below))}px`;
      menu.style.top = `${up ? Math.max(top, rect.top - 6 - Math.min(menu.scrollHeight, parseFloat(menu.style.maxHeight))) : rect.bottom + 6}px`;
    }
    const buttons = options.map((option, n) => {
      const b = doc.createElement('button'); b.type = 'button'; b.tabIndex = -1;
      b.id = `${menu.id}-${n}`; b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(!!option.selected));
      b.innerHTML = `<span class="option-label">${option.html || esc(option.label)}</span>`;
      if (option.separator) b.classList.add('menu-separated');
      b.addEventListener('pointerdown', e => e.preventDefault());
      b.addEventListener('click', () => choose(option, {menu, close, position}));
      menu.append(b); return b;
    });
    extra?.(menu);
    function key(e) {
      if (e.isComposing || e.metaKey || e.ctrlKey) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); }
      else if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        index = index < 0 ? (e.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons.forEach((b, n) => b.classList.toggle('highlighted', n === index));
        if (buttons[index]) { anchor.setAttribute('aria-activedescendant', buttons[index].id); buttons[index].scrollIntoView?.({block:'nearest'}); }
      } else if (e.key === 'Enter' && index >= 0) { e.preventDefault(); e.stopPropagation(); buttons[index].click(); }
      else if (e.key === 'Tab') close();
    }
    active = {menu, close, key, anchor};
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('click', outside, true);
    win.addEventListener('resize', position); root.addEventListener('scroll', position, true);
    position(); return active;
  }
  root.querySelectorAll('.folder-control').forEach(host => {
    const value = host.querySelector('input'), button = host.querySelector('button');
    const render = () => { button.innerHTML = `<span aria-hidden="true">▱</span><span>${esc(folders().find(f => f.id === value.value)?.name || 'Unfiled')}</span><span aria-hidden="true">⌄</span>`; };
    function open() {
      popup(button, [{id:'', name:'Unfiled'}, ...[...folders()].sort((a,b) => a.name.localeCompare(b.name))].map(f => ({id:f.id, label:f.name, selected:f.id === value.value, html:`<span class="menu-check">${f.id === value.value ? '✓' : ''}</span>${esc(f.name)}`})).concat([{id:null,label:'New folder…',separator:true}]), (option, p) => {
        if (option.id !== null) { value.value = option.id; render(); p.close(); button.focus(); return; }
        if (p.menu.querySelector('input')) return;
        const input = doc.createElement('input'); input.placeholder = 'Folder name'; input.setAttribute('aria-label', 'New folder name'); input.maxLength = 100;
        p.menu.append(input); input.focus(); p.position();
        input.addEventListener('keydown', async e => {
          if (e.isComposing) return;
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.close(); button.focus(); }
          if (e.key !== 'Enter') return;
          e.preventDefault(); e.stopPropagation();
          const name = input.value.trim(); if (!name || input.disabled) return;
          if (folders().some(f => f.name.toLowerCase() === name.toLowerCase())) { report('A folder with that name already exists.'); return; }
          input.disabled = true;
          try { const f = await createFolder(name); value.value = f.id; render(); p.close(); if (button.isConnected) button.focus(); }
          catch (error) { report(error); input.disabled = false; input.focus(); }
        });
      });
    }
    button.addEventListener('click', () => active?.anchor === button ? active.close() : open());
    button.addEventListener('keydown', e => {
      if (active?.anchor === button) active.key(e);
      else if (['ArrowDown','ArrowUp'].includes(e.key)) { open(); active.key(e); }
    }); render();
  });
  root.querySelectorAll('.token-control').forEach(host => {
    let chosen = JSON.parse(host.dataset.chosen);
    const input = host.querySelector('.token-input'), chips = host.querySelector('.tokens'), name = host.dataset.name;
    const vocabulary = name === "categories" ? categories : tags;
    input.placeholder = name === "categories" ? "+ Add category" : "+ Add tag";
    function render() {
      chips.innerHTML = chosen.map((tag, i) => `<span class="tag-token"><span class="tag-dot tone-${tagColor(tag)}" aria-hidden="true"></span><span>${esc(tag)}</span><button type="button" data-remove="${i}" aria-label="Remove ${esc(tag)}">×</button><input type="hidden" name="${esc(name)}" value="${esc(tag)}"></span>`).join('');
    }
    function add(text) {
      for (let tag of text.split(',').map(s => s.trim()).filter(Boolean)) {
        tag = vocabulary().find(t => t.toLowerCase() === tag.toLowerCase()) || tag;
        if (!chosen.includes(tag)) chosen.push(tag);
      }
      input.value = ''; render(); active?.close();
    }
    function suggest() {
      const q = input.value.trim().toLowerCase();
      const options = [...new Set(vocabulary())].filter(t => !chosen.includes(t) && t.toLowerCase().includes(q)).sort((a,b) => (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1) || a.localeCompare(b)).map(t => {
        const start = t.toLowerCase().indexOf(q);
        return {label:t, html:q ? `${esc(t.slice(0,start))}<mark>${esc(t.slice(start,start+q.length))}</mark>${esc(t.slice(start+q.length))}` : esc(t)};
      });
      if (q && !vocabulary().some(t => t.toLowerCase() === q)) options.push({label:input.value.trim(), html:`Create “${esc(input.value.trim())}”`});
      if (!options.length) { active?.close(); return; }
      popup(input, options, option => { add(option.label); input.focus(); });
    }
    chips.addEventListener('click', e => { const b = e.target.closest('[data-remove]'); if (b) { chosen.splice(Number(b.dataset.remove),1); render(); input.focus(); } });
    input.addEventListener('focus', suggest); input.addEventListener('input', suggest);
    input.addEventListener('keydown', e => {
      if (e.isComposing || e.metaKey || e.ctrlKey) return;
      if (active?.anchor === input) active.key(e);
      if (e.defaultPrevented) return;
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); e.stopPropagation(); add(input.value); }
      else if (e.key === 'Backspace' && !input.value) { e.preventDefault(); chosen.pop(); render(); suggest(); }
      else if (['ArrowDown','ArrowUp'].includes(e.key)) { suggest(); active?.key(e); }
    });
    input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); });
    commits.push(() => { if (input.value.trim()) add(input.value); }); render();
  });
  root.querySelectorAll('.inline-name').forEach(input => {
    let before = input.value;
    input.addEventListener('focus', () => { before = input.value; });
    input.addEventListener('blur', () => { input.value = normalizeName(input.value, input.dataset.file); });
    input.addEventListener('keydown', e => {
      if (e.isComposing || e.metaKey || e.ctrlKey) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') input.value = before;
        input.blur();
      }
    });
  });
  root.querySelectorAll('textarea[name="note"]').forEach(input => {
    input.placeholder = 'Add a note';
    const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(126, Math.max(48,input.scrollHeight))}px`; };
    input.addEventListener('input', grow); win.requestAnimationFrame(grow);
  });
  return { commit: () => commits.forEach(fn => fn()), destroy: () => { active?.close(); } };
}
