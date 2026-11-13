/**
 * Lettura e scrittura binaria per i messaggi di rete. Lo scrittore si riusa (nessuna allocazione
 * per messaggio, tranne la copia finale da inviare). Little endian.
 */
export class ByteWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  offset = 0;

  constructor(capacity = 2048) {
    this.buffer = new ArrayBuffer(capacity);
    this.view = new DataView(this.buffer);
    this.bytes = new Uint8Array(this.buffer);
  }

  reset(): this {
    this.offset = 0;
    return this;
  }

  private ensure(size: number): void {
    if (this.offset + size <= this.buffer.byteLength) return;
    let capacity = this.buffer.byteLength * 2;
    while (capacity < this.offset + size) capacity *= 2;
    const next = new ArrayBuffer(capacity);
    new Uint8Array(next).set(this.bytes.subarray(0, this.offset));
    this.buffer = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }

  u8(value: number): void {
    this.ensure(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  i8(value: number): void {
    this.ensure(1);
    this.view.setInt8(this.offset, Math.max(-128, Math.min(127, Math.round(value))));
    this.offset += 1;
  }

  u16(value: number): void {
    this.ensure(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  i16(value: number): void {
    this.ensure(2);
    this.view.setInt16(this.offset, value, true);
    this.offset += 2;
  }

  u32(value: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  i32(value: number): void {
    this.ensure(4);
    this.view.setInt32(this.offset, value, true);
    this.offset += 4;
  }

  f32(value: number): void {
    this.ensure(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
  }

  f64(value: number): void {
    this.ensure(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }

  /** Numero tra 0 e 1 in un byte. */
  unit(value: number): void {
    this.u8(Math.round(Math.max(0, Math.min(1, value)) * 255));
  }

  /** Numero tra -1 e 1 in un byte. */
  signedUnit(value: number): void {
    this.i8(Math.max(-1, Math.min(1, value)) * 127);
  }

  bytesOf(source: Uint8Array): void {
    this.u16(source.length);
    this.ensure(source.length);
    this.bytes.set(source, this.offset);
    this.offset += source.length;
  }

  /** Copia dei byte scritti (da inviare: lo scrittore si riusa). */
  finish(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }
}

export class ByteReader {
  private view: DataView;
  private bytes: Uint8Array;
  offset = 0;

  constructor(bytes: Uint8Array = new Uint8Array(0)) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Riusa il lettore su altri byte. */
  reset(bytes: Uint8Array): this {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
    return this;
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  private need(size: number): void {
    if (this.offset + size > this.bytes.byteLength) throw new RangeError('Messaggio troncato');
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }

  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i16(): number {
    this.need(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  i32(): number {
    this.need(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f32(): number {
    this.need(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f64(): number {
    this.need(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  unit(): number {
    return this.u8() / 255;
  }

  signedUnit(): number {
    return this.i8() / 127;
  }

  bytesOf(): Uint8Array {
    const length = this.u16();
    this.need(length);
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
}
