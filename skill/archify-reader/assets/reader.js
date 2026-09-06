(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('sd-reader-data').textContent);
  const root = document.getElementById('sd-reader');
  const openButton = document.getElementById('sd-open');
  const dialog = document.getElementById('sd-dialog');
  const picker = document.getElementById('sd-select');
  const tip = document.getElementById('sd-tip');
  const content = document.getElementById('sd-content');
  const scroller = document.getElementById('sd-scroll');
  const backButton = document.getElementById('sd-back');
  const detailHistory = [];

  // The only Archify DOM adapter. No private Archify functions are patched.
  const container = document.querySelector('.diagram-container');
  const diagram = container?.querySelector('svg[role="img"]');
  const navigation = container?.querySelector('.diagram-nav');
  const graphNodes = new Map([...diagram?.querySelectorAll('[data-node-id]') || []].map(node => [node.getAttribute('data-node-id'), node]));
  const entries = new Map(data.nodes.map(entry => [entry.id, entry]));
  if (!diagram || !navigation || data.nodes.some(entry => !graphNodes.has(entry.id))) {
    openButton.textContent = '业务详情不可用：图版本不兼容';
    openButton.disabled = true;
    return;
  }
  // Share the existing control rail; do not change the host's page spacing.
  navigation.prepend(openButton);
  const ownsTarget = target => root.contains(target) || openButton.contains(target);
  const selectedId = () => {
    const selected = diagram.querySelectorAll('[data-node-id][data-focus-selected]');
    return selected.length === 1 ? selected[0].getAttribute('data-node-id') : null;
  };
  let returnFocus = null;
  let timer;
  let hovered = null;
  let lastDetail = data.nodes[0].id;
  for (const entry of data.nodes) picker.add(new Option(entry.label, entry.id));

  function syncButton() {
    const id = selectedId();
    openButton.disabled = !!id && !entries.has(id);
    const label = id
      ? entries.has(id) ? `查看详情 · ${entries.get(id).label} ↗` : '此节点暂无业务详情'
      : `业务详情 · ${data.nodes.length} 个节点 ↗`;
    openButton.textContent = '详情';
    openButton.title = label;
    openButton.setAttribute('aria-label', label);
  }
  new MutationObserver(syncButton).observe(diagram, { subtree: true, attributes: true, attributeFilter: ['data-focus-selected'] });
  syncButton();

  function showDetail(id) {
    const entry = entries.get(id);
    if (!entry) return;
    lastDetail = id;
    picker.value = id;
    document.getElementById('sd-title').textContent = entry.label;
    document.getElementById('sd-note').textContent = entry.note;
    document.getElementById('sd-source').textContent = `来源：${entry.source}`;
    dialog.classList.toggle('sd-has-evidence', !!entry.evidence);
    content.innerHTML = entry.html; // Escaped/rendered by the fixed build tool.
    scroller.scrollTop = 0;
    backButton.hidden = detailHistory.length === 0;
  }
  function followReference(button) {
    const id = button.getAttribute('data-sd-target');
    if (!entries.has(id)) return;
    detailHistory.push({ id: lastDetail, scroll: scroller.scrollTop,
      focusIndex: [...content.querySelectorAll('.sd-node-reference')].indexOf(button) });
    showDetail(id);
    document.getElementById('sd-title').focus({ preventScroll: true });
  }
  function backDetail() {
    const previous = detailHistory.pop();
    if (!previous) return;
    showDetail(previous.id);
    scroller.scrollTop = previous.scroll;
    (content.querySelectorAll('.sd-node-reference')[previous.focusIndex] || document.getElementById('sd-title')).focus({ preventScroll: true });
  }
  function hideTip() {
    clearTimeout(timer);
    hovered = null;
    tip.hidden = true;
  }
  function openDetail() {
    hideTip();
    returnFocus = graphNodes.get(selectedId()) || document.activeElement;
    detailHistory.length = 0;
    showDetail(selectedId() || lastDetail);
    dialog.showModal();
    document.getElementById('sd-close').focus({ preventScroll: true });
  }
  function closeDetail() {
    dialog.close();
    returnFocus?.focus({ preventScroll: true });
  }
  picker.addEventListener('change', () => { detailHistory.length = 0; showDetail(picker.value); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });

  // Archify has document-capture outside-click/keyboard handlers. Intercept only
  // our UI at window capture, handle its actions here, and preserve defaults
  // (select, scrolling, text selection). Graph events continue untouched.
  window.addEventListener('click', event => {
    if (!ownsTarget(event.target)) return;
    event.stopPropagation();
    if (event.target.closest('#sd-open')) openDetail();
    else if (event.target.closest('#sd-close')) closeDetail();
    else if (event.target.closest('#sd-back')) backDetail();
    else if (event.target.closest('.sd-node-reference')) followReference(event.target.closest('.sd-node-reference'));
    else if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDetail();
    }
  }, true);
  window.addEventListener('keydown', event => {
    if (!dialog.open && !ownsTarget(event.target)) return;
    event.stopPropagation();
    if (dialog.open && event.key === 'Escape') { event.preventDefault(); closeDetail(); }
  }, true);

  function scheduleTip(node) {
    const entry = entries.get(node.getAttribute('data-node-id'));
    if (!entry || dialog.open || hovered === node) return;
    hideTip();
    hovered = node;
    timer = setTimeout(() => {
      if (hovered !== node || dialog.open) return;
      tip.textContent = entry.note;
      tip.hidden = false;
      const rect = node.getBoundingClientRect();
      const box = tip.getBoundingClientRect();
      const x = Math.max(12, Math.min(innerWidth - box.width - 12, rect.left + rect.width / 2 - box.width / 2));
      const y = rect.top - box.height - 12 >= 12 ? rect.top - box.height - 12 : Math.min(innerHeight - box.height - 12, rect.bottom + 12);
      tip.style.left = `${x}px`;
      tip.style.top = `${Math.max(12, y)}px`;
    }, 250);
  }
  diagram.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const node = event.target.closest('[data-node-id]');
    if (node) scheduleTip(node);
  });
  diagram.addEventListener('pointerout', event => {
    if (hovered && !hovered.contains(event.relatedTarget)) hideTip();
  });
  diagram.addEventListener('focusin', event => {
    const node = event.target.closest('[data-node-id]');
    if (node) scheduleTip(node);
  });
  diagram.addEventListener('focusout', hideTip);
  diagram.addEventListener('pointerdown', hideTip);
  window.addEventListener('resize', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true });
  container.addEventListener('wheel', hideTip, { passive: true });
})();
