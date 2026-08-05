import type {
  MemoryRecordSnapshot,
  CreateMemoryInput,
} from "../memories/memory-record.js";

export interface MemoryRecordStore {
  create(input: CreateMemoryInput): Promise<MemoryRecordSnapshot>;
  update(memory: MemoryRecordSnapshot): Promise<MemoryRecordSnapshot>;
  getById(id: string): Promise<MemoryRecordSnapshot | null>;
}
