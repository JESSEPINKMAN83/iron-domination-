import { describe, expect, it } from 'vitest';
import { orderAckFromMarker, orderAckLabel } from './orderAck';

describe('order acknowledgements', () => {
  it('maps marker kinds to ack copy', () => {
    expect(orderAckFromMarker('move')).toBe('move');
    expect(orderAckFromMarker('attack')).toBe('attack');
    expect(orderAckFromMarker('attack-move')).toBe('attack');
    expect(orderAckFromMarker('rally')).toBeUndefined();
  });

  it('returns field-radio toast lines', () => {
    expect(orderAckLabel('select')).toBe('Standing by');
    expect(orderAckLabel('move')).toBe('Moving out');
    expect(orderAckLabel('attack')).toBe('Weapons free');
    expect(orderAckLabel('stop')).toBe('Holding position');
  });
});
