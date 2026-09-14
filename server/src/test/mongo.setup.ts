import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

// Importing the barrel registers every model on the default connection, which
// is what `syncIndexes` below iterates over.
import '@models';

/**
 * One `mongod` per test file, torn down at the end; collections are emptied
 * between tests so ordering cannot leak state.
 *
 * Indexes are built explicitly rather than left to `autoIndex`, which is
 * asynchronous: without this, the first test asserting on the unique phone
 * index would race the index build and pass for the wrong reason.
 */
let server: MongoMemoryServer | undefined;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
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
