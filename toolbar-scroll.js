(() => {
  const toolbar = document.querySelector('#main-toolbar');
  const scrollbar = document.querySelector('#toolbar-scrollbar');
  const track = scrollbar?.querySelector('.toolbar-scrollbar-track');
  const thumb = scrollbar?.querySelector('.toolbar-scrollbar-thumb');
  if (!toolbar || !scrollbar || !track || !thumb) return;

  let frame = 0;
  let scrollbarDrag = null;
  let toolbarDrag = null;

  function maxScroll() {
    return Math.max(0, toolbar.scrollWidth - toolbar.clientWidth);
  }

  function updateScrollbar() {
    frame = 0;
    const max = maxScroll();
    scrollbar.hidden = max <= 1;
    scrollbar.setAttribute('aria-valuemax', String(Math.round(max)));
    scrollbar.setAttribute('aria-valuenow', String(Math.round(toolbar.scrollLeft)));
    if (max <= 1) return;

    const width = track.clientWidth;
    const thumbWidth = Math.min(width, Math.max(36, width * toolbar.clientWidth / toolbar.scrollWidth));
    const travel = Math.max(0, width - thumbWidth);
    thumb.style.width = `${thumbWidth}px`;
    thumb.style.transform = `translateX(${travel * toolbar.scrollLeft / max}px)`;
  }

  function scheduleUpdate() {
    if (!frame) frame = requestAnimationFrame(updateScrollbar);
  }

  toolbar.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(toolbar);
    for (const child of toolbar.children) observer.observe(child);
  }
  scheduleUpdate();

  scrollbar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || scrollbar.hidden) return;
    const rect = track.getBoundingClientRect();
    const thumbWidth = thumb.getBoundingClientRect().width;
    const travel = Math.max(1, rect.width - thumbWidth);
    if (!thumb.contains(event.target)) {
      const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - thumbWidth / 2) / travel));
      toolbar.scrollLeft = fraction * maxScroll();
    }
    event.preventDefault();
    scrollbar.setPointerCapture(event.pointerId);
    scrollbarDrag = { pointerId: event.pointerId, startX: event.clientX, startScroll: toolbar.scrollLeft, travel };
  });

  scrollbar.addEventListener('pointermove', event => {
    if (!scrollbarDrag || scrollbarDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const max = maxScroll();
    toolbar.scrollLeft = scrollbarDrag.startScroll + (event.clientX - scrollbarDrag.startX) * max / scrollbarDrag.travel;
  });

  function finishScrollbarDrag(event) {
    if (scrollbarDrag && scrollbarDrag.pointerId === event.pointerId) scrollbarDrag = null;
  }
  scrollbar.addEventListener('pointerup', finishScrollbarDrag);
  scrollbar.addEventListener('pointercancel', finishScrollbarDrag);
  scrollbar.addEventListener('lostpointercapture', finishScrollbarDrag);

  scrollbar.addEventListener('keydown', event => {
    const page = toolbar.clientWidth;
    const step = event.shiftKey ? page : 40;
    if (event.key === 'ArrowLeft') toolbar.scrollLeft -= step;
    else if (event.key === 'ArrowRight') toolbar.scrollLeft += step;
    else if (event.key === 'PageUp') toolbar.scrollLeft -= page;
    else if (event.key === 'PageDown') toolbar.scrollLeft += page;
    else if (event.key === 'Home') toolbar.scrollLeft = 0;
    else if (event.key === 'End') toolbar.scrollLeft = maxScroll();
    else return;
    event.preventDefault();
  });

  toolbar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || maxScroll() <= 1) return;
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    if (!target || target.closest('button,a,input,select,textarea,[role="button"],[contenteditable="true"],.brand')) return;
    event.preventDefault();
    toolbar.setPointerCapture(event.pointerId);
    toolbarDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startScroll: toolbar.scrollLeft, moved: false };
  });

  toolbar.addEventListener('pointermove', event => {
    if (!toolbarDrag || toolbarDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - toolbarDrag.startX;
    const dy = event.clientY - toolbarDrag.startY;
    if (!toolbarDrag.moved && Math.abs(dx) < 3) return;
    if (!toolbarDrag.moved && Math.abs(dy) > Math.abs(dx)) {
      toolbarDrag = null;
      return;
    }
    toolbarDrag.moved = true;
    toolbar.classList.add('toolbar-dragging');
    event.preventDefault();
    toolbar.scrollLeft = toolbarDrag.startScroll - dx;
  });

  function finishToolbarDrag(event) {
    if (!toolbarDrag || toolbarDrag.pointerId !== event.pointerId) return;
    toolbarDrag = null;
    toolbar.classList.remove('toolbar-dragging');
  }
  toolbar.addEventListener('pointerup', finishToolbarDrag);
  toolbar.addEventListener('pointercancel', finishToolbarDrag);
  toolbar.addEventListener('lostpointercapture', finishToolbarDrag);
})();
