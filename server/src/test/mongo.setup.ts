import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

// Importing the barrel registers every model on the default connection, which
// is what `syncIndexes` below iterates over.
import '@models';

/**
 * One `mongod` per test file, torn down at the end; collections are emptied
 * between tests so ordering cannot leak state.
 *
 * A **single-node replica set** rather than a standalone, since Day 12. A
 * standalone refuses to start a transaction at all, so calendar generation
 * would silently take the unwrapped fallback in `withTransaction` and the
 * atomicity it claims would never be exercised by a test. One node costs
 * roughly the same to boot and gives every test the same semantics as a
 * production deployment that has a replica set.
 *
 * Indexes are built explicitly rather than left to `autoIndex`, which is
 * asynchronous: without this, the first test asserting on the unique phone
 * index would race the index build and pass for the wrong reason.
 */
let server: MongoMemoryReplSet | undefined;

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  mongoose.set('strictQuery', true);
  await mongoose.connect(server.getUri(), { dbName: 'agrisense-test' });

  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes()));
});

afterEach(async () => {
  const { db } = mongoose.connection;
  if (!db) {
    return;
  }
  const collections = await db.collections();
  // `deleteMany` rather than `drop`: dropping a collection takes its indexes
  // with it, and every test after the first would run unindexed.
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
