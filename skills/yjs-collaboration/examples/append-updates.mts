import * as Y from 'yjs';

export type UpdateStore = Readonly<{
  loadUpdates: (documentId: string) => Promise<ReadonlyArray<Uint8Array>>;
  appendUpdate: (documentId: string, update: Uint8Array) => Promise<void>;
}>;
export type Patch =
  | Readonly<{ kind: 'append_text'; path: string; content: string }>
  | Readonly<{ kind: 'append_item'; path: string; content: string }>
  | Readonly<{ kind: 'set_key'; path: string; content: string }>;

export async function appendPatch(
  store: UpdateStore,
  documentId: string,
  patch: Patch,
): Promise<void> {
  const doc = new Y.Doc();
  try {
    for (const update of await store.loadUpdates(documentId)) Y.applyUpdate(doc, update);
    const before = Y.encodeStateVector(doc);
    // Stable top-level names avoid concurrent creation of different nested
    // shared types under the same Y.Map key.
    if (patch.kind === 'append_text') {
      const text = doc.getText(`text:${patch.path}`);
      text.insert(text.length, patch.content);
    } else if (patch.kind === 'append_item') {
      doc.getArray<string>(`list:${patch.path}`).push([patch.content]);
    } else {
      doc.getMap<string>('values').set(patch.path, patch.content);
    }
    const delta = Y.encodeStateAsUpdate(doc, before);
    // Each writer appends its own update. The store must commit each append
    // atomically (for PostgreSQL: one INSERT into an append-only table).
    await store.appendUpdate(documentId, delta);
  } finally {
    doc.destroy();
  }
}

export async function readDocument(store: UpdateStore, documentId: string) {
  const doc = new Y.Doc();
  try {
    for (const update of await store.loadUpdates(documentId)) Y.applyUpdate(doc, update);
    return {
      content: doc.getText('text:content').toString(),
      findings: doc.getArray<string>('list:findings').toArray(),
      values: doc.getMap<string>('values').toJSON(),
    };
  } finally {
    doc.destroy();
  }
}
