const cards = [...document.querySelectorAll('.eo3-example')];
const frames = [...document.querySelectorAll('[data-example-preview]')];
const count = document.getElementById('example-count');
const toggle = document.getElementById('skin-toggle');
let skinsVisible = true;

// Fit the writing demo to its content so only the editor and preview panes
// scroll. Watch layout changes from format selection, wrapping, and resizing.
const writingLab = document.querySelector('.eo3-writing-lab');
let writingLabObserver;
function fitWritingLab() {
  writingLabObserver?.disconnect();
  const body = writingLab.contentDocument?.body;
  if (!body) return;
  const resize = () => {
    const borders = writingLab.offsetHeight - writingLab.clientHeight;
    writingLab.style.height = `${Math.ceil(body.getBoundingClientRect().height) + borders}px`;
  };
  writingLabObserver = new ResizeObserver(resize);
  writingLabObserver.observe(body);
  resize();
}
writingLab.addEventListener('load', fitWritingLab);
fitWritingLab();

// Previews contain only bundled HTML/CSS. Same-origin access lets us disable the
// actual stylesheet without reloading the reader's scroll position or open notes.
function applySkin(frame) {
  const style = frame.contentDocument?.getElementById('creator-style');
  if (style?.sheet) style.sheet.disabled = !skinsVisible;
}
for (const frame of frames) {
  frame.addEventListener('load', () => applySkin(frame));
  applySkin(frame);
}
toggle.addEventListener('click', () => {
  skinsVisible = !skinsVisible;
  toggle.setAttribute('aria-pressed', String(skinsVisible));
  document.getElementById('skin-label').textContent = skinsVisible ? 'Workskins on' : 'Workskins off';
  frames.forEach(applySkin);
});
for (const button of document.querySelectorAll('[data-filter]')) {
  button.addEventListener('click', () => {
    for (const option of document.querySelectorAll('[data-filter]')) {
      option.setAttribute('aria-pressed', String(option === button));
    }
    let visible = 0;
    for (const card of cards) {
      card.hidden = button.dataset.filter !== 'All' && card.dataset.category !== button.dataset.filter;
      if (!card.hidden) visible++;
    }
    count.textContent = `${visible} examples${button.dataset.filter === 'All' ? '' : ' · ' + button.textContent}`;
  });
}
document.getElementById('gallery-controls').hidden = false;
