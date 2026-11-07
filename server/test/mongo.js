// Starts a throwaway MongoDB for tests: MONGODB_TEST_URI if set, otherwise an in-memory server
// (mongodb-memory-server downloads a mongod binary the first time it runs).
import { closeDb, connectDb } from '../src/db.js';

let memory;

export async function startTestDb() {
  let uri = process.env.MONGODB_TEST_URI;
  if (!uri) {
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server-core');
      memory = await MongoMemoryServer.create();
      uri = memory.getUri();
    } catch (err) {
      return `No test MongoDB available (${err.message.split('\n')[0]}). Set MONGODB_TEST_URI to run these tests.`;
    }
  }
  await connectDb(uri, `yt_reminder_test_${process.pid}`);
  return null;
}

export async function stopTestDb(db) {
  await db?.dropDatabase().catch(() => {});
  await closeDb();
  await memory?.stop();
}
