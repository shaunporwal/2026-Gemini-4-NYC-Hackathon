/* Accessible themed picker over the existing layout select. No layout logic here. */
(function () {
  'use strict';
  window.PresetPicker = {
    create(select) {
      const root = document.getElementById('presetPicker'), trigger = document.getElementById('presetTrigger');
      const list = document.getElementById('presetList'), label = document.getElementById('presetLabel');
      let buttons = [], search = '', searchedAt = 0;
      function close(restore) {
        list.hidden = true; trigger.setAttribute('aria-expanded', 'false');
        if (restore) trigger.focus();
      }
      function open(index = select.selectedIndex) {
        list.hidden = false; trigger.setAttribute('aria-expanded', 'true');
        buttons[Math.max(0, index)]?.focus();
      }
      function sync() {
        label.textContent = select.selectedOptions[0]?.textContent || 'Choose a layout';
        trigger.title = label.textContent;
        buttons = [...select.options].map((option, index) => {
          const button = document.createElement('button');
          button.type = 'button'; button.role = 'option'; button.tabIndex = -1;
          button.setAttribute('aria-selected', String(option.selected));
          const title = document.createElement('strong'), detail = document.createElement('span');
          title.textContent = option.textContent.replace(/\s*\(.*$/, '');
          detail.textContent = option.textContent.match(/\((.*)\)/)?.[1] || 'Venue layout';
          button.append(title, detail);
          button.addEventListener('click', () => {
            select.value = option.value; close(true); select.dispatchEvent(new Event('change', { bubbles: true })); sync();
          });
          button.addEventListener('keydown', event => {
            let next;
            if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
            if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = buttons.length - 1;
            if (next != null) { event.preventDefault(); buttons[next].focus(); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
            if (event.key === 'Tab') close(false);
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
              search = performance.now() - searchedAt > 700 ? event.key : search + event.key;
              searchedAt = performance.now();
              buttons.find(b => b.textContent.toLowerCase().startsWith(search.toLowerCase()))?.focus();
            }
          });
          return button;
        });
        list.replaceChildren(...buttons);
      }
      trigger.addEventListener('click', () => list.hidden ? open() : close(false));
      trigger.addEventListener('keydown', event => {
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
        if (event.key === 'Escape') close(false);
      });
      document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(false); });
      root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) close(false); });
      select.addEventListener('change', sync);
      sync(); return { sync };
    }
  };
})();
