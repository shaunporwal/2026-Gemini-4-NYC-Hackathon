/* UI boundary for the server-backed agent. The teammate supplies ask(question).
 * Replies are {text, openingId?, suggestions?: [{title, detail, openingId?}]}.
 * This module renders text only and makes no model requests. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let adapter = null, busy = false, generation = 0;
  function panel(id) {
    for (const button of document.querySelectorAll('[data-panel]')) {
      const selected = button.dataset.panel === id;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      $(button.dataset.panel).hidden = !selected;
    }
  }
  const tabs = [...document.querySelectorAll('[data-panel]')];
  tabs.forEach((button, i) => {
    button.addEventListener('click', () => panel(button.dataset.panel));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[index].focus(); panel(tabs[index].dataset.panel);
    });
  });
  $('inspectQueues').addEventListener('click', () => panel('insightsPanel'));
  function controls() {
    $('agentQuestion').disabled = !adapter || busy;
    $('agentSend').disabled = !adapter || busy;
    $('agentConnection').textContent = adapter ? busy ? 'Working on your question…' : 'Connected' : 'Awaiting agent connection';
    $('agentHelp').textContent = adapter ? 'Answers use the connected agent service' : 'Available when the agent service connects';
  }
  function focusButton(parent, openingId) {
    if (!openingId) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'text-button'; button.textContent = 'Show opening ↗';
    button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('twin:focus-opening', { detail: { id: openingId } })));
    parent.append(button);
  }
  function message(role, text) {
    const node = document.createElement('div'); node.className = 'agent-message ' + role;
    const title = document.createElement('strong'); title.textContent = role === 'user' ? 'You' : 'Gemini';
    node.append(title, document.createTextNode(text)); $('agentMessages').append(node);
    return node;
  }
  function receive(reply) {
    if (!reply || typeof reply.text !== 'string') throw new Error('The agent returned an incomplete response.');
    if (reply.suggestions != null && (!Array.isArray(reply.suggestions) || reply.suggestions.some(s => !s || typeof s !== 'object')))
      throw new Error('The agent returned invalid suggestions.');
    focusButton(message('assistant', reply.text), reply.openingId);
    $('suggestionList').replaceChildren();
    for (const suggestion of reply.suggestions || []) {
      const node = document.createElement('div'); node.className = 'suggestion';
      const title = document.createElement('strong'); title.textContent = suggestion.title || 'Suggestion';
      const detail = document.createElement('p'); detail.textContent = suggestion.detail || '';
      node.append(title, detail); focusButton(node, suggestion.openingId); $('suggestionList').append(node);
    }
  }
  $('agentForm').addEventListener('submit', async event => {
    event.preventDefault();
    const question = $('agentQuestion').value.trim();
    if (!question || !adapter || busy) return;
    const current = generation;
    message('user', question); $('agentQuestion').value = ''; busy = true; controls();
    try {
      const reply = await adapter.ask(question);
      if (current === generation) receive(reply);
    } catch (error) {
      if (current === generation) message('assistant', 'Unable to complete the request. ' + error.message);
    } finally {
      if (current === generation) { busy = false; controls(); }
    }
  });
  window.TwinAssistant = {
    connect(service) {
      if (service && typeof service.ask !== 'function') throw new Error('Agent adapter must provide ask(question).');
      generation++; adapter = service; busy = false; controls();
    },
    receive,
    showPanel: panel,
    clear() { generation++; busy = false; $('agentMessages').replaceChildren(); $('suggestionList').replaceChildren(); controls(); }
  };
})();
