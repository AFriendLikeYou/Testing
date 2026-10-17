'use strict';

const slot = document.getElementById('paywall-slot');
const rest = document.getElementById('rest');
const checkout = document.getElementById('checkout');

function render(v) {
  rest.dataset.locked = '';
  const html = `<div class="paywall ${v.style}">
    <h2>${v.headline}</h2>
    <p>${v.text}</p>
    <p class="offer">${v.offer}</p>
    <button class="cta" id="paywall-cta">${v.cta}</button>
  </div>`;
  if (v.style === 'sheet') document.body.insertAdjacentHTML('beforeend', html);
  else slot.innerHTML = html;

  document.getElementById('paywall-cta').addEventListener('click', () => {
    Bandit.track('checkout');
    document.getElementById('checkout-offer').textContent = v.offer;
    checkout.hidden = false;
  });
}

document.getElementById('checkout-cancel').addEventListener('click', () => {
  checkout.hidden = true;
});

document.getElementById('checkout-buy').addEventListener('click', () => {
  Bandit.track('subscribed');
  checkout.hidden = true;
  document.querySelector('.paywall')?.remove();
  delete rest.dataset.locked;
});

(async () => {
  const variants = await (await fetch('/api/variants')).json();
  const id = await Bandit.assign('control');
  render(variants.find((v) => v.id === id) || variants[0]);
})();
