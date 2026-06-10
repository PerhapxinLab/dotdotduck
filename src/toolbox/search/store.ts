import type { Doc } from '../common/types.js';

export type Posting = { docId: string; fieldFreqs: Record<string, number> };

/** Tokeniser signature — feeds the inverted index. */
export type Extract = (text: string) => string[];

export class SearchStore {
  postings = new Map<string, Posting[]>();
  docs = new Map<string, Doc>();
  fieldStats = new Map<string, { totalLength: number; docCount: number }>();
  totalDocs = 0;
  features = new Map<string, string[]>();
  private docFieldLengths = new Map<string, Record<string, number>>();

  add(doc: Doc, extract: Extract): void {
    if (this.docs.has(doc.id)) this.remove(doc.id);
    this.docs.set(doc.id, doc);
    this.totalDocs++;
    const fieldFeats = new Map<string, string[]>();
    const perFieldLen: Record<string, number> = {};
    for (const [field, value] of Object.entries(doc.fields)) {
      const str = String(value ?? '');
      const feats = extract(str);
      fieldFeats.set(field, feats);
      perFieldLen[field] = feats.length;
      const stat = this.fieldStats.get(field) ?? { totalLength: 0, docCount: 0 };
      stat.totalLength += feats.length;
      stat.docCount++;
      this.fieldStats.set(field, stat);
    }
    this.docFieldLengths.set(doc.id, perFieldLen);
    const featCounts = new Map<string, Record<string, number>>();
    for (const [field, feats] of fieldFeats) {
      for (const f of feats) {
        let m = featCounts.get(f);
        if (!m) {
          m = {};
          featCounts.set(f, m);
        }
        m[field] = (m[field] ?? 0) + 1;
      }
    }
    const uniqueFeats: string[] = [];
    for (const [f, fieldFreqs] of featCounts) {
      uniqueFeats.push(f);
      let list = this.postings.get(f);
      if (!list) {
        list = [];
        this.postings.set(f, list);
      }
      list.push({ docId: doc.id, fieldFreqs });
    }
    this.features.set(doc.id, uniqueFeats);
  }

  remove(docId: string): void {
    const doc = this.docs.get(docId);
    if (!doc) return;
    const feats = this.features.get(docId) ?? [];
    for (const f of feats) {
      const list = this.postings.get(f);
      if (!list) continue;
      const next = list.filter((p) => p.docId !== docId);
      if (next.length === 0) this.postings.delete(f);
      else this.postings.set(f, next);
    }
    const perFieldLen = this.docFieldLengths.get(docId) ?? {};
    for (const field of Object.keys(doc.fields)) {
      const stat = this.fieldStats.get(field);
      if (!stat) continue;
      const len = perFieldLen[field] ?? 0;
      stat.totalLength = Math.max(0, stat.totalLength - len);
      stat.docCount = Math.max(0, stat.docCount - 1);
    }
    this.docFieldLengths.delete(docId);
    this.features.delete(docId);
    this.docs.delete(docId);
    this.totalDocs = Math.max(0, this.totalDocs - 1);
  }

  candidates(queryFeats: string[]): Set<string> {
    const set = new Set<string>();
    for (const f of queryFeats) {
      const list = this.postings.get(f);
      if (!list) continue;
      for (const p of list) set.add(p.docId);
    }
    return set;
  }

  postingsFor(feature: string): Posting[] | undefined {
    return this.postings.get(feature);
  }

  avgFieldLen(field: string): number {
    const s = this.fieldStats.get(field);
    if (!s || s.docCount === 0) return 1;
    return s.totalLength / s.docCount;
  }
}
