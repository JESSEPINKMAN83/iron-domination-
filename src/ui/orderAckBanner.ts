import './orderAck.css';
import { orderAckLabel, type OrderAckKind } from './orderAck';

const SHOW_MS = 1200;

/** Short field-radio toast for order acknowledgements. */
export class OrderAckBanner {
  private readonly root: HTMLDivElement;
  private hideTimer?: number;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'order-ack';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    parent.appendChild(this.root);
  }

  show(kind: OrderAckKind): void {
    this.root.textContent = orderAckLabel(kind).toUpperCase();
    this.root.className = `order-ack order-ack--${kind} order-ack--visible`;
    if (this.hideTimer !== undefined) window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.root.classList.remove('order-ack--visible');
      this.hideTimer = undefined;
    }, SHOW_MS);
  }
}
