// A bounded reader for the protobuf wire types used by camera metadata.
export type ProtoField = { wire: number; value: number | Uint8Array };
export type Proto = Map<number, ProtoField[]>;
export function protobuf(bytes: Uint8Array): Proto {
  const fields: Proto = new Map();
  let p = 0,
    count = 0;
  function varint() {
    let n = 0,
      scale = 1;
    for (let i = 0; i < 10; i++) {
      if (p >= bytes.length) throw Error("Truncated camera protobuf.");
      const b = bytes[p++];
      n += (b & 127) * scale;
      if (!(b & 128)) {
        if (!Number.isSafeInteger(n))
          throw Error("Camera integer exceeds safe precision.");
        return n;
      }
      scale *= 128;
    }
    throw Error("Invalid camera protobuf integer.");
  }
  while (p < bytes.length) {
    if (++count > 500_000) throw Error("Too many camera metadata fields.");
    const tag = varint(),
      id = Math.floor(tag / 8),
      wire = tag % 8;
    if (!id) throw Error("Invalid camera protobuf field.");
    let value: number | Uint8Array;
    if (wire === 0) value = varint();
    else {
      const length =
        wire === 2 ? varint() : wire === 1 ? 8 : wire === 5 ? 4 : -1;
      if (length < 0 || p + length > bytes.length)
        throw Error("Invalid camera protobuf payload.");
      value = bytes.subarray(p, p + length);
      p += length;
    }
    const list = fields.get(id) ?? [];
    list.push({ wire, value });
    fields.set(id, list);
  }
  return fields;
}
export function message(fields: Proto, ...path: number[]): Proto {
  let result = fields;
  for (const id of path) {
    const field = result.get(id)?.[0];
    result =
      field?.wire === 2 && field.value instanceof Uint8Array
        ? protobuf(field.value)
        : new Map();
  }
  return result;
}
export function numeric(fields: Proto, id: number): number | undefined {
  const field = fields.get(id)?.[0];
  if (!field) return;
  if (typeof field.value === "number") return field.value;
  const d = new DataView(
    field.value.buffer,
    field.value.byteOffset,
    field.value.byteLength,
  );
  return field.wire === 1
    ? d.getFloat64(0, true)
    : field.wire === 5
      ? d.getFloat32(0, true)
      : undefined;
}
export function stringField(fields: Proto, id: number) {
  const field = fields.get(id)?.[0];
  return field?.wire === 2 && field.value instanceof Uint8Array
    ? new TextDecoder().decode(field.value)
    : undefined;
}
